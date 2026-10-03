import { $, dateText, node, createTable, updateFetchButton } from "./ui.js";
import { initSettings } from "./settings.js";
import { initSchedule, applySchedule } from "./schedule.js";
import { initStartup } from "./startup.js";

const fastStartup = document.body.classList.contains("startup-enabled");
let items = [];
let orderRows = [];
let refreshing = false;
let loading = false;
let updatingData = false;
let updatingOrders = false;
const SNAPSHOT_POLL_MS = 15000;
const ACTIVE_POLL_MS = 1000;

function bodyText(item) {
  return typeof item.data === "string" ? item.data : JSON.stringify(item.data, null, 2) ?? "";
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
  const openRecords = new Set(Array.from(container.querySelectorAll("details[open]")).map((el) => el.dataset.key));
  container.replaceChildren();
  if (!visible.length) {
    $("count").textContent = `0 / ${items.length} 来源`;
    container.append(node("div", "empty", items.length ? "没有匹配的结果，试试其他关键词或状态。" : "暂无来源订单，点击「获取订单」加载数据。"));
    return;
  }
  const {wrapper, tbody} = createTable(
    ["来源", "状态", "交易对", "方向", "价格", "数量", "订单时间", "来源创建时间", "抓取内容"],
    "来源及订单数据，每个订单一行；无订单的来源保留一行。", "source-table");
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
      const link = node(url && ["http:", "https:"].includes(url.protocol) ? "a" : "span", "source-url", item.url || "未提供 URL");
      if (link.tagName === "A") { link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      source.append(link);
      const status = node("td");
      status.append(node("span", `badge${failed(item) ? " failed" : ""}`, `${failed(item) ? "失败" : "成功"} · ${item.status_code ?? "无状态码"}`));
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
  $("count").textContent = `${visible.length} / ${items.length} 来源 · ${rowCount} 行`;
  container.append(wrapper);
}
function notice(message) {
  $("notice").textContent = message || "";
  $("notice").hidden = !message;
}
function applyData(data) {
  if (!Array.isArray(data.items) || data.items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error("服务器数据格式错误");
  items = data.items;
  orderRows = Array.isArray(data.orders) ? data.orders : [];
  $("total").textContent = items.length;
  $("failed").textContent = items.filter(failed).length;
  $("success").textContent = items.filter((item) => !failed(item)).length;
  const date = new Date(data.updated_at);
  $("updated").textContent = data.updated_at && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString("zh-CN", {hour12: false}) : "—";
  $("update-date").textContent = data.updated_at ? date.toLocaleDateString("zh-CN") : "尚未生成 data.db 数据库";
  applySchedule(data.schedule, data.refreshing);
  updatingData = Boolean(data.refreshing);
  $("source-updated").textContent = dateText(data.updated_at);
  updateFetchButton("refresh", refreshing || updatingData, "获取订单");
  notice(data.error || (updatingData ? "正在后台更新，当前显示本地缓存。" : ""));
  render();
}
async function loadData() {
  if (loading || refreshing) return;
  loading = true;
  try {
    const response = await fetch("/api/data", {cache: "no-store"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取数据失败");
    applyData(data);
  } catch (error) { notice(`无法读取本地数据：${error.message}`); }
  finally { loading = false; }
}
$("refresh").addEventListener("click", async () => {
  if (refreshing || loading || updatingData) return;
  refreshing = true;
  updateFetchButton("refresh", true, "获取订单");
  notice("正在读取来源并抓取内容，请稍候…");
  try {
    const response = await fetch("/api/refresh", {method: "POST"});
    const data = await response.json();
    if (Array.isArray(data.items)) applyData(data);
    if (!response.ok) throw new Error(data.error || "抓取失败");
    notice("抓取完成，数据库已更新。");
  } catch (error) { notice(error.message); }
  finally {
    refreshing = false;
    updateFetchButton("refresh", updatingData, "获取订单");
  }
});
$("search").addEventListener("input", render);
$("filter").addEventListener("change", render);
let fetchingOrders = false;
let loadingOrders = false;
function ordersNotice(message) {
  $("orders-notice").textContent = message || "";
  $("orders-notice").hidden = !message;
}
function applyOrders(data) {
  if (!Array.isArray(data.orders)) throw new Error("订单列表格式错误");
  $("orders-count").textContent = `${data.orders.length} 条`;
  $("orders-updated").textContent = dateText(data.updated_at);
  updatingOrders = Boolean(data.refreshing);
  updateFetchButton("orders-refresh", fetchingOrders || updatingOrders, "获取跟踪订单");
  ordersNotice(data.error || (updatingOrders ? "正在后台获取最新订单，当前显示本地缓存。" : ""));
  const container = $("orders-records");
  container.replaceChildren();
  if (!data.orders.length) {
    container.append(node("div", "empty", data.updated_at ? "目前没有跟踪订单。" : "点击「获取跟踪订单」加载列表。"));
    return;
  }
  const {wrapper, tbody} = createTable(
    ["订单 ID", "合约", "数量", "激活价格", "仅减仓", "原始状态", "接口时间"],
    "Gate 跟踪订单", "trailing-table");
  for (const order of data.orders) {
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
  try {
    const response = await fetch("/api/orders", {cache: "no-store"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取订单失败");
    applyOrders(data);
  } catch (error) { ordersNotice(error.message); }
  finally { loadingOrders = false; }
}
$("orders-refresh").addEventListener("click", async () => {
  if (fetchingOrders || loadingOrders || updatingOrders) return;
  fetchingOrders = true;
  updateFetchButton("orders-refresh", true, "获取跟踪订单");
  ordersNotice("正在获取最新跟踪订单，请稍候…");
  try {
    const response = await fetch("/api/orders/refresh", {method: "POST"});
    const data = await response.json();
    if (Array.isArray(data.orders)) applyOrders(data);
    if (!response.ok) throw new Error(data.error || "获取订单失败");
    ordersNotice("订单已更新。");
  } catch (error) { ordersNotice(error.message); }
  finally {
    fetchingOrders = false;
    updateFetchButton("orders-refresh", updatingOrders, "获取跟踪订单");
  }
});
async function pollOrders() {
  await loadOrders();
  setTimeout(pollOrders, updatingOrders ? ACTIVE_POLL_MS : SNAPSHOT_POLL_MS);
}
async function pollData() {
  await loadData();
  setTimeout(pollData, updatingData ? ACTIVE_POLL_MS : SNAPSHOT_POLL_MS);
}
initSettings();
initSchedule();
initStartup(fastStartup);
pollOrders();
pollData();
