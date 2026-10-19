// Executed only by the existing remote CI workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, source, list } from './helpers.ts';
import { openOrders, closeOrders } from '../../apps/server/src/services/trading.ts';
import { sourceOrder, legacyOrders } from '../../apps/server/src/services/source-parser.ts';
import { decimal, two } from '../../packages/decimal/index.ts';

const rule = { name: 'BTC_USDT', quanto_multiplier: '0.1', order_price_round: '0.0001' };
const position = { contract: 'BTC_USDT', size: '2', entry_price: '100.005', leverage_max: '20', unrealised_pnl: '0.005', realised_pnl: '-0.004', initial_margin: '0', mark_price: '100.1234' };

test('source parsing and SQLite preserve high precision and the independent Supabase step', t => {
  const f = fixture(t), raw = { ...source, activation_price: '100.1234', price_round: '0.001' };
  const parsed = sourceOrder(raw, 0)!;
  assert.equal(parsed.activation_price, '100.1234'); assert.equal(parsed.amount, '2');
  assert.equal(two(decimal(parsed.activation_price).times('3')), '300.37');
  f.storage.saveSources([raw]);
  const saved = f.storage.sources().orders[0] as typeof parsed & { raw_activation_price: string };
  assert.equal(saved.activation_price, '100.12'); assert.equal(saved.raw_activation_price, '100.1234'); assert.equal(saved.price_round, '0.001');
  assert.equal(f.storage.rows('orders', 'record_position')[0].activation_price, '100.1234');
  const legacy = legacyOrders('contract: BTC_USDT\nPrice: 100.1234\nSize: 2\nTimestamp: 1700000000000\nprice_round: 0.001', 0)[0];
  assert.equal(legacy.activation_price, '100.1234'); assert.equal(legacy.price_round, '0.001');
});

test('opening sends precise aligned price and integer size, then retains equivalent exchange order', async t => {
  const posts: Record<string, unknown>[] = [];
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { posts.push(JSON.parse(String(init.body))); return response({ code: 0, data: { id: '123' } }); }
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' && posts.length ? [{ ...posts[0], id: '123', original_status: 1 }] : []));
    return response([]);
  });
  f.storage.saveSources([{ ...source, activation_price: '100.005', price_round: '0.001' }]);
  assert.equal((await openOrders(f.gate, f.storage))[0].action, 'created');
  assert.equal(posts[0].activation_price, '100.005'); assert.equal(posts[0].amount, '2');
  const row = f.storage.rows('orderslist', 'id')[0];
  assert.equal(row.raw_activation_price, '100.005'); assert.equal(row.activation_price, '100.01');
  assert.equal((await openOrders(f.gate, f.storage))[0].action, 'skipped'); assert.equal(posts.length, 1);
});

test('missing, conflicting, invalid, zero-aligned and Gate-incompatible source steps block before any POST', async t => {
  for (const orders of [
    [{ ...source, price_round: undefined }],
    [{ ...source, price_round: '0.001' }, { ...source, price_round: '0.005' }],
    [{ ...source, price_round: '0' }], [{ ...source, price_round: 'bad' }],
    [{ ...source, activation_price: '0.0001', price_round: '0.001' }],
    [{ ...source, price_round: '0.001' }, { ...source, activation_price: '100.005', price_round: '0.001' }]
  ]) {
    let posts = 0;
    const f = fixture(t, async (url, init) => { if (init.method === 'POST') posts++; return response({ ...rule, order_price_round: '0.01' }); });
    f.storage.saveSources(orders);
    await assert.rejects(openOrders(f.gate, f.storage)); assert.equal(posts, 0); assert.equal(f.storage.intents().length, 0);
  }
});

test('protection uses Supabase step, preserves formula precision and stores unrounded positions', async t => {
  const posts: Record<string, unknown>[] = [];
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { posts.push(JSON.parse(String(init.body))); return response({ code: 0, data: { id: '321' } }); }
    if (url.pathname.endsWith('/positions')) return response([position]);
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list([]));
    return response([]);
  });
  f.storage.saveSources([{ ...source, price_round: '0.001' }]);
  assert.equal((await closeOrders(f.gate, f.storage))[0].action, 'created');
  assert.equal(posts[0].activation_price, '101.005'); assert.equal(posts[0].amount, '-2');
  const stored = f.storage.rows('position', 'contract,size')[0];
  assert.equal(stored.entry_price, '100.005'); assert.equal(stored.value, '20.001'); assert.equal(stored.mark_price, '100.1234');
  assert.equal(f.storage.positions()[0].entry_price, '100.01'); assert.equal(f.storage.positions()[0].close_price, '101.01');
});

test('missing protection step preserves the last snapshot and every live order without POST', async t => {
  let posts = 0;
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') posts++;
    if (url.pathname.endsWith('/positions')) return response([position]);
    if (url.pathname.includes('/contracts/')) return response(rule);
    return response([]);
  });
  await assert.rejects(closeOrders(f.gate, f.storage), /price_round/);
  assert.equal(posts, 0); assert.equal(f.storage.updated('positions'), null);
});

test('full source refresh preserves JSON numeric Supabase step alongside independent Gate rules', async t => {
  let posted: Record<string, unknown> | undefined;
  const f = fixture(t, async (url, init) => {
    if (url.hostname === 'supabase.invalid') return url.searchParams.get('offset') === '0'
      ? new Response('[{"id":1,"contract":"BTC_USDT","activation_price":100.005,"amount":2,"order_price_round":0.001,"side":null,"timestamp":1700000000000}]') : response([]);
    if (init.method === 'POST') { posted = JSON.parse(String(init.body)); return response({ code: 0, data: { id: '456' } }); }
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list([]));
    return response([]);
  });
  await f.dashboard.refreshSources();
  assert.equal(posted?.activation_price, '100.005');
  const saved = f.storage.sources().orders[0];
  assert.equal(saved.price_round, '0.001'); assert.equal(saved.order_price_round, '0.0001');
});

test('full source refresh accepts sub-cent prices and clears a previous precision pause', async t => {
  for (const raw of ['100.005', '0.005']) {
    await t.test(raw, async t => {
      let tick = '0.01';
      const posts: Record<string, unknown>[] = [];
      const f = fixture(t, async (url, init) => {
        if (url.hostname === 'supabase.invalid') return url.searchParams.get('offset') === '0'
          ? response([{ ...source, activation_price: raw, price_round: undefined, order_price_round: '0.001' }]) : response([]);
        if (init.method === 'POST') { posts.push(JSON.parse(String(init.body))); return response({ code: 0, data: { id: '789' } }); }
        if (url.pathname.includes('/contracts/')) return response({ ...rule, order_price_round: tick });
        if (url.pathname.endsWith('/list')) return response(list([]));
        return response([]);
      });
      // A real Gate conflict still pauses the whole batch, with the saved raw value intact.
      await assert.rejects(f.dashboard.refreshSources(), /来源已保存，自动下单暂停：精度冲突/);
      assert.equal(f.dashboard.sources().phase, 'failed');
      assert.equal(posts.length, 0); assert.equal(f.storage.intents().length, 0);
      assert.equal(f.storage.rows('orders', 'record_position')[0].raw_activation_price, raw);
      // Once Gate accepts the Supabase step, display rounding cannot keep trading paused.
      tick = '0.0001';
      await f.dashboard.refreshSources();
      const snapshot = f.dashboard.sources();
      assert.equal(snapshot.error, null); assert.equal(snapshot.phase, 'completed');
      assert.equal(snapshot.refreshing, false); assert.equal(snapshot.execution[0].action, 'created');
      assert.equal(posts.length, 1); assert.equal(posts[0].activation_price, raw); assert.equal(posts[0].amount, '2');
      assert.equal(snapshot.orders[0].activation_price, two(raw));
      assert.equal(f.storage.rows('orderslist', 'id')[0].raw_activation_price, raw);
      assert.equal(f.storage.intents().length, 0);
    });
  }
});


test('Supabase orders.order_price_round survives Gate enrichment and drives ETH opening and protection', async t => {
  const posts: Record<string, unknown>[] = [];
  const f = fixture(t, async (url, init) => {
    if (url.hostname === 'supabase.invalid') {
      assert.equal(url.pathname, '/rest/v1/orders');
      return url.searchParams.get('offset') === '0'
        ? response([{ ...source, contract: 'ETH_USDT', activation_price: '100.1234', price_round: '0.5', order_price_round: '0.005' }]) : response([]);
    }
    if (init.method === 'POST') { posts.push(JSON.parse(String(init.body))); return response({ code: 0, data: { id: String(900 + posts.length) } }); }
    if (url.pathname.includes('/contracts/')) return response({ ...rule, name: 'ETH_USDT' });
    if (url.pathname.endsWith('/positions')) return response([{ ...position, contract: 'ETH_USDT', entry_price: '100.1234' }]);
    if (url.pathname.endsWith('/list')) return response(list([]));
    return response([]);
  });
  await f.dashboard.refreshSources();
  const saved = f.storage.sources().orders[0];
  assert.equal(saved.price_round, '0.005'); assert.equal(saved.order_price_round, '0.0001');
  assert.equal(posts[0].activation_price, '100.125'); assert.equal(posts[0].amount, '2');
  assert.equal(f.dashboard.sources().error, null);
  await f.dashboard.refreshOrders();
  assert.equal(posts[1].activation_price, '101.125'); assert.equal(posts[1].amount, '-2');
  assert.equal(posts[1].reduce_only, true);
  assert.equal(f.storage.sources().orders[0].price_round, '0.005');
});

test('invalid or missing Supabase order_price_round never falls back to price_round or Gate', async t => {
  for (const step of [undefined, null, '', '0', '-0.001', 'bad']) {
    let posts = 0;
    const f = fixture(t, async (url, init) => {
      if (url.hostname === 'supabase.invalid') return url.searchParams.get('offset') === '0'
        ? response([{ ...source, order_price_round: step }]) : response([]);
      if (init.method === 'POST') posts++;
      if (url.pathname.includes('/contracts/')) return response(rule);
      if (url.pathname.endsWith('/list')) return response(list([]));
      return response([]);
    });
    await assert.rejects(f.dashboard.refreshSources());
    assert.equal(f.dashboard.sources().phase, 'failed');
    assert.equal(posts, 0); assert.equal(f.storage.intents().length, 0);
  }
});
