// Remote CI only: real Dashboard, Gate parser and temporary SQLite; no live trading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, source, list } from './helpers.ts';
import { setImmediate } from 'node:timers/promises';
import { writeExchange } from '../../apps/server/src/services/trading.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';

const old = { id: '1212571', contract: 'SPX500_USDT', amount: '16', activation_price: '7223.75', reduce_only: false, original_status: 1 };
const protection = { ...old, id: '1204103', contract: 'SNDK_USDT', amount: '-19', reduce_only: true };

for (const items of [[], [{ ...source, contract: null, activation_price: null, amount: null, side: null }]]) {
  test(`price#18 source refresh clears live stale openings for ${items.length ? 'timestamp-only' : 'empty'} input, without creating`, async t => {
    const posts: string[] = [];
    const activated = { ...old, id: '3', original_status: 2 };
    const f = fixture(t, async (url, init) => {
      if (url.hostname === 'supabase.invalid') return response(url.searchParams.get('offset') === '0' ? items : []);
      if (init.method === 'POST') { posts.push(`${url.pathname} ${init.body}`); return response({ code: 0, data: {} }); }
      if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' ? [old, protection, activated] : []));
      throw new Error(`unexpected request ${url.pathname}`);
    });
    f.storage.saveSources([source]);
    assert.equal(f.storage.trailing().length, 0, 'must use the live Gate list even with an empty local cache');
    assert.equal(f.config.schedule('opening').enabled, false);
    await f.dashboard.refreshSources();
    assert.equal(f.dashboard.sources().orders.length, 0);
    assert.deepEqual(posts, [`/api/v4/futures/usdt/autoorder/v1/trail/stop {"id":1212571}`]);
    assert.equal(f.storage.trailing().find(row => row.id === old.id)?.original_status, 5);
    assert.equal(f.storage.trailing().find(row => row.id === protection.id)?.original_status, 1);
    assert.equal(f.storage.trailing().find(row => row.id === activated.id)?.original_status, 2);
    assert.equal(f.dashboard.sources().execution[0].action, 'stopped');
    assert.equal(f.dashboard.sources().phase, 'completed');
    assert.equal(f.storage.intents().length, 0);
  });
}

test('price#18 partial refresh keeps the matching order, removes absent orders and leaves new predictions for opening', async t => {
  const posts: string[] = [];
  const matching = { ...old, id: '4', contract: 'BTC_USDT', amount: '2', activation_price: '100.5' };
  const items = [source, { ...source, id: '2', contract: 'ETH_USDT' }];
  const f = fixture(t, async (url, init) => {
    if (url.hostname === 'supabase.invalid') return response(url.searchParams.get('offset') === '0' ? items : []);
    if (url.pathname.includes('/contracts/')) return response({ name: url.pathname.split('/').at(-1), quanto_multiplier: '0.1', order_price_round: '0.5' });
    if (init.method === 'POST') { posts.push(`${url.pathname} ${init.body}`); return response({ code: 0, data: {} }); }
    if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' ? [matching, old, protection] : []));
    throw new Error(`unexpected request ${url.pathname}`);
  });
  await f.dashboard.refreshSources();
  assert.deepEqual(posts, [`/api/v4/futures/usdt/autoorder/v1/trail/stop {"id":1212571}`]);
  assert.equal(f.storage.trailing().find(row => row.id === matching.id)?.original_status, 1);
  assert.equal(f.storage.trailing().find(row => row.id === protection.id)?.original_status, 1);
  assert.ok(f.dashboard.sources().execution.some(row => row.id === matching.id && row.action === 'skipped'));
  assert.ok(!f.dashboard.sources().execution.some(row => row.action === 'created'));
});

test('price#18 scheduled opening with empty predictions still removes stale orders', async t => {
  const start = new Date('2026-11-09T13:59:00Z').getTime();
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const posts: string[] = [];
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { posts.push(url.pathname); return response({ code: 0, data: {} }); }
    return response(list(url.searchParams.get('page_num') === '1' ? [old, protection] : []));
  });
  f.storage.saveSources([]);
  const scheduler = new Scheduler(f.config, f.dashboard);
  scheduler.update({ enabled: false, cron: '* * * * *' });
  scheduler.update({ enabled: true, cron: '* * * * *' }, 'opening');
  t.mock.timers.setTime(start + 60_000);
  await scheduler.tick();
  assert.equal(scheduler.snapshot().opening?.result, 'completed');
  assert.deepEqual(posts, ['/api/v4/futures/usdt/autoorder/v1/trail/stop']);
  assert.equal(f.storage.trailing().find(row => row.id === old.id)?.original_status, 5);
  assert.equal(f.storage.trailing().find(row => row.id === protection.id)?.original_status, 1);
});

test('price#18 failed source fetch preserves prior predictions and sends no Gate requests', async t => {
  let gateReads = 0;
  const f = fixture(t, async url => {
    if (url.hostname === 'supabase.invalid') return response({}, 503);
    gateReads++; throw new Error('must not reconcile failed input');
  });
  f.storage.saveSources([source]);
  await assert.rejects(f.dashboard.refreshSources(), /抓取失败，保留上次数据/);
  assert.equal(f.storage.sources().orders.length, 1);
  assert.equal(gateReads, 0);
});

test('price#18 ambiguous cancellation keeps new predictions, reports cleanup failure and never retries the write', async t => {
  let posts = 0;
  const f = fixture(t, async (url, init) => {
    if (url.hostname === 'supabase.invalid') return response([]);
    if (init.method === 'POST') { posts++; throw new Error('response lost'); }
    return response(list(url.searchParams.get('page_num') === '1' ? [old] : []));
  });
  f.storage.saveSources([source]);
  await assert.rejects(f.dashboard.refreshSources(), /预测已更新.*清理失败/);
  assert.equal(f.storage.sources().orders.length, 0);
  assert.equal(f.storage.intents()[0].state, 'unknown');
  assert.equal(f.dashboard.sources().execution[0].action, 'failed');
  assert.equal(f.dashboard.sourcesBusy || f.dashboard.gateBusy, false);
  await assert.rejects(f.dashboard.refreshSources(), /结果未知/);
  assert.equal(posts, 1);
});

test('price#18 source cleanup waits for existing Gate work and reserves the Gate slot', async t => {
  let release!: (value: Response) => void, first = true, posts = 0;
  const f = fixture(t, async (url, init) => {
    if (url.hostname === 'supabase.invalid') return response([]);
    if (init.method === 'POST') { posts++; return response({ code: 0, data: {} }); }
    if (first) { first = false; return new Promise<Response>(done => { release = done; }); }
    return response(list(url.searchParams.get('page_num') === '1' ? [old] : []));
  });
  const read = f.dashboard.refreshOrders(false);
  const refresh = f.dashboard.refreshSources();
  try {
    for (let i = 0; i < 10; i++) await setImmediate();
    assert.equal(f.dashboard.sources().phase, 'reconciling');
    assert.equal(posts, 0);
    await assert.rejects(f.dashboard.refreshOrders(false), /正在运行/);
    await assert.rejects(f.dashboard.executeOpening({ kind: 'manual' }), /本次开仓跳过/);
  } finally { release(response(list([]))); await Promise.all([read, refresh]); }
  assert.equal(posts, 1);
  assert.equal(f.dashboard.sourcesBusy || f.dashboard.gateBusy, false);
});

test('price#18 source cleanup authorization cannot create an order or persist a create intent', async t => {
  let posts = 0;
  const f = fixture(t, async () => { posts++; return response({ code: 0 }); });
  await assert.rejects(writeExchange(f.gate, f.storage, 'create', '{}', () => {}, { kind: 'source-cleanup' }), /只允许撤销/);
  assert.equal(posts, 0); assert.equal(f.storage.intents().length, 0);
});
