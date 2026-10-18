import type { SourceSnapshot, OrdersSnapshot, Execution } from '../../../../packages/shared/types.ts';
import { two, decimal } from '../../../../packages/decimal/index.ts';
import type { Configuration } from '../config/index.ts';
import type { Storage } from '../database/index.ts';
import type { Activity } from './activity.ts';
import { HttpClient } from '../exchange/http.ts';
import { Gate } from '../exchange/gate.ts';
import { fetchSources } from '../exchange/supabase.ts';
import { sourceOrder } from './source-parser.ts';
import { openOrders, closeOrders } from './trading.ts';
import { AppError, safeError } from '../utils/errors.ts';

export class Dashboard {
  sourcesBusy = false;
  gateBusy = false;
  gateWork: Promise<unknown> = Promise.resolve();
  phase = 'idle';
  sourceError: string | null = null;
  ordersError: string | null = null;
  execution: Execution[] = [];
  closeExecution: Execution[] = [];
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
    return { orders: this.storage.trailing(), positions, close_execution: this.closeExecution, updated_at: this.storage.updated('orders'), error: this.ordersError ?? this.storage.schemaError,
      refreshing: this.gateBusy, unrealised_pnl: total('unrealised_pnl'), realised_pnl: total('realised_pnl'), uptime_ms: Math.floor(performance.now() - this.started) };
  }
  async refreshSources() {
    if (this.sourcesBusy) throw new AppError('来源任务正在运行，请稍后', 409);
    this.sourcesBusy = true; this.phase = 'fetching'; this.sourceError = null; this.execution = [];
    this.activity.begin('sources');
    let saved = false, acquired = false;
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
      this.storage.saveSources(items); saved = true; this.phase = 'trading';
      await this.gateWork;
      this.gateBusy = true; acquired = true;
      const work = openOrders(gate, this.storage); this.gateWork = work.catch(() => {});
      this.execution = await work;
      const failure = this.execution.find(row => row.action === 'failed');
      if (failure) throw new AppError(failure.error || '交易执行失败', 502);
      this.phase = 'completed'; this.activity.finish('sources', true);
    } catch (error) {
      this.phase = 'failed'; this.sourceError = `${saved ? '来源已保存，自动下单暂停' : '抓取失败，保留上次数据'}：${safeError(error)}`;
      this.activity.finish('sources', false);
      throw new AppError(this.sourceError, 502);
    } finally { this.sourcesBusy = false; if (acquired) this.gateBusy = false; }
  }
  async refreshOrders(execute = true) {
    if (this.gateBusy) throw new AppError('交易任务正在运行，请稍后', 409);
    this.gateBusy = true; this.ordersError = null; this.activity.begin('orders');
    const gate = new Gate(this.http, this.config.connection(), 'orders');
    const work = (async () => {
      try {
        if (this.storage.schemaError) throw new AppError(this.storage.schemaError);
        if (execute) {
          this.closeExecution = await closeOrders(gate, this.storage);
          const failure = this.closeExecution.find(row => row.action === 'failed');
          if (failure) throw new AppError(failure.error || '平仓保护处理失败', 502);
        } else this.storage.saveTrailing(await gate.trailing(false));
        this.activity.finish('orders', true);
      } catch (error) {
        this.ordersError = safeError(error); this.activity.finish('orders', false); throw new AppError(this.ordersError, 502);
      } finally { this.gateBusy = false; }
    })();
    this.gateWork = work.catch(() => {});
    return work;
  }
}
