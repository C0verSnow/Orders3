import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import lockfile from 'proper-lockfile';
import { Configuration } from './config/index.ts';
import { Storage } from './database/index.ts';
import { Activity } from './services/activity.ts';
import { RequestLog } from './services/request-log.ts';
import { HttpClient } from './exchange/http.ts';
import { Credentials } from './services/credentials.ts';
import { Dashboard } from './services/dashboard.ts';
import { Scheduler } from './scheduler/index.ts';
import { WorkspaceOrigin } from './security/origin.ts';
import { createServer } from './api/index.ts';
import { AppError, safeError } from './utils/errors.ts';

let startupStage = 'configuration';
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    host: { type: 'string' }, port: { type: 'string' }, cached: { type: 'boolean' }, 'fetch-only': { type: 'boolean' }, list: { type: 'boolean' },
    browser: { type: 'boolean' }, 'no-browser': { type: 'boolean' }, desktop: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }
  } });
  if (values.help) { console.log('Orders3：--cached --fetch-only --list --host IP --port 8090 --browser --no-browser [数据库.db]'); return; }
  if (values.version) { console.log(`Orders3 ${process.env.ORDERS_VERSION || '1.0.0'} (${process.env.ORDERS_COMMIT || 'development'})`); return; }
  if (values.desktop) throw new AppError('请使用桌面发行包启动内嵌窗口；服务端可用 --browser 打开浏览器');
  if (positionals.length > 1 || (values.list && values['fetch-only']) || (values.cached && (values.list || values['fetch-only']))) throw new AppError('启动参数冲突');
  const config = new Configuration();
  const container = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  if (positionals.length) {
    if (!['.db', '.sqlite', '.sqlite3'].includes(extname(positionals[0]).toLowerCase())) throw new AppError('位置参数只能是 SQLite 数据库文件');
    config.databasePath = resolve(positionals[0]);
  }
  const directory = dirname(config.databasePath); mkdirSync(directory, { recursive: true, mode: 0o700 });
  // One service per data directory protects quota, logs, and trading across processes.
  startupStage = 'process-lock';
  if (container) console.log('检查数据目录进程锁；异常退出遗留锁最多等待约 5 分钟，不会强删活动锁');
  const release = await lockfile.lock(directory, { lockfilePath: resolve(directory, '.orders-process.lock'), stale: 300000, update: 5000, retries: container ? { retries: 65, minTimeout: 5000, maxTimeout: 5000, factor: 1 } : 0 });
  let storage: Storage | undefined;
  let stopped = false;
  try {
    startupStage = 'storage';
    storage = new Storage(config.databasePath);
    const activity = new Activity(), log = new RequestLog(resolve(directory, 'logs')), http = new HttpClient(activity, log);
    const credentials = new Credentials(config, http), dashboard = new Dashboard(config, storage, http, activity), scheduler = new Scheduler(config, dashboard);
    if (values.list || values['fetch-only']) {
      await credentials.refresh(false);
      try { if (values.list) await dashboard.refreshOrders(false); else await dashboard.refreshSources(); }
      finally { credentials.stop(); http.controller.abort(); }
      console.log('已保存数据'); return;
    }
    const host = values.host || process.env.ORDERS_HOST || (container ? '0.0.0.0' : '127.0.0.1');
    const portText = values.port ?? process.env.ORDERS_PORT ?? (container ? '8090' : '0');
    if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw new AppError('端口必须为 0 至 65535');
    if (host !== 'localhost' && !isIP(host)) throw new AppError('监听地址须为 IP 或 localhost');
    const workspace = new WorkspaceOrigin(), app = createServer(dashboard, scheduler, credentials, log, workspace);
    startupStage = 'listen';
    await app.listen({ host, port: Number(portText) });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new AppError('无法读取监听地址');
    const displayHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
    const url = `http://${displayHost}:${address.port}`;
    workspace.origin = url;
    console.log(`本地看板：${url}/`);
    const shutdown = async () => {
      if (stopped) return; stopped = true;
      scheduler.stop(); credentials.stop(); http.controller.abort();
      await app.close();
      while (scheduler.busy || dashboard.sourcesBusy || dashboard.gateBusy) await new Promise(resolve => setTimeout(resolve, 20));
      storage?.close(); storage = undefined; await release();
    };
    process.once('SIGINT', () => { void shutdown(); }); process.once('SIGTERM', () => { void shutdown(); });
    if (process.env.ORDERS_DESKTOP_CHILD === '1') {
      process.stdin.once('end', () => { void shutdown(); });
      process.stdin.resume();
    }
    scheduler.start();
    const ready = credentials.refresh();
    void ready.then(async () => {
      if (stopped || values.cached) return;
      // Startup jobs only synchronize data; opening waits for its independent schedule.
      await Promise.allSettled([dashboard.refreshOrders(), ...(scheduler.value.enabled ? [dashboard.refreshSources()] : [])]);
    });
    if (!values['no-browser'] && (values.browser || (!container && process.env.ORDERS_NO_BROWSER !== '1'))) {
      const target = `${url}/`;
      const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', target] : [target];
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }); child.on('error', () => console.error('请手动打开工作台地址')); child.unref();
    }
  } finally {
    // Long-lived server owns cleanup in shutdown; single-shot and startup failures clean here.
    if (values.list || values['fetch-only'] || !process.listenerCount('SIGTERM')) { storage?.close(); await release(); }
  }
}
main().catch(error => {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(error.code) ? error.code : 'UNKNOWN';
  console.error(`启动失败：stage=${startupStage} code=${code}；${safeError(error)}`);
  process.exitCode = 1;
});
