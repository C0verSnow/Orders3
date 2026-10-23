// Remote CI only. Real SQLite, fake exchange; no live account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, list } from './helpers.ts';
import { syncEntries } from '../../apps/server/src/services/entry-history.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { Storage } from '../../apps/server/src/database/index.ts';
const now = new Date('2026-10-23T12:00:00Z').getTime();
const position = { contract: 'BTC_USDT', size: '2', entry_price: '100', initial_margin: '1.25', leverage_max: '20', unrealised_pnl: '0', realised_pnl: '0', mark_price: '101' };
const rule = { name: 'BTC_USDT', quanto_multiplier: '0.1', order_price_round: '0.5' };
const fill = { trade_id: '900', contract: 'BTC_USDT', size: '2', close_size: '0', create_time: String(now / 1000 - 60) };

test('43 independent ten-minute poll runs with opening off and no sources', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  let fills = 0;
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { assert.equal(JSON.parse(String(init.body)).reduce_only, true); return response({ code: 0, data: { id: '99' } }); }
    if (url.pathname.includes('my_trades_timerange')) { fills++; return response(url.searchParams.get('offset') === '0' ? [fill] : []); }
    if (url.pathname.endsWith('/positions')) return response([position]);
    if (url.pathname.includes('/contracts/')) return response(rule);
    return response(list([]));
  });
  const scheduler = new Scheduler(f.config, f.dashboard);
  assert.equal(scheduler.snapshot().opening?.enabled, false);
  await scheduler.tick(new Date(now + 599999)); assert.equal(fills, 0);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.ok(fills > 0); assert.equal(f.storage.entrySeen(f.gate.owner, '900'), true);
});

test('43 missing margin is filled on later poll without a new fill and stays fixed after restart', async t => {
  let positions: typeof position[] = [];
  const f = fixture(t, async url => response(url.pathname.endsWith('/positions') ? positions : url.searchParams.get('offset') === '0' ? [fill] : []));
  await syncEntries(f.gate, f.storage, now);
  assert.equal(f.storage.rows('position_entry_history', 'entry_time')[0].initial_margin, null);
  positions = [position]; await syncEntries(f.gate, f.storage, now + 1000);
  assert.equal(f.storage.rows('position_entry_history', 'entry_time')[0].initial_margin, '1.25');
  const reopened = new Storage(f.storage.path); t.after(() => reopened.close());
  positions = [{ ...position, initial_margin: '99' }]; await syncEntries(f.gate, reopened, now + 2000);
  assert.equal(reopened.rows('position_entry_history', 'entry_time').length, 1);
  assert.equal(reopened.rows('position_entry_history', 'entry_time')[0].initial_margin, '1.25');
});

test('43 failed position query does not advance successful sync and later cycle retries', async t => {
  let fail = true;
  const f = fixture(t, async url => {
    if (url.pathname.endsWith('/positions')) return response(fail ? {} : [position], fail ? 503 : 200);
    return response(url.searchParams.get('offset') === '0' ? [fill] : []);
  });
  await assert.rejects(syncEntries(f.gate, f.storage, now));
  assert.equal(f.storage.watermark(f.gate.owner), -1);
  fail = false; await syncEntries(f.gate, f.storage, now + 1000);
  assert.equal(f.storage.watermark(f.gate.owner), now + 1000);
  assert.equal(f.storage.rows('position_entry_history', 'entry_time').length, 1);
});

function tradingFixture(t: Parameters<typeof fixture>[0], options: { unknown?: boolean; unknownStop?: boolean; activated?: boolean; short?: boolean; missingPolicy?: boolean; changedPosition?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now });
  const writes: Record<string, unknown>[] = [];
  const pos = { ...position, initial_margin: '1', size: options.short ? '-2' : '2' };
  let live: Record<string, unknown>[] = options.activated || options.missingPolicy ? [{ id: '88', contract: 'BTC_USDT', amount: options.short ? '2' : '-2', activation_price: '110', reduce_only: true, original_status: options.activated ? 2 : 1 }] : [];
  let reads = 0;
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      if (options.unknown || (options.unknownStop && url.pathname.endsWith('/stop'))) throw new Error('response lost');
      if (url.pathname.endsWith('/stop')) live = live.filter(row => row.id !== String(body.id));
      else live.push({ ...body, id: String(100 + writes.length), original_status: 1 });
      return response({ code: 0, data: { id: String(100 + writes.length) } });
    }
    if (url.pathname.endsWith('/positions')) { reads++; return response([{ ...pos, ...(options.changedPosition && reads >= 4 ? { size: options.short ? '-1' : '1' } : {}) }]); }
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' ? live : []));
    return response([]);
  });
  return { ...f, writes, setPosition: (value: Partial<typeof pos>) => Object.assign(pos, value), orders: () => live };
}

test('43 close-only maintenance creates long/short policy once across repeated polls and restart', async t => {
  for (const short of [false, true]) {
    const f = tradingFixture(t, { short });
    let scheduler = new Scheduler(f.config, f.dashboard);
    t.mock.timers.setTime(now + 600000); await scheduler.tick();
    assert.equal(f.writes.length, 1);
    assert.deepEqual({ amount: f.writes[0].amount, reduce: f.writes[0].reduce_only, price: f.writes[0].activation_price, is_gte: f.writes[0].is_gte, offset: f.writes[0].price_offset },
      { amount: short ? '2' : '-2', reduce: true, price: short ? '83.5' : '116.5', is_gte: !short, offset: '1%' });
    assert.equal(f.dashboard.orders().close_execution[0].action, 'created');
    t.mock.timers.setTime(now + 1200000); await scheduler.tick();
    assert.equal(f.writes.length, 1);
    scheduler = new Scheduler(f.config, f.dashboard);
    t.mock.timers.setTime(now + 1800000); await scheduler.tick();
    assert.equal(f.writes.length, 1);
    assert.equal(f.dashboard.orders().close_execution[0].action, 'skipped');
    // Per-subcase fixture resets Date to the shared baseline.
    t.mock.timers.reset();
  }
});

test('43 activated order blocks same-side replacement even with mismatched quantity/price', async t => {
  const f = tradingFixture(t, { activated: true }), scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.writes.length, 0); assert.equal(f.orders()[0].id, '88');
  assert.match(f.dashboard.orders().close_execution[0].message!, /激活/);
});

test('43 unknown close creation remains blocked in later cycles and after restart', async t => {
  const f = tradingFixture(t, { unknown: true }); let scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.writes.length, 1); assert.equal(f.storage.intents()[0].state, 'unknown');
  scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 1200000); await scheduler.tick();
  assert.equal(f.writes.length, 1); assert.equal(f.storage.lastRun('maintenance')?.state, 'failed');
  assert.match(f.dashboard.orders().error!, /未知/);
});

test('43 reduced position immediately before write prevents stale quantity submission', async t => {
  const f = tradingFixture(t, { changedPosition: true }), scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.writes.length, 0); assert.match(f.dashboard.orders().error!, /持仓已变化/);
});

test('43 incomplete exchange order metadata is visible failure, never a duplicate create', async t => {
  const f = tradingFixture(t, { missingPolicy: true }), scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.writes.length, 0); assert.match(f.dashboard.orders().error!, /策略字段/);
});

test('43 pending close order adjusts after partial reduction with fixed margin', async t => {
  const f = tradingFixture(t), scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  f.setPosition({ size: '1', initial_margin: '999' });
  t.mock.timers.setTime(now + 1200000); await scheduler.tick();
  assert.equal(f.writes.length, 3); assert.ok(f.writes[1].id);
  assert.equal(f.writes[2].amount, '-1'); assert.equal(f.writes[2].activation_price, '132.5');
});

test('43 margin backfill is account/contract/side isolated; same-time trade IDs use numeric ordering', t => {
  const { storage } = fixture(t);
  storage.history('owner-a', [
    { event_id: '9', entry_time: now - 1, contract: 'BTC_USDT', side: 1 },
    { event_id: '10', entry_time: now - 1, contract: 'BTC_USDT', side: 1 },
    { event_id: '11', entry_time: now - 1, contract: 'BTC_USDT', side: -1 }
  ], now, [{ contract: 'BTC_USDT', side: 1, initial_margin: '2' }]);
  storage.history('owner-b', [{ event_id: '10', entry_time: now - 1, contract: 'BTC_USDT', side: 1 }], now,
    [{ contract: 'BTC_USDT', side: 1, initial_margin: '5' }]);
  const events = storage.rows('position_entry_history', 'event_id');
  assert.equal(events.find(row => row.event_id === 'owner-a:9')?.initial_margin, null);
  assert.equal(events.find(row => row.event_id === 'owner-a:10')?.initial_margin, '2');
  assert.equal(events.find(row => row.event_id === 'owner-a:11')?.initial_margin, null);
  assert.equal(events.find(row => row.event_id === 'owner-b:10')?.initial_margin, '5');
});

test('43 maintenance API failure is persisted as failed and next ten-minute cycle retries', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  let fail = true, calls = 0;
  const f = fixture(t, async url => {
    if (url.pathname.includes('my_trades_timerange')) { calls++; return response(fail ? {} : [], fail ? 503 : 200); }
    return response(url.pathname.endsWith('/list') ? list([]) : []);
  });
  const scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.storage.lastRun('maintenance')?.state, 'failed');
  assert.equal(f.storage.watermark(f.gate.owner), -1);
  fail = false;
  t.mock.timers.setTime(now + 1200000); await scheduler.tick();
  assert.equal(calls, 2); assert.equal(f.storage.lastRun('maintenance')?.state, 'completed');
  assert.equal(f.storage.watermark(f.gate.owner), now + 1200000);
});

test('43 unknown stop never creates replacement or retries the stop after restart', async t => {
  const f = tradingFixture(t, { unknownStop: true }); let scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  f.setPosition({ size: '1' });
  t.mock.timers.setTime(now + 1200000); await scheduler.tick();
  assert.equal(f.writes.length, 2); assert.ok(f.writes[1].id);
  assert.equal(f.storage.intents()[0].operation, 'stop'); assert.equal(f.storage.intents()[0].state, 'unknown');
  scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 1800000); await scheduler.tick();
  assert.equal(f.writes.length, 2);
});
