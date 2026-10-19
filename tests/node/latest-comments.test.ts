// Remote CI only: regressions for PR #34 latest comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, source, response, list } from './helpers.ts';
import { closeOrders } from '../../apps/server/src/services/trading.ts';
const position = { contract: ' SNDK_USDT ', size: '11', entry_price: '1189.98', initial_margin: '0', leverage_max: '20', unrealised_pnl: '0', realised_pnl: '0', mark_price: '1190' };
const rule = { name: 'SNDK_USDT', quanto_multiplier: '0.01', order_price_round: '0.01' };

test('SNDK saved source step matches normalized Gate position and updates protection in place', async t => {
  const writes: { path: string; body: string }[] = [];
  let updated = false;
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { writes.push({ path: url.pathname, body: String(init.body) }); updated = true; return response({ code: 0, data: {} }); }
    if (url.pathname.endsWith('/positions')) return response([position]);
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' ? [{ id: '9007199254740993', contract: 'SNDK_USDT', amount: '-11', activation_price: updated ? '1201.88' : '1180', reduce_only: true, original_status: 1 }] : []));
    return response([]);
  });
  f.storage.saveSources([{ ...source, contract: 'SNDK_USDT', activation_price: '1189.98', amount: '11', price_round: '0.01' }]);
  const result = await closeOrders(f.gate, f.storage);
  assert.equal(result[0].action, 'updated');
  assert.equal(writes.length, 1); assert.ok(writes[0].path.endsWith('/trail/update'));
  assert.match(writes[0].body, /"id":9007199254740993[,}]/);
  assert.equal(JSON.parse(writes[0].body).activation_price, '1201.88');
  assert.equal(f.storage.rows('orderslist', 'id')[0].raw_activation_price, '1201.88');
  assert.equal(f.storage.intents().length, 0);
  assert.equal((await closeOrders(f.gate, f.storage))[0].action, 'skipped');
  assert.equal(writes.length, 1);
});

test('unknown protection update blocks retry and never stops or recreates the old protection', async t => {
  const writes: string[] = [];
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { writes.push(url.pathname); throw new Error('timeout'); }
    if (url.pathname.endsWith('/positions')) return response([{ ...position, contract: 'SNDK_USDT' }]);
    if (url.pathname.includes('/contracts/')) return response(rule);
    if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' ? [{ id: '99', contract: 'SNDK_USDT', amount: '-11', activation_price: '1180', reduce_only: true, original_status: 1 }] : []));
    return response([]);
  });
  f.storage.saveSources([{ ...source, contract: 'SNDK_USDT', price_round: '0.01' }]);
  assert.equal((await closeOrders(f.gate, f.storage))[0].operation, 'update');
  assert.equal(writes.length, 1); assert.ok(writes[0].endsWith('/update'));
  assert.equal(f.storage.intents()[0].operation, 'update');
  assert.equal(f.storage.trailing()[0].original_status, 1);
  await assert.rejects(closeOrders(f.gate, f.storage), /结果未知/);
  assert.equal(writes.length, 1);
});
