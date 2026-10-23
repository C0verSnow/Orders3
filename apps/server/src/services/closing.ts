import { closePrice, decimal, integer, type ContractRules } from '../../../../packages/decimal/index.ts';
import type { Execution, TrailOrder } from '../../../../packages/shared/types.ts';
import type { Gate } from '../exchange/gate.ts';
import { text } from '../exchange/http.ts';
import type { Storage } from '../database/index.ts';
import { writeExchange, sameOrder, type TradingAuthorization } from './trading.ts';
import { AppError, safeError } from '../utils/errors.ts';

type Authorization = Extract<TradingAuthorization, { kind: 'maintenance' }>;
// Only the independent maintenance task can authorize these reduce-only writes.
export async function closeOrders(gate: Gate, storage: Storage, authorization: Authorization): Promise<Execution[]> {
  const positions = await gate.positions(), rules = new Map<string, ContractRules>();
  const desired: { contract: string; amount: string; activation_price: string; entry_price: string }[] = [];
  const results: Execution[] = [];
  for (const row of positions) {
    const contract = text(row.contract), size = integer(row.size), side = decimal(size).isNegative() ? -1 : 1;
    // Legacy positions without visible seven-day fills can use a first observed
    // fixed margin, without creating an entry event or changing the entry time.
    const margin = storage.entryMargin(gate.owner, contract, side) ?? storage.fixedMargin(gate.owner, contract, side, text(row.initial_margin));
    if (!rules.has(contract)) rules.set(contract, await gate.contract(contract));
    desired.push({ contract, amount: decimal(size).negated().toFixed(0), entry_price: text(row.entry_price),
      activation_price: closePrice(text(row.entry_price), size, margin, rules.get(contract)!) });
  }
  // All prices and amounts are validated before any stop/create request.
  const trailing = await gate.trailing(); storage.saveTrailing(trailing);
  const active = (row: TrailOrder) => row.reduce_only && [1, 2].includes(row.original_status);
  const sameSide = (row: TrailOrder, target: { contract: string; amount: string }) => row.contract === target.contract && decimal(row.amount).isNegative() === decimal(target.amount).isNegative();
  const candidates: typeof desired = [], stops = new Set<string>();
  for (const target of desired) {
    const orders = trailing.filter(row => active(row) && sameSide(row, target));
    if (orders.some(row => row.original_status === 2)) {
      results.push({ action: 'skipped', contract: target.contract, message: '已有激活平仓单，保留并阻止同方向补单' }); continue;
    }
    // The exchange list can omit policy fields. Preserve such orders and report
    // uncertainty rather than claim they satisfy the policy or duplicate them.
    if (orders.some(row => row.price_type === undefined || row.price_offset === undefined || row.is_gte === undefined || row.pos_margin_mode === undefined || row.position_mode === undefined)) {
      results.push({ action: 'failed', contract: target.contract, error: '已有平仓单缺少完整策略字段，保留并等待人工核对' }); continue;
    }
    const matching = orders.find(row => sameOrder(row, target) && row.price_type === 3 && row.price_offset === '1%' && row.is_gte === decimal(target.amount).isNegative() && row.pos_margin_mode === 'cross' && row.position_mode === 'dual_plus');
    if (matching) results.push({ action: 'skipped', contract: target.contract, id: matching.id, message: '参数未变化，保留有效平仓追踪单' });
    else candidates.push(target);
    for (const order of orders) if (order !== matching) stops.add(order.id);
  }
  for (const id of stops) if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) throw new AppError('旧平仓订单 ID 无效');
  if ((stops.size || candidates.length) && storage.intents().length) throw new AppError('存在结果未知的交易，平仓维护已暂停，请先核对 Gate', 409);
  let failedContract = '', operation = '';
  try {
    for (const id of stops) {
      const index = trailing.findIndex(row => row.id === id), row = trailing[index];
      failedContract = row.contract; operation = 'stop';
      const liveOrder = (await gate.trailing()).find(order => order.id === id);
      if (!liveOrder || liveOrder.original_status !== 1) throw new AppError('旧平仓单状态已变化，保留并暂停本轮调整');
      await writeExchange(gate, storage, 'stop', `{"id":${id}}`, () => {
        trailing[index] = { ...row, original_status: 5, timestamp: Date.now() }; storage.saveTrailing(trailing);
      }, authorization);
      results.push({ action: 'stopped', contract: row.contract, id });
    }
    for (const target of candidates) {
      failedContract = target.contract; operation = 'create';
      // Re-read immediately before writing. A partial close or concurrent entry
      // invalidates this round's quantity and target; let the next poll recalculate.
      const live = (await gate.positions()).find(row => row.contract === target.contract && decimal(row.size).isNegative() !== decimal(target.amount).isNegative());
      if (!live || !decimal(live.size).abs().eq(decimal(target.amount).abs()) || !decimal(live.entry_price).eq(target.entry_price)) throw new AppError('持仓已变化，暂停本轮平仓创建，下轮重新同步');
      const current = await gate.trailing();
      if (current.some(row => active(row) && sameSide(row, target))) throw new AppError('创建前发现同方向有效平仓单，暂停并在下轮重新核对');
      const { entry_price: _entry, ...order } = target;
      const payload = { ...order, reduce_only: true, is_gte: decimal(target.amount).isNegative(), price_type: 3, price_offset: '1%', pos_margin_mode: 'cross', position_mode: 'dual_plus' };
      let exchangeId = '';
      await writeExchange(gate, storage, 'create', JSON.stringify(payload), data => {
        const id = text(data.id);
        if (!/^[1-9]\d*$/.test(id)) throw new AppError('创建响应缺少有效平仓订单 ID；请核对 Gate', 502);
        exchangeId = id;
        trailing.push({ ...payload, id, original_status: 1, timestamp: Date.now() }); storage.saveTrailing(trailing);
      }, authorization);
      results.push({ action: 'created', contract: target.contract, id: exchangeId });
    }
  } catch (error) { results.push({ action: 'failed', contract: failedContract, operation, error: safeError(error) }); }
  return results;
}
