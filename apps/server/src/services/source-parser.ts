import type { SourceOrder } from '../../../../packages/shared/types.ts';
import { decimal, integer } from '../../../../packages/decimal/index.ts';
import { object, timestamp } from '../exchange/http.ts';
import { AppError } from '../utils/errors.ts';

export function contractName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9]+_USDT$/.test(value.trim())) throw new AppError('合约必须是有效 USDT 合约');
  return value.trim();
}
export function sourceOrder(value: unknown, position: number): SourceOrder | null {
  const row = object(value), time = timestamp(row.timestamp);
  if (['contract', 'activation_price', 'amount', 'side'].every(name => Object.hasOwn(row, name) && row[name] === null)) return null;
  const contract = contractName(row.contract), price = decimal(row.activation_price), amount = integer(row.amount);
  if (price.lte(0)) throw new AppError('来源激活价格必须大于零');
  if (row.side !== undefined && row.side !== null && typeof row.side !== 'string') throw new AppError('来源 side 必须是文本或空值');
  return { record_position: position, order_index: 0, contract, activation_price: price.toFixed(), amount, side: row.side as string ?? null, timestamp: time,
    ...(typeof row.price_round === 'string' ? { price_round: row.price_round } : {}),
    ...(typeof row.quanto_multiplier === 'string' ? { quanto_multiplier: row.quanto_multiplier } : {}), ...(typeof row.order_price_round === 'string' ? { order_price_round: row.order_price_round } : {}) };
}
export function legacyOrders(data: string, record: number): SourceOrder[] {
  const blocks = data.split(/(?=\b(?:contract|Symbol)\s*:)/i).filter(block => /\b(?:contract|Symbol)\s*:/i.test(block));
  const fields: Record<string, RegExp> = { contract: /\b(?:contract|Symbol)\s*:\s*([^\r\n]+)/i, activation_price: /\b(?:activation_price|Price)\s*:\s*([^\r\n]+)/i,
    amount: /\b(?:amount|Size)\s*:\s*([^\r\n]+)/i, side: /\bSide\s*:\s*([^\r\n]+)/i, timestamp: /\b(?:Timestamp|Orders Times)\s*:\s*([^\r\n]+)/i,
    price_round: /\bprice_round\s*:\s*([^\r\n]+)/i, quanto_multiplier: /\bquanto_multiplier\s*:\s*([^\r\n]+)/i, order_price_round: /\border_price_round\s*:\s*([^\r\n]+)/i };
  return blocks.map((block, index) => {
    const row: Record<string, unknown> = {};
    for (const [name, pattern] of Object.entries(fields)) row[name] = pattern.exec(block)?.[1].trim() ?? null;
    if (typeof row.amount === 'string') row.amount = row.amount.replace(/\s+contracts?$/i, '');
    if (typeof row.activation_price === 'string') row.activation_price = row.activation_price.replace(/\s+USDT$/i, '');
    return { ...sourceOrder(row, record)!, order_index: index };
  });
}
