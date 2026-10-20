import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import { Configuration } from '../../apps/server/src/config/index.ts';
import { Storage } from '../../apps/server/src/database/index.ts';
import { Activity } from '../../apps/server/src/services/activity.ts';
import { RequestLog } from '../../apps/server/src/services/request-log.ts';
import { HttpClient, type Sender } from '../../apps/server/src/exchange/http.ts';
import { Gate } from '../../apps/server/src/exchange/gate.ts';
import { Dashboard } from '../../apps/server/src/services/dashboard.ts';

export function fixture(t: TestContext, sender?: Sender) {
  const root = mkdtempSync(join(tmpdir(), 'orders-test-')), data = join(root, 'data'); mkdirSync(data);
  const config = new Configuration({ ORDERS_CONFIG_PATH: join(root, 'config'), ORDERS_DATA_DIR: data, API_KEY: 'test-key', API_SECRET: 'test-secret', SUPABASE_URL: 'https://supabase.invalid', SUPABASE_ANON_KEY: 'test-anon' }, root);
  const storage = new Storage(config.databasePath), activity = new Activity(), log = new RequestLog(join(root, 'logs'));
  const http = new HttpClient(activity, log, sender), gate = new Gate(http, config.connection(), 'test'), dashboard = new Dashboard(config, storage, http, activity);
  t.after(() => { http.controller.abort(); storage.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, config, storage, activity, log, http, gate, dashboard };
}
export const source = { id: '10000000000000000001', contract: 'BTC_USDT', activation_price: '100.50', amount: '2', side: 'buy', timestamp: 1700000000000, price_round: '0.5', quanto_multiplier: '0.1', order_price_round: '0.5' };
export const response = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers });
export const list = (orders: unknown[]) => ({ code: 0, timestamp: 1700000000000, data: { orders } });
