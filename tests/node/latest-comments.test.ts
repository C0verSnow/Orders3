// Remote CI only: automatic protection was removed at the user's request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, list } from './helpers.ts';

test('position refresh needs no Supabase source step and never writes protection orders', async t => {
  for (const status of [1, 2, 5]) {
    let posts = 0;
    const f = fixture(t, async (url, init) => {
      if (init.method === 'POST') { posts++; throw new Error('position sync must be read only'); }
      if (url.hostname === 'supabase.invalid') throw new Error('position sync must not read Supabase');
      if (url.pathname.endsWith('/positions')) return response([{ contract: 'SNDK_USDT', size: '11', entry_price: '1189.98', initial_margin: '0', leverage_max: '20', unrealised_pnl: '0.005', realised_pnl: '0', mark_price: '1190' }]);
      if (url.pathname.includes('/contracts/')) return response({ name: 'SNDK_USDT', quanto_multiplier: '0.01', order_price_round: '0.01' });
      if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' ? [{ id: '99', contract: 'SNDK_USDT', amount: '-11', activation_price: '1180', reduce_only: true, original_status: status }] : []));
      return response([]);
    });
    // No source cache, including no price_round; repeated refresh must still succeed.
    await f.dashboard.refreshOrders(); await f.dashboard.refreshOrders();
    const snapshot = f.dashboard.orders();
    assert.equal(snapshot.error, null); assert.equal(snapshot.positions[0].entry_price, '1189.98');
    assert.equal(snapshot.positions[0].unrealised_pnl, '0.01');
    assert.equal(Object.hasOwn(snapshot.positions[0], 'close_price'), false);
    assert.equal(snapshot.orders[0].id, '99'); assert.equal(snapshot.orders[0].original_status, status);
    assert.deepEqual(snapshot.close_execution, []); assert.equal(posts, 0); assert.equal(f.storage.intents().length, 0);
  }
});
