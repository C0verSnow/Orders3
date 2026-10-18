import { Decimal } from 'decimal.js';

export const D = Decimal.clone({ precision: 384, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -384, toExpPos: 384 });
export function decimal(value: unknown): Decimal {
  if (typeof value !== 'string' || value.length > 160 || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) throw new Error('无效的十进制文本');
  const result = new D(value);
  if (!result.isFinite() || result.e > 128 || result.e < -128 || result.sd() > 128) throw new Error('十进制数值超出范围');
  return result;
}
export function two(value: string | Decimal): string {
  const result = typeof value === 'string' ? decimal(value) : value;
  const rounded = result.toDecimalPlaces(2, D.ROUND_HALF_UP);
  return rounded.isZero() ? '0.00' : rounded.toFixed(2);
}
export function integer(value: unknown, allowZero = false): string {
  const result = decimal(value);
  if (!result.isInteger() || (!allowZero && result.isZero()) || result.abs().gt('9223372036854775807')) throw new Error('数量必须为有效整数张数');
  return result.toFixed(0);
}
export interface ContractRules { name: string; quanto_multiplier: string; order_price_round: string; order_size_min?: string; order_size_max?: string }
export function executionPrice(raw: string, amount: string, rules: ContractRules): string {
  const price = decimal(raw), size = decimal(integer(amount));
  const rounded = two(price), tick = decimal(rules.order_price_round);
  if (price.lte(0) || tick.lte(0) || decimal(rounded).lte(0)) throw new Error('价格和步长必须大于零');
  if (!price.eq(rounded)) throw new Error('精度冲突：两位小数会改变激活价格，已禁止交易；请核对原始值');
  if (!price.mod(tick).isZero()) throw new Error('精度冲突：激活价格不符合 Gate 合约步长，已禁止交易');
  if (rules.order_size_min && size.abs().lt(decimal(rules.order_size_min))) throw new Error('数量小于 Gate 最小张数');
  if (rules.order_size_max && decimal(rules.order_size_max).gt(0) && size.abs().gt(decimal(rules.order_size_max))) throw new Error('数量超过 Gate 最大张数');
  return rounded;
}
export function closePrice(entry: string, size: string, margin: string, multiplier: string, tick: string): string {
  const e = decimal(entry), s = decimal(integer(size)), m = decimal(margin), q = decimal(multiplier), t = decimal(tick);
  if (e.lte(0) || m.lt(0) || q.lte(0) || t.lte(0)) throw new Error('平仓计算参数无效');
  const delta = m.times('3.1').div(s.abs().times(q));
  const target = s.gt(0) ? e.plus(delta).times('1.01') : e.minus(delta).times('0.99');
  const result = target.div(t).toDecimalPlaces(0, D.ROUND_HALF_EVEN).times(t);
  if (target.lte(0) || result.lte(0)) throw new Error('平仓激活价格不大于零');
  return executionPrice(result.toFixed(), s.negated().toFixed(0), { name: '', quanto_multiplier: multiplier, order_price_round: tick });
}
