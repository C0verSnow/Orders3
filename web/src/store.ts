import {useSyncExternalStore} from "react";
import {api, parseSources, parseOrders, request, responseError} from "./api";
import type {ActivitySnapshot, Message, OrdersSnapshot, Schedule, SourceSnapshot} from "./types";

interface Channel<T> { data?: T; error?: string; loading: boolean; busy: boolean; message?: Message }
function channel<T>() {
  let value: Channel<T> = {loading: true, busy: false};
  let encoded: string | undefined;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const getSnapshot = () => value;
  function set(patch: Partial<Channel<T>>) {
    if (patch.data) {
      const next = JSON.stringify(patch.data);
      if (next === encoded) patch.data = value.data;
      else encoded = next;
    }
    const next = {...value, ...patch};
    if (Object.keys(next).every((key) => next[key as keyof Channel<T>] === value[key as keyof Channel<T>])) return;
    value = next;
    listeners.forEach((listener) => listener());
  }
  return {set, getSnapshot, use: () => useSyncExternalStore(subscribe, getSnapshot)};
}
export const sources = channel<SourceSnapshot>();
export const orders = channel<OrdersSnapshot>();
export const activity = channel<ActivitySnapshot>();
let sourceGeneration = 0, ordersGeneration = 0;
let readingSources = false, readingOrders = false;
let sourceTimer: ReturnType<typeof setTimeout> | undefined;
let orderTimer: ReturnType<typeof setTimeout> | undefined;
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let stopped = true, synchronizing = false;
let sourceSchedule: Schedule | undefined;
let activityEpoch = 0;
export function setSchedule(schedule?: Schedule) { sourceSchedule = schedule; scheduleSources(); }
function scheduleSources() {
  clearTimeout(sourceTimer);
  if (stopped) return;
  const state = sources.getSnapshot();
  const next = sourceSchedule?.enabled ? new Date(sourceSchedule.next_run ?? "").getTime() : NaN;
  const busy = state.busy || state.data?.refreshing;
  if (!state.error && !busy && !Number.isFinite(next)) return;
  const delay = state.error || busy ? 5000 : Math.max(5000, next - Date.now() + 1200);
  sourceTimer = setTimeout(() => {
    if (!sources.getSnapshot().error && !sources.getSnapshot().busy && !sources.getSnapshot().data?.refreshing && Date.now() < next) scheduleSources();
    else void loadSources();
  }, Math.min(delay, 2147483647));
}
function applySources(data: SourceSnapshot) { sources.set({data, error: data.error, loading: false}); setSchedule(data.schedule); }
function applyOrders(data: OrdersSnapshot) { orders.set({data, error: data.error, loading: false}); }
export async function loadSources() {
  if (readingSources || sources.getSnapshot().busy) { scheduleSources(); return; }
  readingSources = true;
  const generation = sourceGeneration;
  try { const data = await api.sources(); if (generation === sourceGeneration) applySources(data); }
  catch (error) { if (generation === sourceGeneration) sources.set({error: String(error instanceof Error ? error.message : error), loading: false}); }
  finally { readingSources = false; scheduleSources(); }
}
export async function loadOrders() {
  if (readingOrders || orders.getSnapshot().busy) return;
  readingOrders = true;
  const generation = ordersGeneration;
  try { const data = await api.orders(); if (generation === ordersGeneration) applyOrders(data); }
  catch (error) { if (generation === ordersGeneration) orders.set({error: String(error instanceof Error ? error.message : error), loading: false}); }
  finally { readingOrders = false; }
}
export async function refreshSources() {
  if (sources.getSnapshot().busy || sources.getSnapshot().data?.refreshing) return;
  sourceGeneration++;
  sources.set({busy: true, message: {text: "正在获取来源订单并处理自动下单…", tone: "info"}});
  try {
    const result = await request("/api/refresh", {method: "POST"});
    if (result.data && typeof result.data === "object" && "items" in result.data) applySources(parseSources(result.data));
    if (!result.ok) throw new Error(responseError(result.data, "获取来源订单失败"));
    sources.set({message: {text: "来源订单已更新，自动下单处理完成。", tone: "success"}});
  } catch (error) { sources.set({error: error instanceof Error ? error.message : String(error), message: undefined}); }
  finally { sources.set({busy: false}); scheduleSources(); }
}
async function refreshOrders() {
  if (orders.getSnapshot().busy || orders.getSnapshot().data?.refreshing) return;
  ordersGeneration++;
  orders.set({busy: true, message: {text: "正在更新持仓和跟踪订单，并处理平仓单…", tone: "info"}});
  try {
    const result = await request("/api/orders/refresh", {method: "POST"});
    if (result.data && typeof result.data === "object" && "orders" in result.data) applyOrders(parseOrders(result.data));
    if (!result.ok) throw new Error(responseError(result.data, "更新 Gate 订单失败"));
    orders.set({message: {text: "持仓和订单已更新，平仓单已处理。", tone: "success"}});
  } catch (error) { orders.set({error: error instanceof Error ? error.message : String(error), message: undefined}); }
  finally { orders.set({busy: false}); }
}
export async function refreshWorkspace() {
  if (synchronizing) return;
  synchronizing = true;
  try { await refreshSources(); await refreshOrders(); }
  finally { synchronizing = false; }
}
async function pollOrders() {
  await loadOrders();
  if (!stopped) orderTimer = setTimeout(pollOrders, orders.getSnapshot().data?.refreshing ? 5000 : 60000);
}
async function pollActivity() {
  if (stopped) return;
  const epoch = activityEpoch;
  const pending = new AbortController(); controller = pending;
  const timeout = setTimeout(() => pending.abort(), 3000);
  try {
    const snapshot = await api.activity(pending.signal);
    if (stopped || epoch !== activityEpoch) return;
    const previous = activity.getSnapshot();
    const settled = previous.data != null && (snapshot.sequence < previous.data.sequence || snapshot.events.some((event) => event.sequence > previous.data!.sequence && event.type === "job-end"));
    activity.set({data: snapshot, error: undefined, loading: false});
    if (previous.error || settled) { void loadSources(); void loadOrders(); }
  } catch (error) { if (!stopped && epoch === activityEpoch) activity.set({error: error instanceof Error && error.name === "AbortError" ? "连接超时" : error instanceof Error ? error.message : String(error), loading: false}); }
  finally { clearTimeout(timeout); if (!stopped && epoch === activityEpoch) activityTimer = setTimeout(pollActivity, activity.getSnapshot().error ? 2000 : 600); }
}
function pause() { stopped = true; activityEpoch++; clearTimeout(sourceTimer); clearTimeout(orderTimer); clearTimeout(activityTimer); controller?.abort(); }
function resume() { if (!stopped) return; stopped = false; void loadSources(); void pollOrders(); void pollActivity(); }
// Start once outside React, so re-renders never create additional pollers or POSTs.
export function startWorkspace() {
  resume();
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", (event) => { if (event.persisted) resume(); });
}
