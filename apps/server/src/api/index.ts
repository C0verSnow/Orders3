import Fastify from 'fastify';
import { z } from 'zod';
import type { Dashboard } from '../services/dashboard.ts';
import type { Scheduler } from '../scheduler/index.ts';
import type { Credentials } from '../services/credentials.ts';
import type { RequestLog } from '../services/request-log.ts';
import { Sessions } from '../security/session.ts';
import { Gate } from '../exchange/gate.ts';
import { AppError, safeError } from '../utils/errors.ts';
import { webAssets } from './web-assets.ts';

export function createServer(dashboard: Dashboard, scheduler: Scheduler, credentials: Credentials, log: RequestLog, sessions: Sessions) {
  const app = Fastify({ logger: false, bodyLimit: 32768, requestTimeout: 300000, trustProxy: false, disableRequestLogging: true });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    // Block Host/DNS rebinding, including same-origin cookie and token bootstrap requests.
    const host = request.headers.host;
    const allowed = dashboard.config.environment.ORDERS_ALLOWED_ORIGIN || sessions.origin;
    if (sessions.origin && host !== new URL(allowed).host) throw new AppError('访问地址与受信任工作台地址不一致', 403);
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (origin && origin !== allowed) throw new AppError('来源地址未获授权', 403);
    if (request.method !== 'GET' && request.method !== 'HEAD') sessions.sameOrigin(request, dashboard.config.environment.ORDERS_ALLOWED_ORIGIN);
    if (path === '/api/session') return;
    if (!sessions.authenticated(request)) throw new AppError('请先使用启动时的登录令牌连接工作台', 401);
  });
  app.addHook('onResponse', async (request, reply) => {
    // Never log untrusted paths which could contain a pasted token/credential.
    const route = request.routeOptions.url || '/unknown';
    log.write('inbound', request.method, new URL(route, 'http://localhost'), reply.statusCode);
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof AppError ? error.statusCode : error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    reply.code(status).send({ error: error instanceof AppError ? error.message : status < 500 ? '请求格式或参数无效' : safeError(error) });
  });
  app.get('/health', () => ({ ok: true }));
  app.get('/api/session', request => ({ authenticated: sessions.authenticated(request) }));
  app.post('/api/session', (request, reply) => sessions.create(request, reply));
  app.delete('/api/session', (request, reply) => sessions.clear(request, reply));
  app.get('/api/data', () => ({ ...dashboard.sources(), schedule: scheduler.snapshot() }));
  app.get('/api/orders', () => dashboard.orders());
  app.get('/api/activity', () => dashboard.activity.snapshot());
  app.get('/api/status', () => ({ pending: dashboard.storage.intents(), database_error: dashboard.storage.schemaError }));
  app.post('/api/refresh', async () => { await dashboard.refreshSources(); return dashboard.sources(); });
  app.post('/api/orders/refresh', async () => { await dashboard.refreshOrders(); return dashboard.orders(); });
  app.get('/api/settings', () => dashboard.config.snapshot());
  app.post('/api/settings', request => {
    const result = dashboard.config.update(request.body);
    void credentials.refresh();
    return result;
  });
  app.get('/api/schedule', () => scheduler.snapshot());
  app.post('/api/schedule', request => scheduler.update(request.body));
  app.get('/api/download', (_request, reply) => reply.type('application/vnd.sqlite3').header('Content-Disposition', 'attachment; filename="data.db"').send(dashboard.storage.download()));
  app.post('/api/intents/resolve', async request => {
    const parsed = z.object({ id: z.string().uuid(), confirmed_exchange_review: z.literal(true) }).strict().safeParse(request.body);
    if (!parsed.success) throw new AppError('必须明确确认已在 Gate 核对本笔交易');
    if (dashboard.gateBusy || dashboard.sourcesBusy) throw new AppError('请等待当前任务完成', 409);
    if (!dashboard.storage.intents().some(row => row.id === parsed.data.id)) throw new AppError('待核对交易不存在', 404);
    // Resolving is a local acknowledgement, never a retry of an exchange write.
    await dashboard.refreshOrders(false);
    dashboard.storage.intentState(parsed.data.id, 'reviewed');
    dashboard.activity.record({ task: 'manual-review', kind: 'task', state: 'completed' });
    return { pending: dashboard.storage.intents() };
  });
  app.get('/api/history', () => ({ entries: dashboard.storage.rows('position_entry_history', 'entry_time DESC,event_id DESC') }));
  for (const [path, asset] of Object.entries(webAssets)) app.get(path, (_request, reply) => reply.type(asset.type).send(Buffer.from(asset.body, 'base64')));
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: '页面或接口不存在' }));
  return app;
}
