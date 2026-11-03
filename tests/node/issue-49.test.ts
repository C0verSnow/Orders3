// Remote CI only. Real HTTP parsing and SQLite; all exchange requests are fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, list } from './helpers.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { fillDirection } from '../../apps/server/src/services/entry-history.ts';

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
