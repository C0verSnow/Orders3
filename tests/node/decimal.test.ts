import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decimal, two, closePrice, executionPrice } from '../../packages/decimal/index.ts';
test('ROUND_HALF_UP handles decimal boundaries and signed values', () => {
  for (const [input, expected] of [['123.456','123.46'],['123.454','123.45'],['0.005','0.01'],['12','12.00'],['99.999','100.00'],['-1.235','-1.24'],['-0.0001','0.00'],['0','0.00'],['0.0000000001','0.00'],['999999999999999999999.995','1000000000000000000000.00']]) assert.equal(two(input), expected);
});
test('accumulation and order notional never pass through binary floats', () => {
  let sum = decimal('0'); for (let index = 0; index < 10000; index++) sum = sum.plus('0.1');
  assert.equal(two(sum), '1000.00'); assert.equal(two(decimal('123.45').times('6.7')), '827.12');
});
test('invalid and excessive decimal inputs are rejected', () => {
  for (const value of ['NaN', 'Infinity', '1e999999', '1e-999999', '', '1.2 USDT', '0x10']) assert.throws(() => decimal(value));
});
test('Supabase alignment preserves precision and independently enforces Gate rules and integer size bounds', () => {
  const rules = { name: 'BTC_USDT', quanto_multiplier: '0.001', order_price_round: '0.0001', order_size_min: '2', order_size_max: '100' };
  for (const [raw, expected] of [['100.5','100.500'], ['100.005','100.005'], ['100.0001','100.000'], ['100.1234','100.123'], ['100.1225','100.122'], ['100.1235','100.124']]) {
    assert.equal(executionPrice(raw, '2', rules, '0.001'), expected);
  }
  assert.equal(executionPrice('100.1234', '2', rules, '0.005'), '100.125');
  for (const [price, size] of [['0.0001','2'], ['0','2'], ['-1','2'], ['100.5','1'], ['100.5','101'], ['100.5','2.5']]) assert.throws(() => executionPrice(price, size, rules, '0.001'));
  for (const step of ['0', '-0.001', 'bad']) assert.throws(() => executionPrice('100.5', '2', rules, step));
  assert.throws(() => executionPrice('100.005', '2', { ...rules, order_price_round: '0.01' }, '0.001'), /精度冲突/);
});
test('legacy 3.1 margin formula retains high precision and Supabase half-even alignment', () => {
  assert.equal(closePrice('100','2','1','0.1','0.5','0.5'), '116.5');
  assert.equal(closePrice('100','-2','1','0.1','0.5','0.5'), '83.5');
  assert.throws(() => closePrice('100','-2','100','0.1','0.5','0.5'));
  assert.equal(closePrice('0.0001','2','0','1','0.00001','0.00001'), '0.00010');
  assert.equal(closePrice('100.005','2','0','1','0.001','0.0001'), '101.005');
  assert.equal(closePrice('100','3','1','0.1','0.001','0.0001'), '111.437');
});
