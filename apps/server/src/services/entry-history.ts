import type { Gate } from '../exchange/gate.ts';
import { gateSuccess } from '../exchange/gate.ts';
import { array, object, text } from '../exchange/http.ts';
import { decimal } from '../../../../packages/decimal/index.ts';
import type { EntryEvent } from '../../../../packages/shared/types.ts';
import type { Storage } from '../database/index.ts';
import { contractName } from './source-parser.ts';
import { AppError } from '../utils/errors.ts';

export function fillDirection(size: string, close: string): number | null {
  const s = decimal(size), c = decimal(close);
  if (s.isZero() || (!c.isZero() && s.isNegative() !== c.isNegative())) throw new AppError('成交历史 size 与 close_size 无效或方向冲突');
  return s.abs().gt(c.abs()) ? s.isNegative() ? -1 : 1 : null;
}
export async function syncEntries(gate: Gate, storage: Storage, now = Date.now()): Promise<boolean> {
  const previous = storage.watermark(gate.owner);
  if (previous >= now) return false;
  const from = Math.floor((now - 7 * 86400000) / 1000), to = Math.floor(now / 1000) + 1;
  const events: EntryEvent[] = [], seen = new Set<string>();
  for (let offset = 0; ; ) {
    const response = await gate.request(`/api/v4/futures/usdt/my_trades_timerange?from=${from}&to=${to}&limit=100&offset=${offset}`); gateSuccess(response);
    const page = array(response.data);
    if (!page.length) break;
    for (const item of page) {
      const row = object(item), id = text(row.trade_id);
      if (!/^\d+$/.test(id) || seen.has(id)) throw new AppError('成交历史 ID 无效或分页重复');
      seen.add(id);
      const time = decimal(row.create_time).times(1000).floor();
      if (time.lt(0) || time.gt(Number.MAX_SAFE_INTEGER)) throw new AppError('成交历史时间无效');
      const contract = contractName(row.contract), side = fillDirection(text(row.size), text(row.close_size));
      if (side !== null && time.gte(now - 7 * 86400000) && time.lte(now) && !storage.entrySeen(gate.owner, id)) events.push({ event_id: id, entry_time: time.toNumber(), contract, side });
    }
    offset += page.length;
    if (offset > 1_000_000) throw new AppError('成交历史分页过多');
  }
  // Always observe positions, including a repeat poll with no new fills: the
  // latest confirmed entry may still be waiting for its first margin snapshot.
  const positions = await gate.positions();
  storage.history(gate.owner, events, now, positions.map(row => ({
    contract: text(row.contract), side: decimal(row.size).isNegative() ? -1 : 1,
    initial_margin: text(row.initial_margin)
  })));
  return events.length > 0;
}
