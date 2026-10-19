import { parse } from 'lossless-json';
import type { Activity } from '../services/activity.ts';
import type { RequestLog } from '../services/request-log.ts';
import { AppError } from '../utils/errors.ts';

export interface TransportResult { status: number; headers: Headers; text: string; data: unknown }
export type Sender = (url: URL, init: RequestInit) => Promise<Response>;
export class HttpClient {
  controller = new AbortController();
  private activity: Activity;
  private log: RequestLog;
  private sender: Sender;
  constructor(activity: Activity, log: RequestLog, sender: Sender = fetch) { this.activity = activity; this.log = log; this.sender = sender; }
  async request(task: string, url: URL, method = 'GET', headers: Record<string, string> = {}, body?: string): Promise<TransportResult> {
    const start = performance.now();
    let status = 0;
    this.activity.active++; this.activity.total++;
    this.activity.record({ task, kind: 'request', state: 'started', host: url.hostname, method });
    try {
      const response = await this.sender(url, { method, headers, body, redirect: 'error', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(30_000)]) });
      status = response.status;
      const length = Number(response.headers.get('content-length'));
      if (length > 32_000_000) throw new AppError('远端响应过大', 502);
      let text = '';
      if (response.body) {
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const result = await reader.read(); if (result.done) break;
            bytes += result.value.length;
            if (bytes > 32_000_000) { await reader.cancel(); throw new AppError('远端响应过大', 502); }
            chunks.push(result.value);
          }
        } finally { reader.releaseLock(); }
        text = Buffer.concat(chunks).toString('utf8');
      }
      // Every JSON number becomes exact text. Numeric timestamps/codes are explicitly validated later.
      let data: unknown;
      try { data = parse(text, undefined, value => value); }
      catch { throw new AppError(`远端返回无效 JSON（HTTP ${status}）`, 502); }
      return { status, headers: response.headers, text, data };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('网络请求中断或超过 30 秒；交易写入结果可能未知，请核对交易所', 502);
    } finally {
      this.activity.active--;
      this.activity.record({ task, kind: 'request', state: status >= 200 && status < 300 ? 'completed' : 'failed', method, host: url.hostname, status });
      this.log.write('outbound', method, url, status, Math.round(performance.now() - start));
    }
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('接口记录必须是对象', 502);
  return value as Record<string, unknown>;
}
export function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new AppError('接口必须返回数组', 502); return value; }
export function text(value: unknown): string { if (typeof value !== 'string') throw new AppError('接口缺少文本字段', 502); return value; }
export function timestamp(value: unknown): number {
  const string = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value);
  if (!/^\d+$/.test(string) || !Number.isSafeInteger(Number(string))) throw new AppError('接口时间戳或状态码无效', 502);
  return Number(string);
}
