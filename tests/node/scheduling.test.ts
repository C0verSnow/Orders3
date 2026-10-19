// CI only: real SQLite and fake exchange, never a funded account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fixture, response, source, list } from './helpers.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { openOrders } from '../../apps/server/src/services/trading.ts';
const start = new Date('2026-10-19T12:00:00Z').getTime();
const rule = { name: 'BTC_USDT', quanto_multiplier: '0.1', order_price_round: '0.5' };
function setup(t: Parameters<typeof fixture>[0], onPost?: () => void) {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { onPost?.(); return response({ code: 0, data: { id: '123' } }); }
    if (url.hostname === 'supabase.invalid') return response(url.searchParams.get('offset') === '0' ? [{ ...source, order_price_round: '0.5' }] : []);
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list([]));
    return response([]);
  });
  return f;
}
test('startup and manual/periodic reads never POST; legacy schedule never grants opening', async t => {
  let posts = 0; const f = setup(t, () => posts++);
  const scheduler = new Scheduler(f.config, f.dashboard);
  assert.equal(scheduler.snapshot().opening?.enabled, false);
  await f.dashboard.refreshSources(); await f.dashboard.refreshOrders();
  scheduler.update({ enabled: true, cron: '* * * * *' });
  t.mock.timers.setTime(start + 60000); await scheduler.tick();
  assert.equal(posts, 0); assert.equal(f.storage.sources().orders.length, 1);
  assert.equal(scheduler.snapshot().result, 'completed');
  await assert.rejects(openOrders(f.gate, f.storage), /缺少开仓授权/);
});
test('opening waits for its own due time; duplicate tick and restart do not replay a slot', async t => {
  let posts = 0; const f = setup(t, () => posts++);
  f.storage.saveSources([source]);
  const scheduler = new Scheduler(f.config, f.dashboard);
  scheduler.update({ enabled: false, cron: '* * * * *' });
  scheduler.update({ enabled: true, cron: '* * * * *' }, 'opening');
  await scheduler.tick(); assert.equal(posts, 0);
  t.mock.timers.setTime(start + 60000);
  await Promise.all([scheduler.tick(), scheduler.tick()]);
  assert.equal(posts, 1); assert.equal(scheduler.snapshot().opening?.result, 'completed');
  assert.equal(f.storage.claimRun('opening', start + 60000), null);
  const restarted = new Scheduler(f.config, f.dashboard);
  await restarted.tick(); assert.equal(posts, 1);
  assert.equal(restarted.snapshot().opening?.last_run, new Date(start + 60000).toISOString());
});
test('invalid opening configuration leaves reads available and opening disabled', async t => {
  let posts = 0; const f = setup(t, () => posts++);
  writeFileSync(f.config.path, '[opening]\nenabled = true\ncron = not-a-cron\n');
  const scheduler = new Scheduler(f.config, f.dashboard);
  assert.equal(scheduler.snapshot().opening?.enabled, false);
  assert.equal(scheduler.snapshot().opening?.result, 'invalid');
  await f.dashboard.refreshSources(); await scheduler.tick(); assert.equal(posts, 0);
  assert.throws(() => scheduler.update({ enabled: true, cron: 'invalid' }, 'opening'));
});
test('interrupted runs remain unknown and cannot be claimed after recovery; empty automatic input never stops orders', async t => {
  let posts = 0; const f = setup(t, () => posts++);
  const id = f.storage.claimRun('opening', start)!;
  const scheduler = new Scheduler(f.config, f.dashboard);
  assert.equal(f.storage.run(id)?.state, 'unknown');
  assert.equal(f.storage.claimRun('opening', start), null);
  scheduler.update({ enabled: false, cron: '* * * * *' });
  scheduler.update({ enabled: true, cron: '* * * * *' }, 'opening');
  t.mock.timers.setTime(start + 60000); await scheduler.tick();
  assert.equal(scheduler.snapshot().opening?.result, 'failed'); assert.equal(posts, 0);
});
test('turning off opening during live reads revokes permission immediately before POST', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  let posts = 0, revoke = () => {};
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { posts++; return response({ code: 0, data: { id: '123' } }); }
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list([]));
    revoke(); return response([]);
  });
  f.storage.saveSources([source]); const scheduler = new Scheduler(f.config, f.dashboard);
  scheduler.update({ enabled: false, cron: '* * * * *' });
  scheduler.update({ enabled: true, cron: '* * * * *' }, 'opening');
  revoke = () => { scheduler.update({ enabled: false, cron: '* * * * *' }, 'opening'); };
  t.mock.timers.setTime(start + 60000); await scheduler.tick();
  assert.equal(posts, 0); assert.equal(f.storage.intents().length, 0);
  assert.equal(scheduler.snapshot().opening?.result, 'failed');
});
