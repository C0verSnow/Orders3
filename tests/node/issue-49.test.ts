// Remote CI only. Real HTTP parsing and SQLite; all exchange requests are fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, list } from './helpers.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { fillDirection } from '../../apps/server/src/services/entry-history.ts';
import { Dashboard } from '../../apps/server/src/services/dashboard.ts';
import { AppError } from '../../apps/server/src/utils/errors.ts';

const now = new Date('2026-11-03T02:00:00Z').getTime();
const position = { contract: 'SOL_USDT', size: '19', entry_price: '100', initial_margin: '1', leverage_max: '20', unrealised_pnl: '0', realised_pnl: '0', mark_price: '101' };
const rule = { name: 'SOL_USDT', quanto_multiplier: '0.1', order_price_round: '0.01' };

test('49 closing uses the synchronized long/short position snapshot, never the sum of fractional entry fills', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const writes: Record<string, unknown>[] = [];
  let reads = 0;
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      return response({ code: 0, data: { id: String(100 + writes.length) } });
    }
    if (url.pathname.includes('my_trades_timerange')) return response(url.searchParams.get('offset') === '0' ? [
      { trade_id: '91', contract: 'SOL_USDT', size: '0.9', close_size: '0', create_time: String(now / 1000 - 60) },
      { trade_id: '92', contract: 'SOL_USDT', size: '0.1', close_size: '0', create_time: String(now / 1000 - 60) }
    ] : []);
    if (url.pathname.endsWith('/positions')) {
      reads++;
      return response([position, { ...position, size: '-7' }]);
    }
    if (url.pathname.includes('/contracts/')) return response(rule);
    return response(list([]));
  });
  const scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.storage.lastRun('maintenance')?.state, 'completed');
  assert.deepEqual(writes.map(row => row.amount), ['-19', '7']);
  assert.ok(writes.every(row => row.reduce_only === true));
  assert.deepEqual(f.storage.rawPositions().map(row => row.size), ['-7', '19']);
  assert.equal(reads, 4, 'one history observation, one synchronized snapshot, one live recheck per close create');
});

for (const actualSize of ['0.9', '-0.9', '1.9', '-1.9']) {
  test(`49 exact position ${actualSize} must fail without truncating or writing a close order`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now });
    let posts = 0;
    const f = fixture(t, async (url, init) => {
      if (init.method === 'POST') posts++;
      if (url.pathname.endsWith('/positions')) {
        const precise = new Headers(init.headers).get('X-Gate-Size-Decimal') === '1';
        return response([{ ...position, size: precise ? actualSize : String(Math.trunc(Number(actualSize))) }]);
      }
      if (url.pathname.includes('/contracts/')) return response(rule);
      return response(url.pathname.endsWith('/list') ? list([]) : []);
    });
    const scheduler = new Scheduler(f.config, f.dashboard);
    t.mock.timers.setTime(now + 600000); await scheduler.tick();
    assert.equal(f.storage.lastRun('maintenance')?.state, 'failed');
    assert.match(f.dashboard.orders().error!, /持仓.*size.*整数/);
    assert.equal(posts, 0);
    assert.equal(f.storage.watermark(f.gate.owner), -1);
  });
}

test('49 zero fill and conflicting directions report distinct reasons', () => {
  assert.throws(() => fillDirection('0', '0'), /成交历史 size 不能为零/);
  assert.throws(() => fillDirection('0.9', '-0.1'), /成交历史 size 与 close_size 方向冲突/);
});

function historyFailureFixture(t: Parameters<typeof fixture>[0], options: { unknown?: boolean; changed?: boolean; positionsFail?: boolean; noMargin?: boolean; short?: boolean; legacyMargin?: boolean } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now });
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let failHistory = true, reads = 0, orders: Record<string, unknown>[] = [];
  const pos = { ...position, size: options.short ? '-19' : '19' };
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)); writes.push({ path: url.pathname, body });
      if (url.pathname.endsWith('/stop')) orders = orders.filter(row => row.id !== String(body.id));
      else orders.push({ ...body, id: String(100 + writes.length), original_status: 1 });
      return response({ code: 0, data: { id: String(100 + writes.length) } });
    }
    if (url.pathname.includes('my_trades_timerange')) return response(failHistory ? {} : [], failHistory ? 503 : 200);
    if (url.pathname.endsWith('/positions')) {
      reads++;
      return response(options.positionsFail ? {} : [{ ...pos, ...(options.changed && reads >= 2 ? { size: options.short ? '-18' : '18' } : {}) },
        { ...position, contract: 'BTC_USDT', size: '2' }], options.positionsFail ? 503 : 200);
    }
    if (url.pathname.includes('/contracts/')) return response({ ...rule, name: url.pathname.split('/').at(-1) });
    return response(list(url.searchParams.get('page_num') === '1' ? orders : []));
  });
  if (!options.noMargin) {
    if (options.legacyMargin) f.storage.fixedMargin(f.gate.owner, 'SOL_USDT', options.short ? -1 : 1, '1');
    else f.storage.history(f.gate.owner, [{ event_id: '80', entry_time: now - 1000, contract: 'SOL_USDT', side: options.short ? -1 : 1, initial_margin: '1' }], now);
  }
  if (options.unknown) f.storage.intent('create', '{}', f.gate.owner);
  return { ...f, writes, recover: () => { failHistory = false; }, setOrders: (value: Record<string, unknown>[]) => { orders = value; } };
}

for (const short of [false, true]) {
  test(`49 history failure still closes ${short ? 'short' : 'long'} live quantity with confirmed fixed margin, skips missing margin and persists warning`, async t => {
    const f = historyFailureFixture(t, { short });
    let scheduler = new Scheduler(f.config, f.dashboard);
    t.mock.timers.setTime(now + 600000); await scheduler.tick();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].body.amount, short ? '19' : '-19');
    assert.equal(f.writes[0].body.reduce_only, true);
    assert.equal(f.storage.lastRun('maintenance')?.state, 'failed', 'partial success must not hide history failure');
    assert.equal(f.storage.watermark(f.gate.owner), now);
    assert.equal(f.storage.entryMargin(f.gate.owner, 'BTC_USDT', 1), null);
    assert.equal(f.storage.rows('position_entry_margin', 'contract').length, 1, 'failed history must not capture a new fixed margin');
    assert.ok(f.dashboard.closeExecution.some(row => row.contract === 'BTC_USDT' && row.action === 'failed' && /固定保证金/.test(row.error!)));
    assert.match(f.dashboard.orders().error!, /入仓历史同步失败.*Gate HTTP 503/);
    assert.match(f.dashboard.orders().error!, /固定保证金/);
    await f.dashboard.refreshOrders();
    assert.match(f.dashboard.orders().error!, /入仓历史同步失败/);
    const restarted = new Dashboard(f.config, f.storage, f.http, f.activity);
    assert.match(restarted.orders().error!, /入仓历史同步失败/);
    scheduler = new Scheduler(f.config, restarted);
    t.mock.timers.setTime(now + 1200000); await scheduler.tick();
    assert.equal(f.writes.length, 1, 'repeat failure preserves matching close order');
    f.recover();
    t.mock.timers.setTime(now + 1800000); await scheduler.tick();
    assert.equal(f.writes.length, 2, 'recovery also permits first confirmed margin for previously skipped position');
    assert.equal(restarted.orders().error, null);
    assert.equal(f.storage.lastRun('maintenance')?.state, 'completed');
  });
}

for (const block of ['unknown', 'changed', 'positionsFail', 'noMargin'] as const) {
  test(`49 history fallback preserves ${block} write protection`, async t => {
    const f = historyFailureFixture(t, { [block]: true });
    const scheduler = new Scheduler(f.config, f.dashboard);
    t.mock.timers.setTime(now + 600000); await scheduler.tick();
    assert.equal(f.writes.length, 0);
    assert.equal(f.storage.lastRun('maintenance')?.state, 'failed');
    assert.match(f.dashboard.orders().error!, /入仓历史同步失败/);
    assert.equal(f.dashboard.gateBusy, false);
    if (block === 'noMargin') assert.equal(f.storage.rows('position_entry_margin', 'contract').length, 0);
    if (block === 'unknown') assert.match(f.dashboard.orders().error!, /未知/);
    if (block === 'changed') assert.match(f.dashboard.orders().error!, /持仓已变化/);
  });
}

test('49 history fallback may reuse a previously fixed legacy margin without resetting it', async t => {
  const f = historyFailureFixture(t, { legacyMargin: true });
  const scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.writes.length, 1);
  assert.equal(f.storage.rows('position_entry_history', 'event_id').length, 0);
});

test('49 a database history commit failure aborts maintenance rather than falling back to trading', async t => {
  const f = historyFailureFixture(t);
  f.recover();
  t.mock.method(f.storage, 'history', () => { throw new AppError('数据库写入失败'); });
  const scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.writes.length, 0);
  assert.match(f.dashboard.orders().error!, /数据库写入失败/);
  assert.equal(f.storage.watermark(f.gate.owner), now);
});

test('49 fallback never takes another account or direction fixed margin', async t => {
  const f = historyFailureFixture(t, { noMargin: true });
  f.storage.fixedMargin('another-owner', 'SOL_USDT', 1, '1');
  f.storage.fixedMargin(f.gate.owner, 'SOL_USDT', -1, '1');
  f.storage.fixedMargin(f.gate.owner, 'ETH_USDT', 1, '1');
  const scheduler = new Scheduler(f.config, f.dashboard);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.equal(f.writes.length, 0);
  assert.ok(f.dashboard.closeExecution.every(row => row.action === 'failed' && /固定保证金/.test(row.error!)));
});

for (const status of [1, 2]) {
  test(`49 history fallback retains existing status ${status} close order when policy is incomplete or already activated`, async t => {
    const f = historyFailureFixture(t);
    f.setOrders([{ id: '88', contract: 'SOL_USDT', amount: '-19', activation_price: '101', reduce_only: true, original_status: status }]);
    const scheduler = new Scheduler(f.config, f.dashboard);
    t.mock.timers.setTime(now + 600000); await scheduler.tick();
    assert.equal(f.writes.length, 0);
    const result = f.dashboard.closeExecution.find(row => row.contract === 'SOL_USDT')!;
    assert.equal(result.action, status === 2 ? 'skipped' : 'failed');
  });
}
