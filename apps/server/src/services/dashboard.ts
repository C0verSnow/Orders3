import type { SourceSnapshot, OrdersSnapshot, Execution } from '../../../../packages/shared/types.ts';
import { two, decimal } from '../../../../packages/decimal/index.ts';
import type { Configuration } from '../config/index.ts';
import type { Storage } from '../database/index.ts';
import type { Activity } from './activity.ts';
import { HttpClient } from '../exchange/http.ts';
import { syncEntries } from './entry-history.ts';
import { Gate } from '../exchange/gate.ts';
import { fetchSources } from '../exchange/supabase.ts';
import { sourceOrder } from './source-parser.ts';
import { openOrders, type TradingAuthorization } from './trading.ts';
import { syncPositions } from './positions.ts';
import { AppError, safeError } from '../utils/errors.ts';

export class Dashboard {
  sourcesBusy = false;
  gateBusy = false;
  gateWork: Promise<unknown> = Promise.resolve();
  phase = 'idle';
  sourceError: string | null = null;
  ordersError: string | null = null;
  execution: Execution[] = [];
  started = performance.now();
  config: Configuration;
  storage: Storage;
  http: HttpClient;
  activity: Activity;
  constructor(config: Configuration, storage: Storage, http: HttpClient, activity: Activity) { this.config = config; this.storage = storage; this.http = http; this.activity = activity; }
  sources(): SourceSnapshot {
    return { ...this.storage.sources(), execution: this.execution, phase: this.phase, updated_at: this.storage.updated('sources'), error: this.sourceError ?? this.storage.schemaError, refreshing: this.sourcesBusy };
  }
  orders(): OrdersSnapshot {
    const positions = this.storage.positions();
    const total = (field: 'unrealised_pnl' | 'realised_pnl') => two(this.storage.rawPositions().reduce((sum, row) => sum.plus(String(row[field])), decimal('0')));
    return { orders: this.storage.trailing(), positions, close_execution: [], updated_at: this.storage.updated('orders'), position_updated_at: this.storage.updated('positions'), trailing_updated_at: this.storage.updated('trailing'), error: this.ordersError ?? this.storage.schemaError,
      refreshing: this.gateBusy, unrealised_pnl: total('unrealised_pnl'), realised_pnl: total('realised_pnl'), uptime_ms: Math.floor(performance.now() - this.started) };
  }
  async refreshSources() {
    if (this.sourcesBusy) throw new AppError('来源任务正在运行，请稍后', 409);
    const release = this.config.acquireConnection();
    this.sourcesBusy = true; this.phase = 'fetching'; this.sourceError = null; this.execution = [];
    this.activity.begin('sources');
    const config = this.config.connection();
    try {
      if (this.storage.schemaError) throw new AppError(this.storage.schemaError);
      const items = await fetchSources(this.http, config), gate = new Gate(this.http, config, 'sources');
      const contracts = new Map<string, Awaited<ReturnType<Gate['contract']>>>();
      for (let index = 0; index < items.length; index++) {
        const order = sourceOrder(items[index], index); if (!order) continue;
        if (!contracts.has(order.contract)) contracts.set(order.contract, await gate.contract(order.contract));
        const rule = contracts.get(order.contract)!;
        items[index].quanto_multiplier = rule.quanto_multiplier;
        items[index].order_price_round = rule.order_price_round;
      }
      this.storage.saveSources(items);
      this.phase = 'completed'; this.activity.finish('sources', true);
    } catch (error) {
      this.phase = 'failed'; this.sourceError = `抓取失败，保留上次数据：${safeError(error)}`;
      this.activity.finish('sources', false);
      throw new AppError(this.sourceError, 502);
    } finally { this.sourcesBusy = false; release(); }
  }
  async executeOpening(authorization: TradingAuthorization) {
    if (this.gateBusy || this.sourcesBusy) throw new AppError('数据任务正在运行，本次开仓跳过', 409);
    if (this.storage.schemaError) throw new AppError(this.storage.schemaError);
    const release = this.config.acquireConnection();
    this.gateBusy = true; this.ordersError = null; this.execution = []; this.activity.begin('opening');
    const work = (async () => {
      try {
        this.execution = await openOrders(new Gate(this.http, this.config.connection(), 'opening'), this.storage, authorization);
        const failure = this.execution.find(row => row.action === 'failed');
        if (failure) throw new AppError(failure.error || '开仓失败', 502);
        this.activity.finish('opening', true);
      } catch (error) { this.ordersError = safeError(error); this.activity.finish('opening', false); throw error; }
      finally { this.gateBusy = false; release(); }
    })();
    this.gateWork = work.catch(() => {});
    return work;
  }
  async resolveIntent(id: string, evidence: string) {
    if (this.gateBusy || this.sourcesBusy) throw new AppError('请等待当前任务完成', 409);
    const gate = new Gate(this.http, this.config.connection(), 'manual-review');
    const intent = this.storage.intents().find(row => row.id === id);
    if (!intent) throw new AppError('待核对交易不存在', 404);
    if (!intent.owner || intent.owner !== gate.owner) throw new AppError('原凭证指纹缺失或与当前连接不同，不能解除。请恢复原凭证核对；旧版无身份记录需离线人工恢复', 409);
    const release = this.config.acquireConnection();
    this.gateBusy = true;
    const work = (async () => {
      try {
        const trailing = await gate.trailing();
        await gate.positions();
        await syncEntries(gate, this.storage);
        this.storage.saveTrailing(trailing);
        this.storage.transaction(() => {
          this.storage.db.prepare("UPDATE trade_intents SET state='reviewed',review_evidence=? WHERE id=? AND owner=? AND state IN ('pending','unknown')").run(evidence, id, gate.owner);
        });
        this.activity.record({ task: 'manual-review', kind: 'task', state: 'completed' });
      } finally { this.gateBusy = false; release(); }
    })();
    this.gateWork = work.catch(() => {});
    await work;
  }
  async refreshOrders(includePositions = true) {
    if (this.gateBusy) throw new AppError('交易任务正在运行，请稍后', 409);
    const release = this.config.acquireConnection();
    this.gateBusy = true; this.ordersError = null; this.activity.begin('orders');
    const gate = new Gate(this.http, this.config.connection(), 'orders');
    const work = (async () => {
      try {
        if (this.storage.schemaError) throw new AppError(this.storage.schemaError);
        if (includePositions) await syncPositions(gate, this.storage);
        this.storage.saveTrailing(await gate.trailing());
        this.activity.finish('orders', true);
      } catch (error) {
        this.ordersError = safeError(error); this.activity.finish('orders', false); throw new AppError(this.ordersError, 502);
      } finally { this.gateBusy = false; release(); }
    })();
    this.gateWork = work.catch(() => {});
    return work;
  }
}
