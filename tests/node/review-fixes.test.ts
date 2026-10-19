// CI-only: regression cases from PR #34 / 检查报告.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, response, source, list } from './helpers.ts';
import { Configuration } from '../../apps/server/src/config/index.ts';
import { Cron, Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { syncEntries } from '../../apps/server/src/services/entry-history.ts';
import { openOrders, closeOrders } from '../../apps/server/src/services/trading.ts';
import { Credentials } from '../../apps/server/src/services/credentials.ts';
import { Sessions } from '../../apps/server/src/security/session.ts';
import { createServer } from '../../apps/server/src/api/index.ts';

const position = { contract: 'BTC_USDT', size: '2', entry_price: '100', leverage_max: '20', unrealised_pnl: '0', realised_pnl: '0', initial_margin: '1', mark_price: '101' };
const rule = { name: 'BTC_USDT', quanto_multiplier: '0.1', order_price_round: '0.5' };

test('F01 .env config path works without Node env-file and process value wins', t => {
  const f = fixture(t), custom = join(f.root, 'custom');
  writeFileSync(join(f.root, '.env'), `ORDERS_CONFIG_PATH=${custom}\n`);
  assert.equal(new Configuration({}, f.root).path, custom);
  assert.equal(new Configuration({ ORDERS_CONFIG_PATH: f.config.path }, f.root).path, f.config.path);
});
test('F02 cross-month and cross-year cron never skip target midnight', () => {
  assert.equal(new Cron('0 0 1 11 *').nextAfter(new Date(2026, 9, 18, 10, 15)).getTime(), new Date(2026, 10, 1).getTime());
  assert.equal(new Cron('0 0 1 1 *').nextAfter(new Date(2026, 11, 31, 23, 59)).getTime(), new Date(2027, 0, 1).getTime());
});
test('F03 empty local cache still fetches and stops live opening order', async t => {
  const calls: string[] = [];
  const old = { id: '19', contract: 'BTC_USDT', amount: '2', activation_price: '100.5', reduce_only: false, original_status: 1 };
  const f = fixture(t, async (url, init) => {
    calls.push(`${init.method} ${url.pathname}`);
    if (init.method === 'POST') return response({ code: 0, data: {} });
    return response(list(url.searchParams.get('page_num') === '1' ? [old] : []));
  });
  assert.equal(f.storage.trailing().length, 0);
  assert.equal((await openOrders(f.gate, f.storage))[0].action, 'stopped');
  assert.ok(calls.some(value => value.endsWith('/stop')));
});
test('F04 delayed fills behind watermark are added once even after display history pruning', async t => {
  const now = Date.now(), fillTime = Math.floor((now - 60000) / 1000);
  let visible = false;
  const f = fixture(t, async url => {
    if (url.pathname.endsWith('/positions')) return response([position]);
    return response(visible && url.searchParams.get('offset') === '0' ? [{ trade_id: '900', create_time: String(fillTime), contract: 'BTC_USDT', size: '2', close_size: '0' }] : []);
  });
  assert.equal(await syncEntries(f.gate, f.storage, now), false);
  visible = true;
  assert.equal(await syncEntries(f.gate, f.storage, now + 1000), true);
  assert.equal(f.storage.recentEntry('BTC_USDT', 1, now), true);
  assert.equal(await syncEntries(f.gate, f.storage, now + 2000), false);
  const events = Array.from({ length: 105 }, (_, index) => ({ event_id: `x${index}`, contract: 'BTC_USDT', side: 1, entry_time: now + index }));
  f.storage.history(f.gate.owner, events, now + 3000);
  assert.equal(f.storage.rows('position_entry_history', 'entry_time').length, 100);
  assert.equal(f.storage.entrySeen(f.gate.owner, '900'), true);
  assert.equal(await syncEntries(f.gate, f.storage, now + 4000), false);
});
test('F05 API rejects settings while source fetch is pending; fallback changes wait for lease release', async t => {
  let releaseFetch!: () => void;
  const waiting = new Promise<void>(resolve => { releaseFetch = resolve; });
  const f = fixture(t, async url => { if (url.hostname === 'supabase.invalid') { await waiting; return response([]); } return response(list([])); });
  const credentials = new Credentials(f.config, f.http), sessions = new Sessions('test-token-for-regression-at-least-32-chars');
  sessions.origin = 'http://localhost';
  const app = createServer(f.dashboard, new Scheduler(f.config, f.dashboard), credentials, f.log, sessions);
  t.after(() => { credentials.stop(); return app.close(); });
  const work = f.dashboard.refreshSources();
  const result = await app.inject({ method: 'POST', url: '/api/settings', headers: { origin: sessions.origin, authorization: `Bearer ${sessions.token}` }, payload: { API_KEY: 'replacement-key' } });
  assert.equal(result.statusCode, 409); assert.equal(f.config.connection().gateKey, 'test-key');
  f.config.setFallback({ API_KEY: 'deferred' }); assert.equal(f.config.fallback.API_KEY, undefined);
  releaseFetch(); await work;
  assert.equal(f.config.fallback.API_KEY, 'deferred');
  f.config.update({ API_KEY: 'replacement-key' }); assert.equal(f.config.connection().gateKey, 'replacement-key');
});
test('F06 changed protection stays intact with explicit manual-replacement failure and no POST', async t => {
  let posts = 0;
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { posts++; throw new Error('must preserve old protection'); }
    if (url.pathname.endsWith('/positions')) return response([position]);
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' ? [{ id: '99', contract: 'BTC_USDT', amount: '-2', activation_price: '110', reduce_only: true, original_status: 1 }] : []));
    return response([]);
  });
  const result = await closeOrders(f.gate, f.storage);
  assert.equal(posts, 0); assert.equal(result[0].operation, 'replace'); assert.match(result[0].error!, /保留旧保护单/);
  assert.equal(f.storage.trailing()[0].original_status, 1);
});
test('F07 unknown creation includes original credential fingerprint and unique Gate text before POST', async t => {
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') {
      const intent = f.storage.intents()[0], payload = JSON.parse(String(init.body));
      assert.equal(intent.owner, f.gate.owner); assert.equal(intent.request_id, payload.text);
      assert.match(payload.text, /^t-[a-f0-9]{28}$/); assert.equal(intent.payload, init.body);
      throw new Error('ambiguous');
    }
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list([]));
    return response([]);
  });
  f.storage.saveSources([source]); await openOrders(f.gate, f.storage);
  assert.equal(f.storage.intents()[0].state, 'unknown');
});
test('F07 wrong credential and legacy ownerless intent cannot be released; same identity records evidence without POST', async t => {
  let posts = 0;
  const f = fixture(t, async (url, init) => { if (init.method === 'POST') posts++; return response(url.pathname.endsWith('/list') ? list([]) : []); });
  const legacy = f.storage.intent('create', '{}');
  await assert.rejects(f.dashboard.resolveIntent(legacy, 'verified in Gate'), /指纹缺失/);
  const id = f.storage.intent('create', '{}', f.gate.owner, 't-test-identity');
  f.config.update({ API_KEY: 'other-key' });
  await assert.rejects(f.dashboard.resolveIntent(id, 'verified in Gate'), /当前连接不同/);
  f.config.update({ API_KEY: 'test-key' });
  await f.dashboard.resolveIntent(id, 'Gate order 123 reviewed with history');
  const row = f.storage.rows('trade_intents', 'created_at').find(row => row.id === id)!;
  assert.equal(row.state, 'reviewed'); assert.match(String(row.review_evidence), /123/); assert.equal(posts, 0);
  assert.equal(f.storage.intents()[0].id, legacy);
});
test('F08 trailing-only refresh never claims a new positions timestamp', async t => {
  const f = fixture(t, async () => response(list([])));
  assert.equal(f.dashboard.orders().position_updated_at, null);
  await f.dashboard.refreshOrders(false);
  const snapshot = f.dashboard.orders();
  assert.ok(snapshot.trailing_updated_at); assert.equal(snapshot.position_updated_at, null);
});
test('F09 HTTP 200 invalid JSON and oversized bodies record failed activity and log', async t => {
  let large = false;
  const f = fixture(t, async () => new Response('bad json', { status: 200, headers: large ? { 'content-length': '32000001' } : {} }));
  for (const value of [false, true]) {
    large = value;
    await assert.rejects(f.http.request('regression', new URL('https://example.invalid/test')));
    assert.equal(f.activity.snapshot().events.at(-1)?.state, 'failed');
    const log = JSON.parse(readFileSync(f.log.path, 'utf8').trim().split('\n').at(-1)!);
    assert.equal(log.status, 200); assert.equal(log.success, false);
  }
});
