import { createHash, createHmac } from 'node:crypto';
import { decimal, integer, type ContractRules } from '../../../../packages/decimal/index.ts';
import type { TrailOrder } from '../../../../packages/shared/types.ts';
import type { Connection } from '../config/index.ts';
import { credential } from '../config/index.ts';
import { HttpClient, object, array, text, timestamp, type TransportResult } from './http.ts';
import { contractName } from '../services/source-parser.ts';
import { AppError } from '../utils/errors.ts';

export const TRAIL = '/api/v4/futures/usdt/autoorder/v1/trail';
export function signedHeaders(method: string, path: string, body: string, key: string, secret: string, seconds = Math.floor(Date.now() / 1000)): Record<string, string> {
  const separator = path.indexOf('?'), route = separator < 0 ? path : path.slice(0, separator), query = separator < 0 ? '' : path.slice(separator + 1);
  const time = String(seconds), hash = createHash('sha512').update(body).digest('hex');
  const message = `${method}\n${route}\n${query}\n${hash}\n${time}`;
  return { KEY: key, Timestamp: time, SIGN: createHmac('sha512', secret).update(message).digest('hex'), Accept: 'application/json', 'Content-Type': 'application/json' };
}
const hints: Record<string, string> = {
  IP_FORBIDDEN: '请将当前服务器公网出口 IP 加入 Gate 白名单', REQUEST_EXPIRED: '请同步宿主机系统时间', INVALID_SIGNATURE: '请检查 Key/Secret 配对',
  INVALID_KEY: '请检查 API Key', INVALID_CREDENTIALS: '请检查凭证', READ_ONLY: '需要合约交易写入权限', FORBIDDEN: '请检查合约权限', ACCOUNT_LOCKED: '请检查账户状态'
};
export function gateSuccess(result: TransportResult) {
  if (result.status >= 200 && result.status < 300) return;
  const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
  const label = typeof data.label === 'string' ? data.label : '';
  throw new AppError(`Gate HTTP ${result.status}${hints[label] ? ` ${label}：${hints[label]}` : '：请检查网络、凭证、IP、时间与权限'}`, 502);
}
export function businessSuccess(result: TransportResult): Record<string, unknown> {
  gateSuccess(result);
  const body = object(result.data);
  if (String(body.code) !== '0') throw new AppError('Gate 交易业务返回失败，请核对交易所列表', 502);
  return body;
}
export class Gate {
  owner: string;
  http: HttpClient;
  connection: Connection;
  task: string;
  constructor(http: HttpClient, connection: Connection, task: string) {
    this.http = http; this.connection = connection; this.task = task;
    this.owner = createHash('sha256').update(connection.gateKey).digest('hex');
  }
  requireCredentials() {
    const missing = [!credential(this.connection.gateKey) ? 'API_KEY' : '', !credential(this.connection.gateSecret) ? 'API_SECRET' : ''].filter(Boolean);
    if (missing.length) throw new AppError(`Gate 配置缺少 ${missing.join('、')}`);
  }
  async request(path: string, method = 'GET', body = '', authenticated = true) {
    if (authenticated) this.requireCredentials();
    return this.http.request(this.task, new URL(path, 'https://api.gateio.ws'), method,
      authenticated ? signedHeaders(method, path, body, this.connection.gateKey, this.connection.gateSecret) : { Accept: 'application/json' }, body || undefined);
  }
  async positions(): Promise<Record<string, unknown>[]> {
    const result = await this.request('/api/v4/futures/usdt/positions'); gateSuccess(result);
    const rows = array(result.data).map(object), directions = new Set<string>();
    for (const row of rows) {
      contractName(row.contract); const size = integer(row.size, true); row.size = size;
      if (size === '0') continue;
      const direction = `${row.contract}:${decimal(size).isNegative()}`;
      if (directions.has(direction)) throw new AppError('持仓接口返回重复合约方向', 502);
      directions.add(direction);
      for (const name of ['entry_price', 'leverage_max', 'unrealised_pnl', 'realised_pnl', 'initial_margin', 'mark_price']) decimal(row[name]);
      if (decimal(row.initial_margin).lt(0)) throw new AppError('持仓保证金不能为负', 502);
    }
    return rows.filter(row => row.size !== '0');
  }
  async contract(name: string): Promise<ContractRules> {
    contractName(name);
    const result = await this.request(`/api/v4/futures/usdt/contracts/${name}`, 'GET', '', false); gateSuccess(result);
    const row = object(result.data);
    if (row.name !== name) throw new AppError('Gate 合约详情名称不匹配', 502);
    for (const field of ['quanto_multiplier', 'order_price_round']) if (decimal(row[field]).lte(0)) throw new AppError('Gate 合约参数必须大于零', 502);
    for (const field of ['order_size_min', 'order_size_max']) if (row[field] !== undefined) integer(row[field], true);
    return row as unknown as ContractRules;
  }
  async trailing(paginate = true): Promise<TrailOrder[]> {
    const result: TrailOrder[] = [], seen = new Set<string>();
    for (let page = 1; ; page++) {
      const response = await this.request(TRAIL + '/list' + (paginate ? `?page_num=${page}&page_size=100` : ''));
      const payload = businessSuccess(response), time = timestamp(payload.timestamp), rows = array(object(payload.data).orders);
      for (const value of rows) {
        const row = object(value), id = text(row.id);
        if (!/^\d+$/.test(id) || id === '0' || seen.has(id)) throw new AppError('追踪订单 ID 无效或分页重复', 502);
        seen.add(id);
        const amount = integer(row.amount), price = text(row.activation_price);
        if (decimal(price).lt(0) || typeof row.reduce_only !== 'boolean') throw new AppError('追踪订单参数无效', 502);
        result.push({ ...(row.price_type !== undefined ? { price_type: timestamp(row.price_type) } : {}), ...(typeof row.price_offset === 'string' ? { price_offset: row.price_offset } : {}), ...(typeof row.is_gte === 'boolean' ? { is_gte: row.is_gte } : {}), ...(typeof row.pos_margin_mode === 'string' ? { pos_margin_mode: row.pos_margin_mode } : {}), ...(typeof row.position_mode === 'string' ? { position_mode: row.position_mode } : {}), id, contract: contractName(row.contract), amount, activation_price: price, reduce_only: row.reduce_only, original_status: timestamp(row.original_status), timestamp: time });
      }
      if (!paginate || rows.length === 0) break;
      if (result.length > 1_000_000) throw new AppError('追踪订单分页过多', 502);
    }
    return result;
  }
}
