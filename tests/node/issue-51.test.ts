// Remote CI only. Actual configuration, API, scheduler and SQLite; no live exchange.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fixture, response, list } from './helpers.ts';
import { Configuration } from '../../apps/server/src/config/index.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { Credentials } from '../../apps/server/src/services/credentials.ts';
import { createServer } from '../../apps/server/src/api/index.ts';
import { WorkspaceOrigin } from '../../apps/server/src/security/origin.ts';
import { closePrice } from '../../packages/decimal/index.ts';

const rules = { name: 'BTC_USDT', quanto_multiplier: '0.1', order_price_round: '0.01' };
const now = new Date('2026-11-04T05:00:00Z').getTime();

test('51 old config defaults to 3.1; settings persist independently of credentials and schedules', t => {
  const f = fixture(t);
  assert.equal(f.config.snapshot().close_multiplier, '3.1');
  f.config.saveSection('schedule', { enabled: 'false', cron: '7 * * * *' });
  f.config.update({ close_multiplier: ' 2.75 ' });
  assert.equal(f.config.snapshot().close_multiplier, '2.75');
  f.config.update({ API_KEY: 'replacement-key' });
  const restarted = new Configuration({ ORDERS_CONFIG_PATH: f.config.path }, f.root);
  assert.equal(restarted.closeMultiplier, '2.75');
  assert.equal(restarted.connection().gateKey, 'replacement-key');
  assert.deepEqual(restarted.schedule(), { enabled: false, cron: '7 * * * *' });
  f.config.update({ close_multiplier: '1.234567890123456789e-128' });
  assert.equal(new Configuration({ ORDERS_CONFIG_PATH: f.config.path }, f.root).closeMultiplier, '1.234567890123456789e-128');
});

test('51 API rejects invalid multiplier without changing either disk or live configuration', async t => {
  const f = fixture(t), workspace = new WorkspaceOrigin(); workspace.origin = 'http://localhost';
  const credentials = new Credentials(f.config, f.http);
  const app = createServer(f.dashboard, new Scheduler(f.config, f.dashboard), credentials, f.log, workspace);
  t.after(() => { credentials.stop(); return app.close(); });
  const before = f.config.snapshot();
  const content = f.config.text();
  for (const value of ['', '0', '-1', 'NaN', 'Infinity', '1e999', 'abc', null, 2, true]) {
    const result = await app.inject({ method: 'POST', url: '/api/settings', headers: { origin: workspace.origin }, payload: { close_multiplier: value, API_KEY: 'must-not-save' } });
    assert.equal(result.statusCode, 400, String(value));
    assert.deepEqual(f.config.snapshot(), before);
    assert.equal(f.config.text(), content);
  }
  const saved = await app.inject({ method: 'POST', url: '/api/settings', headers: { origin: workspace.origin }, payload: { close_multiplier: '2.25' } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().close_multiplier, '2.25');
  assert.equal((await app.inject({ method: 'GET', url: '/api/settings' })).json().close_multiplier, '2.25');
  assert.equal(new Configuration({ ORDERS_CONFIG_PATH: f.config.path }, f.root).closeMultiplier, '2.25');
  assert.equal(f.storage.intents().length, 0, 'saving settings cannot place a trade');
});

test('51 invalid saved multiplier is rejected at startup', t => {
  const f = fixture(t);
  writeFileSync(f.config.path, '[trading]\nclose_multiplier = "0"\n');
  assert.throws(() => new Configuration({ ORDERS_CONFIG_PATH: f.config.path }, f.root), /平仓乘数/);
});

test('51 close calculation uses the supplied decimal multiplier for both directions', () => {
  assert.equal(closePrice('100', '2', '1', rules, '3.1'), '116.66');
  assert.equal(closePrice('100', '-2', '1', rules, '3.1'), '83.66');
  assert.equal(closePrice('100', '2', '1', rules, '2'), '111.10');
  assert.equal(closePrice('100', '-2', '1', rules, '2'), '89.10');
});

for (const short of [false, true]) test(`51 saved multiplier reaches ${short ? 'short' : 'long'} maintenance and adjusts a pending close on the next cycle`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let orders: Record<string, unknown>[] = [];
  const pos = { contract: 'BTC_USDT', size: short ? '-2' : '2', entry_price: '100', initial_margin: '1', leverage_max: '20', unrealised_pnl: '0', realised_pnl: '0', mark_price: '101' };
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/stop')) orders = orders.filter(row => row.id !== String(body.id));
      else orders.push({ ...body, id: String(100 + writes.length), original_status: 1 });
      return response({ code: 0, data: { id: String(100 + writes.length) } });
    }
    if (url.pathname.endsWith('/positions')) return response([pos]);
    if (url.pathname.includes('/contracts/')) return response(rules);
    if (url.pathname.includes('my_trades_timerange')) return response([]);
    return response(list(url.searchParams.get('page_num') === '1' ? orders : []));
  });
  const scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.activation_price, short ? '83.66' : '116.66');
  f.config.update({ close_multiplier: '2' });
  assert.equal(writes.length, 1, 'save is passive');
  assert.match(readFileSync(f.config.path, 'utf8'), /close_multiplier = "2"/);
  t.mock.timers.setTime(now + 1200000); await scheduler.tick();
  assert.equal(writes.length, 3);
  assert.ok(writes[1].path.endsWith('/stop'));
  assert.equal(writes[2].body.activation_price, short ? '89.10' : '111.10');
  assert.equal(writes[2].body.amount, short ? '2' : '-2');
  assert.equal(writes[2].body.reduce_only, true);
  assert.equal(f.storage.lastRun('maintenance')?.state, 'completed');
  t.mock.timers.setTime(now + 1800000); await scheduler.tick();
  assert.equal(writes.length, 3, 'unchanged parameters retain the existing order');
});
