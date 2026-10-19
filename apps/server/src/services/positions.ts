import { decimal, integer, type ContractRules } from '../../../../packages/decimal/index.ts';
import type { Position } from '../../../../packages/shared/types.ts';
import type { Storage } from '../database/index.ts';
import type { Gate } from '../exchange/gate.ts';
import { text } from '../exchange/http.ts';

// Read-only exchange sync. No source steps, target prices or protection reconciliation.
export async function syncPositions(gate: Gate, storage: Storage): Promise<void> {
  const raw = await gate.positions();
  const rules = new Map<string, ContractRules>(), positions: Position[] = [];
  for (const row of raw) {
    const contract = text(row.contract), size = integer(row.size);
    if (!rules.has(contract)) rules.set(contract, await gate.contract(contract));
    const rule = rules.get(contract)!;
    positions.push({ contract, size, entry_price: text(row.entry_price),
      value: decimal(size).times(rule.quanto_multiplier).times(text(row.entry_price)).toFixed(),
      leverage_max: text(row.leverage_max), unrealised_pnl: text(row.unrealised_pnl), realised_pnl: text(row.realised_pnl),
      initial_margin: text(row.initial_margin), mark_price: text(row.mark_price),
      quanto_multiplier: rule.quanto_multiplier, order_price_round: rule.order_price_round });
  }
  storage.savePositions(positions, raw);
}
