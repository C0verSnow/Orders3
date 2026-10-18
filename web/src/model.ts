import type {ActivitySnapshot, Position, SourceOrder, SourceRecord} from "./types";

export const exactValue = (value: unknown) => value == null || value === "" ? "—" : String(value);
const dateFormat = new Intl.DateTimeFormat("zh-CN", {dateStyle: "medium", timeStyle: "medium"});
export function dateText(value: unknown) {
  if (!value) return "—";
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date);
}
export function pnlTone(value: unknown) {
  const text = String(value ?? "");
  return !/^[+-]?\d+(\.\d+)?$/.test(text) || !/[1-9]/.test(text) ? "neutral" : text.startsWith("-") ? "negative" : "positive";
}
export function compareDecimal(a: unknown, b: unknown) {
  const parse = (value: unknown) => {
    const match = String(value ?? "").match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!match) return null;
    const integer = match[2].replace(/^0+(?=\d)/, "");
    const fraction = (match[3] || "").replace(/0+$/, "");
    return {negative: match[1] === "-" && (integer !== "0" || fraction !== ""), integer, fraction};
  };
  const left = parse(a), right = parse(b);
  if (!left || !right) return String(a ?? "").localeCompare(String(b ?? ""));
  if (left.negative !== right.negative) return left.negative ? -1 : 1;
  const width = Math.max(left.fraction.length, right.fraction.length);
  const result = Math.sign(left.integer.length - right.integer.length) || left.integer.localeCompare(right.integer) || left.fraction.padEnd(width, "0").localeCompare(right.fraction.padEnd(width, "0"));
  return left.negative ? -result : result;
}
export function gridPage<T>(rows: readonly T[], {query = "", status = "all", compare, page = 1, pageSize = 25, matches = () => true}: {
  query?: string; status?: string; compare?: (a: T, b: T) => number; page?: number; pageSize?: number; matches?: (row: T, query: string, status: string) => boolean;
} = {}) {
  const filtered = rows.filter((row) => matches(row, query.trim().toLowerCase(), status));
  if (compare) filtered.sort(compare);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  return {rows: filtered.slice((current - 1) * pageSize, current * pageSize), total: rows.length, matched: filtered.length, pages, page: current};
}
export const textMatch = (values: unknown[], query: string) => values.some((value) => String(value ?? "").toLowerCase().includes(query));
export const byContract = <T extends {contract?: string}>(a: T, b: T) => String(a.contract ?? "").localeCompare(String(b.contract ?? ""));
export const byTime = <T extends {timestamp?: string | number}>(a: T, b: T) => (new Date(b.timestamp ?? "").getTime() || 0) - (new Date(a.timestamp ?? "").getTime() || 0);
export function positionDirection(position: Position) {
  const size = String(position.size ?? "");
  return !size ? "unknown" : /^-?0+$/.test(size) ? "flat" : size.startsWith("-") ? "short" : "long";
}
export const directionLabels = {unknown: "—", flat: "空仓", short: "空头", long: "多头"};
export const sourceFailed = (item: SourceRecord) => Boolean(item.error) || Number(item.status_code) >= 400;
export interface SourceRow {item: SourceRecord; order: Partial<SourceOrder>; position: number; key: string}
export function sourceRows(items: SourceRecord[], orders: SourceOrder[]): SourceRow[] {
  const groups = new Map<number, SourceOrder[]>();
  for (const order of orders) { const group = groups.get(order.record_position) || []; group.push(order); groups.set(order.record_position, group); }
  return items.flatMap((item, position) => (groups.get(position) || [{} as SourceOrder]).map((order) => ({item, order, position, key: `${item.id ?? item.url ?? position}:${order.order_index ?? "none"}`})));
}
export function activityView(snapshot?: ActivitySnapshot, connected = true) {
  const requests = Object.values(snapshot?.requests || {}), jobs = Object.values(snapshot?.jobs || {});
  const nodes = Object.fromEntries((["sources", "gate"] as const).map((name) => {
    const rows = requests.filter((row) => row.node === name);
    const active = connected && rows.some((row) => row.active > 0);
    const latest = [...(snapshot?.events || [])].reverse().find((event) => event.node === name);
    return [name, {active, write: active && rows.some((row) => row.active > 0 && row.write),
      state: !connected ? "offline" : active ? "busy" : latest?.type === "request-end" ? ((latest.status ?? 0) >= 200 && (latest.status ?? 0) < 300 ? "ready" : "error") : "idle",
      completed: rows.reduce((sum, row) => sum + (row.completed || 0), 0)}];
  }));
  const running = connected && jobs.includes("running");
  return {nodes, running, state: !connected ? "offline" : running ? "busy" : jobs.includes("failed") ? "error" : jobs.length ? "ready" : "idle",
    completed: requests.reduce((sum, row) => sum + (row.completed || 0), 0), failed: requests.reduce((sum, row) => sum + (row.failed || 0), 0)};
}
