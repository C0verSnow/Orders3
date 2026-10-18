import type {ActivitySnapshot, OrdersSnapshot, Schedule, Settings, SettingsPayload, SourceSnapshot} from "./types";

type Parser<T> = (data: unknown) => T;
function object(data: unknown): asserts data is Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("服务器返回了无效的数据对象");
}
function rows(data: unknown, field: string) {
  object(data);
  if (!Array.isArray(data[field]) || data[field].some((row: unknown) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error(`服务器 ${field} 列表格式错误`);
}
export const parseSources: Parser<SourceSnapshot> = (data) => {
  rows(data, "items"); object(data);
  if (data.orders != null) rows(data, "orders");
  return {...data, orders: data.orders ?? []} as unknown as SourceSnapshot;
};
export const parseOrders: Parser<OrdersSnapshot> = (data) => {
  rows(data, "orders"); object(data);
  if (data.positions != null) rows(data, "positions");
  return data as unknown as OrdersSnapshot;
};
export const parseActivity: Parser<ActivitySnapshot> = (data) => {
  object(data);
  if (!Number.isSafeInteger(data.sequence) || !data.jobs || !data.requests || !Array.isArray(data.events)) throw new Error("执行状态格式错误");
  return data as unknown as ActivitySnapshot;
};
export const parseSettings: Parser<Settings> = (data) => { object(data); object(data.values); if (typeof data.config_path !== "string") throw new Error("配置路径格式错误"); return data as unknown as Settings; };
export const parseSchedule: Parser<Schedule> = (data) => { object(data); if (typeof data.enabled !== "boolean" || typeof data.cron !== "string") throw new Error("定时配置格式错误"); return data as unknown as Schedule; };

// Mutating refresh endpoints sometimes return a useful snapshot with HTTP 502.
// Keep it available to the controller exactly as the previous UI did.
export async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {cache: "no-store", ...options});
  const data: unknown = await response.json();
  return {ok: response.ok, data};
}
export function responseError(data: unknown, fallback: string) {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : fallback;
}
async function read<T>(path: string, parse: Parser<T>, signal?: AbortSignal): Promise<T> {
  const result = await request(path, {signal});
  if (!result.ok) throw new Error(responseError(result.data, "读取失败"));
  return parse(result.data);
}
export const api = {
  sources: () => read("/api/data", parseSources),
  orders: () => read("/api/orders", parseOrders),
  activity: (signal: AbortSignal) => read("/api/activity", parseActivity, signal),
  settings: () => read("/api/settings", parseSettings),
  saveSettings: async (values: SettingsPayload) => {
    const result = await request("/api/settings", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(values)});
    if (!result.ok) throw new Error(responseError(result.data, "保存配置失败"));
    return parseSettings(result.data);
  },
  saveSchedule: async (values: Pick<Schedule, "enabled" | "cron">) => {
    const result = await request("/api/schedule", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(values)});
    if (!result.ok) throw new Error(responseError(result.data, "保存定时配置失败"));
    return parseSchedule(result.data);
  }
};
