import { $, dateText, node, createTable, updateFetchButton, initWorkspace } from "./ui.js";
import { initSettings } from "./settings.js";
import { initSchedule, applySchedule } from "./schedule.js";
import { initStartup } from "./startup.js";
import { initFlow, updateFlow } from "./flow.js";

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

function bodyText(item) {
  return typeof item.data === "string" ? item.data : JSON.stringify(item.data ?? item, null, 2) ?? "";
}
function failed(item) {
  return Boolean(item.error) || Number(item.status_code) >= 400;
}
function render() {
  const query = $("search").value.trim().toLowerCase();
  const filter = $("filter").value;
  const visible = items.map((item, position) => ({item, position})).filter(({item}) =>
    (filter === "all" || failed(item) === (filter === "failed")) && JSON.stringify(item).toLowerCase().includes(query));
  const container = $("records");
  const scrollLeft = container.querySelector(".table-scroll")?.scrollLeft || 0;
  const openRecords = new Set(Array.from(container.querySelectorAll("details[open]")).map((el) => el.dataset.key));
  container.replaceChildren();
  if (!visible.length) {
    $("count").textContent = `0 / ${items.length} 来源订单`;
    container.append(node("div", "empty", items.length ? "没有匹配的结果，试试其他关键词或状态。" : "暂无来源订单，点击「获取订单」加载数据。"));
    return;
  }
  const {wrapper, tbody} = createTable(
    ["来源订单", "状态", "交易对", "方向", "价格", "数量", "订单时间", "创建时间", "订单内容"],
    "Supabase 来源订单，每个订单一行。", "source-table");
  let rowCount = 0;
  const ordersBySource = new Map();
  for (const order of orderRows) {
    const group = ordersBySource.get(order.record_position) || [];
    group.push(order);
    ordersBySource.set(order.record_position, group);
  }
  for (const {item, position} of visible) {
    const orders = ordersBySource.get(position) || [];
    for (const order of orders.length ? orders : [{}]) {
      rowCount++;
      const tr = node("tr");
      const source = node("td", "table-source");
      source.append(node("span", "source-index", String(position + 1).padStart(2, "0")));
      let url;
      try { url = new URL(item.url); } catch { /* Invalid URLs stay plain text. */ }
      const link = node(url && ["http:", "https:"].includes(url.protocol) ? "a" : "span", "source-url", item.contract ? `订单 ${item.id ?? position + 1}` : item.url || "历史来源");
      if (link.tagName === "A") { link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      source.append(link);
      const status = node("td");
      status.append(node("span", `badge${failed(item) ? " failed" : ""}`, item.contract ? "已同步" : `${failed(item) ? "失败" : "成功"} · ${item.status_code ?? "无状态码"}`));
      if (item.error) status.append(node("p", "error-text", item.error));
      tr.append(source, status);
      for (const name of ["contract", "side", "activation_price", "amount"]) {
        tr.append(node("td", name === "contract" ? "table-symbol" : "", order[name] || "—"));
      }
      const timestamp = order.timestamp;
      tr.append(node("td", "table-date", timestamp != null ? dateText(Number(timestamp)) : "—"));
      tr.append(node("td", "table-date", dateText(item.created_at)));
      const content = node("td", "table-content");
      const text = bodyText(item);
      content.append(node("div", "table-preview", text ? text.slice(0, 100) + (text.length > 100 ? "…" : "") : "—"));
      const details = node("details");
      details.dataset.key = `${position}:${order.order_index ?? "none"}`;
      details.open = openRecords.has(details.dataset.key);
      details.append(node("summary", "", "查看完整记录"), node("pre", "", JSON.stringify(item, null, 2)));
      content.append(details);
      tr.append(content);
      tbody.append(tr);
    }
  }
  $("count").textContent = `${visible.length} / ${items.length} 来源订单 · ${rowCount} 行`;
  container.append(wrapper);
  wrapper.scrollLeft = scrollLeft;
}
function notice(message) {
  $("notice").textContent = message || "";
  $("notice").hidden = !message;
}
function renderExecution(results = [], containerId = "execution-results", title = "自动下单结果") {
  // Select the latest results before grouping; preserve execution order within each group.
  const actionOrder = {created: 0, stopped: 2};
  results = results.slice(-10).sort((a, b) =>
    (actionOrder[a.action] ?? 1) - (actionOrder[b.action] ?? 1));
  const container = $(containerId);
  container.replaceChildren();
  container.hidden = !results.length;
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
    ? "来源已保存，正在停止旧单并自动发布新单…" : "正在更新来源订单，当前显示上次记录。" : ""));
  renderExecution(Array.isArray(data.execution) ? data.execution : []);
  const tableSnapshot = JSON.stringify([items, orderRows]);
  if (tableSnapshot !== sourceTableSnapshot) {
    sourceTableSnapshot = tableSnapshot;
    render();
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
    notice(`无法读取本地数据：${error.message}`);
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
    notice("订单数据已更新，自动下单处理完成。结果见下方。");
  } catch (error) { notice(error.message); }
  finally {
    refreshing = false;
    updateFetchButton("refresh", updatingData, "获取订单");
    scheduleSourceSync();
  }
}
$("refresh").addEventListener("click", refreshSources);
$("search").addEventListener("input", render);
$("filter").addEventListener("change", render);
let fetchingOrders = false;
let loadingOrders = false;
function ordersNotice(message) {
  for (const id of ["orders-notice", "positions-notice"]) {
    $(id).textContent = message || "";
    $(id).hidden = !message;
  }
}
function renderPositions(positions = []) {
  const container = $("positions-records");
  const scrollLeft = container.querySelector(".table-scroll")?.scrollLeft || 0;
  $("positions-count").textContent = `${positions.length} 条`;
  container.replaceChildren();
  if (!positions.length) {
    container.append(node("div", "empty", "暂无持仓记录。"));
    return;
  }
  const {wrapper, tbody} = createTable(
    ["合约", "方向", "持仓数量（张）", "开仓价格", "持仓价值（USDT）", "最大杠杆",
      "未实现盈亏（USDT）", "已实现盈亏（USDT）", "初始保证金（USDT）", "标记价格", "计算平仓价格"],
    "Gate 持仓与计算平仓价格", "positions-table");
  for (const position of positions) {
    const tr = node("tr");
    tr.append(node("td", "table-symbol", position.contract || "—"));
    const size = String(position.size ?? "");
    tr.append(node("td", "", !size ? "—" : /^-?0+$/.test(size) ? "空仓" : size.startsWith("-") ? "空头" : "多头"));
    for (const field of ["size", "entry_price", "value", "leverage_max", "unrealised_pnl",
      "realised_pnl", "initial_margin", "mark_price", "close_price"]) {
      const value = position[field];
      // Keep decimal text intact, just as in the cached position snapshot.
      tr.append(node("td", "", value === "" || value == null ? "—" : String(value)));
    }
    tbody.append(tr);
  }
  container.append(wrapper);
  wrapper.scrollLeft = scrollLeft;
}
function applyOrders(data) {
  if (!Array.isArray(data.orders)) throw new Error("订单列表格式错误");
  renderPositions(Array.isArray(data.positions) ? data.positions : []);
  $("positions-updated").textContent = dateText(data.updated_at);
  for (const field of ["unrealised_pnl", "realised_pnl"]) {
    const element = $(field.replaceAll("_", "-"));
    const value = data[field];
    element.textContent = value == null ? "—" : new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 4, useGrouping: false
    }).format(Number(value));
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
  ordersNotice(data.error || (updatingOrders ? "正在更新持仓、停止旧平仓单并发布新平仓单，当前显示本地缓存。" : ""));
  updateFlow("orders", {...data, orders: visibleOrders, refreshing: fetchingOrders || updatingOrders});
  const container = $("orders-records");
  container.replaceChildren();
  if (!visibleOrders.length) {
    container.append(node("div", "empty", data.updated_at ? "目前没有跟踪订单。" : "等待跟踪订单数据。"));
    return;
  }
  const {wrapper, tbody} = createTable(
    ["订单 ID", "合约", "数量", "激活价格", "仅减仓", "原始状态", "接口时间"],
    "Gate 跟踪订单", "trailing-table");
  for (const order of visibleOrders) {
    const tr = node("tr");
    for (const field of ["id", "contract", "amount", "activation_price"]) {
      tr.append(node("td", "", order[field] === "" || order[field] == null ? "—" : String(order[field])));
    }
    tr.append(node("td", "", order.reduce_only ? "是" : "否"),
      node("td", "", String(order.original_status)),
      node("td", "table-date", dateText(order.timestamp)));
    tbody.append(tr);
  }
  container.append(wrapper);
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
    ordersNotice(error.message);
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
    ordersNotice("持仓和订单已更新，平仓单已处理。");
  } catch (error) { ordersNotice(error.message); }
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
