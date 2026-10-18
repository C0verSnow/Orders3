import { HttpClient, array, object } from './http.ts';
import type { Connection } from '../config/index.ts';
import { serviceUrl } from '../config/index.ts';
import { sourceOrder } from '../services/source-parser.ts';
import { AppError } from '../utils/errors.ts';

export async function fetchSources(http: HttpClient, config: Connection): Promise<Record<string, unknown>[]> {
  if (!config.supabaseUrl || !config.supabaseKey) throw new AppError('请先填写 Supabase 地址和密钥');
  const base = serviceUrl(config.supabaseUrl, true), headers: Record<string, string> = { apikey: config.supabaseKey, Accept: 'application/json', Prefer: 'count=exact' };
  if (config.supabaseKey.split('.').length === 3) headers.Authorization = `Bearer ${config.supabaseKey}`;
  const rows: Record<string, unknown>[] = [], ids = new Set<string>();
  let total: number | undefined;
  while (true) {
    const url = new URL('/rest/v1/orders', base);
    url.search = new URLSearchParams({ select: '*', order: 'id.asc', offset: String(rows.length), limit: '1000' }).toString();
    const result = await http.request('sources', url, 'GET', headers);
    if (result.status < 200 || result.status >= 300) throw new AppError(`Supabase HTTP ${result.status}，已保留上次数据`, 502);
    const page = array(result.data).map(object), count = result.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
    if (count !== undefined) {
      const current = Number(count);
      if (!Number.isSafeInteger(current) || current < 0 || (total !== undefined && total !== current)) throw new AppError('读取期间来源订单总数发生变化', 502);
      total = current;
    }
    if (!page.length) {
      if (total !== undefined && rows.length !== total) throw new AppError('来源订单分页提前结束', 502);
      return rows;
    }
    for (const row of page) {
      sourceOrder(row, rows.length);
      if (row.id !== undefined) { const id = String(row.id); if (ids.has(id)) throw new AppError('来源订单分页重复 ID', 502); ids.add(id); }
      rows.push(row);
    }
    if (rows.length > 1_000_000 || (total !== undefined && rows.length > total)) throw new AppError('来源分页数量异常', 502);
    if (rows.length === total) return rows;
  }
}
