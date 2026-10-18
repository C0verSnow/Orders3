import { $, dateText, node, createTable, updateFetchButton, initWorkspace, setNotice } from "./ui.js";
import { initSettings } from "./settings.js";
import { initSchedule, applySchedule } from "./schedule.js";
import { initStartup } from "./startup.js";
import { initFlow, updateFlow } from "./flow.js";
import { exactValue, pnlTone } from "./overview.js";
import { initBusinessTables, initOverview } from "./tables.js";
const tables = initBusinessTables();
const updateOverview = initOverview();
const channelStatus = new Map();
function globalStatus(channel, message, tone) {
  channelStatus.set(channel, {message, tone});
  const entries = [...channelStatus.entries()].filter(([, value]) => value.message && value.tone !== "success");
  setNotice("workspace-alert", entries.map(([name, value]) => `${name}：${value.message}`).join(" · "),
    entries.some(([, value]) => value.tone === "error") ? "error" : "info");
}

const fastStartup = document.body.classList.contains("startup-enabled");
let items = [];
let orderRows = [];
let refreshing = false;
let loading = false;
let updatingData = false;
let updatingOrders = false;
let sourceGeneration = 0;
let ordersGeneration = 0;
const TASK_SYNC_MS = 5000;
const ORDERS_SYNC_MS = 60000;
let sourceSyncTimer;
let sourceSchedule = null;
let sourceTableSnapshot;
let sourceReadFailed = false;
let uptimeMs;
let uptimeReceivedAt;

function renderUptime() {
  if (!Number.isFinite(uptimeMs)) return;
  const seconds = Math.floor((uptimeMs + performance.now() - uptimeReceivedAt) / 1000);
  const days = Math.floor(seconds / 86400);
  const clock = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
  $("uptime").textContent = `${days ? `${days}天 ` : ""}${clock}`;
}

function scheduleSourceSync(schedule = sourceSchedule) {
  sourceSchedule = schedule;
  clearTimeout(sourceSyncTimer);
  const nextRun = schedule?.enabled ? new Date(schedule.next_run).getTime() : NaN;
  if (!sourceReadFailed && !refreshing && !updatingData && (!schedule?.next_run || !Number.isFinite(nextRun))) return;
  // Read shortly after the server's scheduler tick, then follow an active fetch to completion.
  const delay = sourceReadFailed ? 5000 : refreshing || updatingData ? TASK_SYNC_MS
    : Math.max(TASK_SYNC_MS, nextRun - Date.now() + 1200);
  sourceSyncTimer = setTimeout(() => {
    // Long waits exceed the browser timer limit; re-arm without reading data early.
    if (!sourceReadFailed && !refreshing && !updatingData && Date.now() < nextRun) scheduleSourceSync();
    else if (loading || refreshing) scheduleSourceSync();
    else loadData();
  }, Math.min(delay, 2147483647));
}

function notice(message, tone = "info") {
  setNotice("notice", message, tone);
  globalStatus("来源订单", message, tone);
}
function renderExecution(results = [], containerId = "execution-results", title = "自动下单结果") {
  // Select the latest results before grouping; preserve execution order within each group.
  const actionOrder = {created: 0, stopped: 2};
  results = results.slice(-10).sort((a, b) =>
    (actionOrder[a.action] ?? 1) - (actionOrder[b.action] ?? 1));
  const container = $(containerId);
  container.replaceChildren();
  container.hidden = !results.length;
  if (containerId === "close-execution-results") $("close-execution-empty").hidden = Boolean(results.length);
  if (!results.length) return;
  const {wrapper, tbody} = createTable([title, "合约", "数量", "订单 ID", "说明"], `最近 10 条${title}`);
  const labels = {created: "已创建", stopped: "已停止", skipped: "已跳过", failed: "失败"};
  for (const result of results) {
    const tr = node("tr");
    for (const text of [labels[result.action] || result.action, result.contract,
      result.amount, result.id, result.error || result.message])
      tr.append(node("td", "", text == null ? "—" : String(text)));
    tbody.append(tr);
  }
  container.append(wrapper);
}
function applyData(data) {
  if (!Array.isArray(data.items) || data.items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("服务器数据格式错误");
  items = data.items;
  orderRows = Array.isArray(data.orders) ? data.orders : [];
  const date = new Date(data.updated_at);
  $("updated").textContent = data.updated_at && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString("zh-CN", {hour12: false}) : "—";
  $("update-date").textContent = data.updated_at ? date.toLocaleDateString("zh-CN") : "尚未生成 data.db 数据库";
  updatingData = Boolean(data.refreshing);
  applySchedule(data.schedule, data.refreshing);
  $("source-updated").textContent = dateText(data.updated_at);
  updateFetchButton("refresh", refreshing || updatingData, "获取订单");
  notice(data.error || (updatingData ? data.phase === "trading"
    ? "来源已保存，正在停止旧单并自动发布新单…" : "正在更新来源订单，当前显示上次记录。" : ""), data.error ? "error" : "info");
  renderExecution(Array.isArray(data.execution) ? data.execution : []);
  const tableSnapshot = JSON.stringify([items, orderRows]);
  if (tableSnapshot !== sourceTableSnapshot) {
    sourceTableSnapshot = tableSnapshot;
    tables.sources(items, orderRows);
  }
  updateFlow("sources", {...data, refreshing: refreshing || updatingData});
}
async function loadData() {
  if (loading || refreshing) return;
  loading = true;
  const generation = sourceGeneration;
  try {
    const response = await fetch("/api/data", {cache: "no-store"});
    const data = await response.json();
    if (generation !== sourceGeneration) return; // Discard a snapshot predating manual fetch.
    if (!response.ok) throw new Error(data.error || "读取数据失败");
    applyData(data);
    sourceReadFailed = false;
  } catch (error) {
    if (generation !== sourceGeneration) return;
    sourceReadFailed = true;
    notice(`无法读取本地数据：${error.message}`, "error");
  }
  finally {
    loading = false;
    scheduleSourceSync();
  }
}
async function refreshSources() {
  if (refreshing || updatingData) return;
  refreshing = true;
  sourceGeneration++;
  updateFetchButton("refresh", true, "获取订单");
  notice("正在获取实盘订单并处理自动下单，请稍候…");
  try {
    const response = await fetch("/api/refresh", {method: "POST"});
    const data = await response.json();
    if (Array.isArray(data.items)) {
      applyData(data);
      sourceReadFailed = false;
    }
    if (!response.ok) throw new Error(data.error || "抓取失败");
    notice("订单数据已更新，自动下单处理完成。结果见下方。", "success");
  } catch (error) { notice(error.message, "error"); }
  finally {
    refreshing = false;
    updateFetchButton("refresh", updatingData, "获取订单");
    scheduleSourceSync();
  }
}
$("refresh").addEventListener("click", refreshSources);


let fetchingOrders = false;
let loadingOrders = false;
function ordersNotice(message, tone = "info") {
  for (const id of ["orders-notice", "positions-notice", "overview-notice"]) {
    setNotice(id, message, tone);
  }
  globalStatus("Gate", message, tone);
}
function applyOrders(data) {
  if (!Array.isArray(data.orders)) throw new Error("订单列表格式错误");
  updateOverview(data.orders);
  tables.positions(Array.isArray(data.positions) ? data.positions : []);
  $("positions-updated").textContent = dateText(data.updated_at);
  for (const field of ["unrealised_pnl", "realised_pnl"]) {
    const element = $(field.replaceAll("_", "-"));
    const value = data[field];
    element.textContent = exactValue(value);
    element.dataset.tone = pnlTone(value);
    element.title = value == null ? "" : `${value} USDT`;
  }
  if (Number.isFinite(data.uptime_ms)) {
    uptimeMs = data.uptime_ms;
    uptimeReceivedAt = performance.now();
    renderUptime();
  }
  renderExecution(Array.isArray(data.close_execution) ? data.close_execution : [],
    "close-execution-results", "自动平仓下单结果");
  const visibleOrders = data.orders.filter((order) => Number(order.original_status) !== 5);
  $("orders-count").textContent = `${visibleOrders.length} 条`;
  $("orders-updated").textContent = dateText(data.updated_at);
  updatingOrders = Boolean(data.refreshing);
  ordersNotice(data.error || (updatingOrders ? "正在更新持仓、停止旧平仓单并发布新平仓单，当前显示本地缓存。" : ""), data.error ? "error" : "info");
  updateFlow("orders", {...data, orders: visibleOrders, refreshing: fetchingOrders || updatingOrders});
  tables.orders(data.orders);
}

async function loadOrders() {
  if (loadingOrders || fetchingOrders) return;
  loadingOrders = true;
  const generation = ordersGeneration;
  try {
    const response = await fetch("/api/orders", {cache: "no-store"});
    const data = await response.json();
    if (generation !== ordersGeneration) return;
    if (!response.ok) throw new Error(data.error || "读取订单失败");
    applyOrders(data);
  } catch (error) {
    if (generation !== ordersGeneration) return;
    ordersNotice(error.message, "error");
  }
  finally { loadingOrders = false; }
}
async function refreshOrders() {
  if (fetchingOrders || updatingOrders) return;
  fetchingOrders = true;
  ordersGeneration++;
  ordersNotice("正在更新持仓和跟踪订单，并替换本程序的平仓单，请稍候…");
  try {
    const response = await fetch("/api/orders/refresh", {method: "POST"});
    const data = await response.json();
    if (Array.isArray(data.orders)) applyOrders(data);
    if (!response.ok) throw new Error(data.error || "获取订单失败");
    ordersNotice("持仓和订单已更新，平仓单已处理。", "success");
  } catch (error) { ordersNotice(error.message, "error"); }
  finally {
    fetchingOrders = false;
  }
}
async function pollOrders() {
  await loadOrders();
  // Sync the cached Gate list once per minute; manual requests update immediately.
  setTimeout(pollOrders, updatingOrders ? TASK_SYNC_MS : ORDERS_SYNC_MS);
}
initWorkspace();
initFlow({
  // Gate trading is serialized server-side, so refresh the combined workspace in order.
  refresh: async () => { await refreshSources(); await refreshOrders(); },
  onSettled: () => { loadData(); loadOrders(); }
});
initSettings();
initSchedule(scheduleSourceSync);
initStartup(fastStartup);
pollOrders();
loadData();
setInterval(renderUptime, 1000);
