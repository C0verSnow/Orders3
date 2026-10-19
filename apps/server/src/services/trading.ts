import { decimal, integer, executionPrice, type ContractRules } from '../../../../packages/decimal/index.ts';
import type { Execution, SourceOrder, TrailOrder } from '../../../../packages/shared/types.ts';
import type { Storage } from '../database/index.ts';
import { randomUUID } from 'node:crypto';
import { Gate, TRAIL, businessSuccess } from '../exchange/gate.ts';
import { object, text } from '../exchange/http.ts';
import { syncEntries } from './entry-history.ts';
import { AppError, safeError } from '../utils/errors.ts';

interface Desired { contract: string; amount: string; activation_price: string }
export function sameOrder(old: TrailOrder, desired: Desired): boolean {
  const row = old as TrailOrder & { raw_activation_price?: string; raw_amount?: string };
  return old.contract === desired.contract && decimal(row.raw_amount ?? old.amount).eq(desired.amount) && decimal(row.raw_activation_price ?? old.activation_price).eq(desired.activation_price);
}
export function matchOrders(desired: Desired[], trailing: TrailOrder[], reduceOnly: boolean) {
  const retained = new Set<number>(), candidates: Desired[] = [], results: Execution[] = [];
  for (const entry of desired) {
    const index = trailing.findIndex((old, index) => !retained.has(index) && old.reduce_only === reduceOnly && [1, 2].includes(old.original_status) && sameOrder(old, entry));
    if (index >= 0) {
      retained.add(index);
      results.push({ action: 'skipped', contract: entry.contract, id: trailing[index].id, message: '参数未变化，保留有效追踪单' });
    } else candidates.push(entry);
  }
  return { retained, candidates, results };
}
async function writeExchange(gate: Gate, storage: Storage, operation: 'stop' | 'create', body: string, onSuccess: (data: Record<string, unknown>) => void) {
  if (storage.intents().length) throw new AppError('存在结果未知的交易，已禁止自动重试。请先核对 Gate 并在运行状态中处理', 409);
  const requestId = `t-${randomUUID().replaceAll('-', '').slice(0, 28)}`;
  if (operation === 'create') body = JSON.stringify({ ...JSON.parse(body), text: requestId });
  const id = storage.intent(operation, body, gate.owner, requestId);
  try {
    const response = await gate.request(`${TRAIL}/${operation}`, 'POST', body);
    // A non-2xx or malformed response is treated conservatively as unknown, never retried.
    const result = businessSuccess(response), data = operation === 'create' ? object(result.data) : (result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? object(result.data) : {});
    onSuccess(data);
    storage.intentState(id, 'confirmed', typeof data.id === 'string' ? data.id : undefined);
  } catch (error) {
    try { storage.intentState(id, 'unknown'); } catch { /* pending also blocks subsequent writes. */ }
    throw error;
  }
}
// Do not infer a Supabase step from the exchange tick or from a displayed price.
function sourceSteps(sources: SourceOrder[]): Map<string, string> {
  const steps = new Map<string, string>();
  for (const source of sources) {
    if (!source.price_round || decimal(source.price_round).lte(0)) throw new AppError(`${source.contract} 缺少有效 Supabase orders.order_price_round，已停止整批交易`);
    const previous = steps.get(source.contract);
    if (previous && !decimal(previous).eq(source.price_round)) throw new AppError(`${source.contract} 的 Supabase orders.order_price_round 冲突，已停止整批交易`);
    steps.set(source.contract, source.price_round);
  }
  return steps;
}
function requireStep(steps: Map<string, string>, contract: string): string {
  const step = steps.get(contract);
  if (!step) throw new AppError(`${contract} 缺少 Supabase orders.order_price_round，请先刷新包含该合约的来源配置，已停止整批交易`);
  return step;
}
async function reconcile(gate: Gate, storage: Storage, desired: Desired[], trailing: TrailOrder[], rules: Map<string, ContractRules>, steps: Map<string, string>): Promise<Execution[]> {
  // Complete parameter validation, including all stop IDs, before the first destructive operation.
  for (const entry of desired) {
    const rule = rules.get(entry.contract);
    if (!rule) throw new AppError('缺少真实合约规则');
    entry.activation_price = executionPrice(entry.activation_price, entry.amount, rule, requireStep(steps, entry.contract));
    entry.amount = integer(entry.amount);
  }
  const { retained, candidates, results } = matchOrders(desired, trailing, false);
  const stops = trailing.map((row, index) => ({ row, index })).filter(({ row, index }) => !retained.has(index) && !row.reduce_only && row.original_status === 1);
  for (const { row } of stops) if (!/^[1-9]\d*$/.test(row.id) || BigInt(row.id) > 9223372036854775807n) throw new AppError('旧订单 ID 无效');
  if (candidates.length) await syncEntries(gate, storage);
  if ((stops.length || candidates.length) && storage.intents().length) throw new AppError('存在结果未知的交易，请先核对 Gate，自动交易已暂停', 409);
  for (const { row, index } of stops) {
    try {
      await writeExchange(gate, storage, 'stop', `{"id":${row.id}}`, () => {
        trailing[index] = { ...row, original_status: 5, timestamp: Date.now() };
        storage.saveTrailing(trailing);
      });
      results.push({ action: 'stopped', contract: row.contract, id: row.id });
    } catch (error) { results.push({ action: 'failed', operation: 'stop', contract: row.contract, id: row.id, error: safeError(error) }); return results; }
  }
  for (const entry of candidates) {
    try {
      await syncEntries(gate, storage);
      if (storage.recentEntry(entry.contract, decimal(entry.amount).isNegative() ? -1 : 1)) {
        results.push({ action: 'skipped', contract: entry.contract, message: '最近 7 天已有同合约、同方向的真实入仓或加仓' }); continue;
      }
      let exchangeId = '';
      const payload = { ...entry, amount: integer(entry.amount), is_gte: decimal(entry.amount).isNegative(), reduce_only: false, price_type: 3, price_offset: '1%', pos_margin_mode: 'cross', position_mode: 'dual_plus', text: 'apiv4' };
      await writeExchange(gate, storage, 'create', JSON.stringify(payload), data => {
        const id = text(data.id);
        if (!/^[1-9]\d*$/.test(id)) throw new AppError('创建响应缺少有效订单 ID；请核对 Gate', 502);
        exchangeId = id;
        trailing.push({ ...entry, id, reduce_only: false, original_status: 1, timestamp: Date.now() });
        storage.saveTrailing(trailing);
      });
      results.push({ action: 'created', contract: entry.contract, id: exchangeId });
    } catch (error) { results.push({ action: 'failed', operation: 'create', contract: entry.contract, error: safeError(error) }); return results; }
  }
  return results;
}
export async function openOrders(gate: Gate, storage: Storage): Promise<Execution[]> {
  const sources = storage.sources().orders, rules = new Map<string, ContractRules>();
  gate.requireCredentials();
  const steps = sourceSteps(sources);
  const desired: Desired[] = [];
  for (const source of sources) {
    const raw = source as SourceOrder & { raw_activation_price?: string; raw_amount?: string };
    if (!rules.has(source.contract)) rules.set(source.contract, await gate.contract(source.contract));
    desired.push({ contract: source.contract, amount: integer(raw.raw_amount ?? source.amount), activation_price: executionPrice(raw.raw_activation_price ?? source.activation_price, raw.raw_amount ?? source.amount, rules.get(source.contract)!, requireStep(steps, source.contract)) });
  }
  // Reconcile from live exchange data, so a stale cache cannot cause duplicate submissions.
  const trailing = await gate.trailing(); storage.saveTrailing(trailing);
  return reconcile(gate, storage, desired, trailing, rules, steps);
}
