// Remote CI only: reproduce Gate's integer response truncating 0.9/0.1 fills to zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, list } from './helpers.ts';
import { syncEntries, fillDirection } from '../../apps/server/src/services/entry-history.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { Dashboard } from '../../apps/server/src/services/dashboard.ts';

const now = new Date('2026-11-03T00:00:00Z').getTime();
const fills = [
  { trade_id: '90071992547409930', contract: 'SOL_USDT', size: '0.9', close_size: '0', create_time: String(now / 1000 - 60.0546) },
  { trade_id: '90071992547409931', contract: 'SOL_USDT', size: '0.1', close_size: '0', create_time: String(now / 1000 - 60.0546) },
  { trade_id: '90071992547409932', contract: 'SNDK_USDT', size: '9', close_size: '0', create_time: String(now / 1000 - 120) },
  { trade_id: '90071992547409933', contract: 'SPCX_USDT', size: '-104', close_size: '-104', create_time: String(now / 1000 - 180) }
];
const position = { entry_price: '100', initial_margin: '1', leverage_max: '20', unrealised_pnl: '0', realised_pnl: '0', mark_price: '101' };

function historyPage(url: URL, init: RequestInit) {
  assert.equal(init.method, 'GET');
  const precise = new Headers(init.headers).get('X-Gate-Size-Decimal') === '1';
  return response(url.searchParams.get('offset') === '0' ? fills.map(row => ({ ...row, size: precise ? row.size : String(Math.trunc(Number(row.size))) })) : []);
}

test('47 fractional fills survive the real HTTP parser, paginated history, deduplication and margin capture', async t => {
  const offsets: string[] = [];
  const f = fixture(t, async (url, init) => {
    if (url.pathname.endsWith('/positions')) return response([{ ...position, contract: 'SOL_USDT', size: '1' }, { ...position, contract: 'SNDK_USDT', size: '19' }]);
    offsets.push(url.searchParams.get('offset')!);
    return historyPage(url, init);
  });
  assert.equal(await syncEntries(f.gate, f.storage, now), true);
  assert.equal(await syncEntries(f.gate, f.storage, now + 1000), false);
  assert.deepEqual(offsets, ['0', '4', '0', '4']);
  const entries = f.storage.rows('position_entry_history', 'entry_time,event_id');
  assert.equal(entries.length, 3);
  assert.equal(entries.filter(row => row.contract === 'SOL_USDT').length, 2);
  assert.equal(entries.find(row => String(row.event_id).endsWith(':90071992547409931'))?.initial_margin, '1');
  assert.equal(entries.find(row => String(row.event_id).endsWith(':90071992547409930'))?.initial_margin, null);
  assert.equal(entries[2].entry_time, Math.floor(Number(fills[0].create_time) * 1000));
  assert.equal(f.storage.watermark(f.gate.owner), now + 1000);
});

test('47 maintenance records fractional SOL entries, creates its close order and adjusts SNDK from 10 to 19 once', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let orders: Record<string, unknown>[] = [{ id: '88', contract: 'SNDK_USDT', amount: '-10', activation_price: '101', reduce_only: true,
    original_status: 1, price_type: 3, price_offset: '1%', is_gte: true, pos_margin_mode: 'cross', position_mode: 'dual_plus' }];
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/stop')) orders = orders.filter(row => row.id !== String(body.id));
      else orders.push({ ...body, id: String(100 + writes.length), original_status: 1 });
      return response({ code: 0, data: { id: String(100 + writes.length) } });
    }
    if (url.pathname.includes('my_trades_timerange')) return historyPage(url, init);
    if (url.pathname.endsWith('/positions')) return response([{ ...position, contract: 'SOL_USDT', size: '1' }, { ...position, contract: 'SNDK_USDT', size: '19' }]);
    if (url.pathname.includes('/contracts/')) return response({ name: url.pathname.split('/').at(-1), quanto_multiplier: '0.1', order_price_round: '0.01' });
    return response(list(url.searchParams.get('page_num') === '1' ? orders : []));
  });
  const scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.storage.lastRun('maintenance')?.state, 'completed');
  assert.equal(f.storage.rows('position_entry_history', 'event_id').length, 3);
  assert.equal(writes.filter(row => row.path.endsWith('/stop')).length, 1);
  const creates = writes.filter(row => row.path.endsWith('/create'));
  assert.equal(creates.length, 2);
  assert.deepEqual(creates.map(row => [row.body.contract, row.body.amount]), [['SOL_USDT', '-1'], ['SNDK_USDT', '-19']]);
  assert.ok(creates.every(row => row.body.reduce_only === true && row.body.price_offset === '1%' && row.body.position_mode === 'dual_plus'));
  t.mock.timers.setTime(now + 1200000); await scheduler.tick();
  assert.equal(writes.length, 3, 'repeat poll must preserve both matching close orders');
  assert.equal(f.dashboard.orders().error, null);
});

test('47 failed maintenance stays visible after ordinary refresh and restart, until maintenance succeeds', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  let fail = true, posts = 0;
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') posts++;
    if (url.pathname.includes('my_trades_timerange')) return response(fail ? {} : [], fail ? 503 : 200);
    return response(url.pathname.endsWith('/list') ? list([]) : []);
  });
  let scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.match(f.dashboard.orders().error!, /Gate HTTP 503/);
  assert.equal(f.storage.watermark(f.gate.owner), -1);
  await f.dashboard.refreshOrders();
  assert.match(f.dashboard.orders().error!, /Gate HTTP 503/, 'a successful minute refresh must not hide maintenance failure');
  const restarted = new Dashboard(f.config, f.storage, f.http, f.activity);
  scheduler = new Scheduler(f.config, restarted);
  assert.match(restarted.orders().error!, /Gate HTTP 503/);
  fail = false; t.mock.timers.setTime(now + 1200000); await scheduler.tick();
  assert.equal(restarted.orders().error, null);
  assert.equal(posts, 0);
  assert.equal(f.storage.lastRun('maintenance')?.state, 'completed');
});

test('47 decimal close and reversal classification keeps exact signs and rejects genuine zero/conflict', () => {
  assert.equal(fillDirection('0.9', '0'), 1);
  assert.equal(fillDirection('-0.1', '0'), -1);
  assert.equal(fillDirection('0.9', '0.9'), null);
  assert.equal(fillDirection('-0.1', '-0.9'), null);
  assert.equal(fillDirection('0.9', '0.1'), 1);
  assert.equal(fillDirection('-0.9', '-0.1'), -1);
  assert.throws(() => fillDirection('0', '0'));
  assert.throws(() => fillDirection('0.9', '-0.1'));
});

for (const failure of ['http', 'zero', 'conflict'] as const) {
  test(`47 ${failure} on a later history page rolls back the batch and prevents close maintenance`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now });
    let posts = 0;
    const f = fixture(t, async (url, init) => {
      if (init.method === 'POST') posts++;
      assert.ok(url.pathname.includes('my_trades_timerange'), 'history failure must prevent later exchange work');
      assert.equal(new Headers(init.headers).get('X-Gate-Size-Decimal'), '1');
      if (url.searchParams.get('offset') === '0') return response([fills[0]]);
      if (failure === 'http') return response({}, 503);
      return response([{ ...fills[1], size: failure === 'zero' ? '0' : '0.1', close_size: failure === 'zero' ? '0' : '-0.1' }]);
    });
    const scheduler = new Scheduler(f.config, f.dashboard);
    t.mock.timers.setTime(now + 600000); await scheduler.tick();
    assert.equal(f.storage.lastRun('maintenance')?.state, 'failed');
    assert.equal(f.storage.watermark(f.gate.owner), -1);
    assert.equal(f.storage.rows('position_entry_history', 'event_id').length, 0);
    assert.equal(f.storage.rows('position_entry_margin', 'contract').length, 0);
    assert.equal(posts, 0);
    assert.equal(f.dashboard.gateBusy, false);
  });
}
