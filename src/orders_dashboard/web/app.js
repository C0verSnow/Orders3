"use strict";
const $ = (id) => document.getElementById(id);
let items = [];
let orderRows = [];
let refreshing = false;
let loading = false;
let scheduleDirty = false;
let savingSchedule = false;
let currentSchedule = null;
const dateFormat = new Intl.DateTimeFormat("zh-CN", {dateStyle: "medium", timeStyle: "medium"});
function dateText(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date);
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
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
    container.append(node("div", "empty", items.length ? "没有匹配的结果，试试其他关键词或状态。" : "暂无抓取数据，点击「重新抓取」获取来源内容。"));
    return;
  }
  const wrapper = node("div", "table-scroll");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", "抓取结果表格，可横向滚动查看全部列");
  const table = node("table", "data-table");
  const caption = node("caption", "sr-only", "来源及订单数据，每个订单一行；无订单的来源保留一行。");
  const thead = node("thead");
  const header = node("tr");
  for (const label of ["来源", "状态", "交易对", "方向", "价格", "数量", "金额", "订单时间", "来源创建时间", "抓取内容"]) {
    const th = node("th", "", label);
    th.scope = "col";
    header.append(th);
  }
  thead.append(header);
  const tbody = node("tbody");
  let rowCount = 0;
  for (const {item, position} of visible) {
    const orders = orderRows.filter((order) => order.record_position === position);
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
      for (const name of ["symbol", "side", "price", "size", "value"]) {
        tr.append(node("td", name === "symbol" ? "table-symbol" : "", order[name] || "—"));
      }
      const timestamp = order.orders_time;
      tr.append(node("td", "table-date", timestamp && /^\d+$/.test(timestamp) ? dateText(Number(timestamp)) : timestamp || "—"));
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
  table.append(caption, thead, tbody);
  wrapper.append(table);
  container.append(wrapper);
}
function notice(message) {
  $("notice").textContent = message || "";
  $("notice").hidden = !message;
}
function scheduleNotice(message) {
  $("schedule-notice").textContent = message || "";
  $("schedule-notice").hidden = !message;
}
function updateCountdown() {
  const next = currentSchedule?.enabled && currentSchedule.next_run ? new Date(currentSchedule.next_run).getTime() : NaN;
  const seconds = Math.ceil((next - Date.now()) / 1000);
  $("schedule-countdown").textContent = !Number.isFinite(next) ? "无待执行任务" : seconds <= 0 ? "等待执行及状态同步" : `剩余 ${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分 ${seconds % 60} 秒`;
}
function applySchedule(schedule, running = false) {
  currentSchedule = schedule;
  $("schedule-status").textContent = schedule?.enabled ? (running ? "正在抓取" : "已启用 · 服务器本地时间") : "已停用";
  $("schedule-next").textContent = dateText(schedule?.next_run);
  const results = {completed: "完成", error: "失败", busy: "已有抓取任务，已跳过"};
  $("schedule-last").textContent = dateText(schedule?.last_run) + (schedule?.last_result ? `（${results[schedule.last_result] || schedule.last_result}）` : "");
  // Polling must not overwrite a user's unfinished changes.
  if (!scheduleDirty && !savingSchedule) {
    $("schedule-enabled").checked = Boolean(schedule?.enabled);
    $("schedule-cron").value = schedule?.cron || "";
    syncPreset();
  }
  updateCountdown();
}
function syncPreset() {
  const expression = $("schedule-cron").value.trim();
  $("schedule-preset").value = Array.from($("schedule-preset").options).some((option) => option.value === expression) ? expression : "";
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
  notice(data.error);
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
  if (refreshing || loading) return;
  refreshing = true;
  $("refresh").disabled = true;
  $("refresh").textContent = "↻ 正在抓取…";
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
    $("refresh").disabled = false;
    $("refresh").textContent = "↻ 重新抓取";
  }
});
$("search").addEventListener("input", render);
$("filter").addEventListener("change", render);
$("schedule-preset").addEventListener("change", () => {
  if ($("schedule-preset").value) $("schedule-cron").value = $("schedule-preset").value;
  scheduleDirty = true;
  scheduleNotice("配置尚未保存。");
});
for (const id of ["schedule-cron", "schedule-enabled"]) {
  $(id).addEventListener("input", () => {
    scheduleDirty = true;
    syncPreset();
    scheduleNotice("配置尚未保存。");
  });
}
$("schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingSchedule) return;
  const expression = $("schedule-cron").value.trim();
  if (expression.split(/\s+/).length !== 5) {
    scheduleNotice("Cron 必须包含五段：分 时 日 月 星期。");
    return;
  }
  savingSchedule = true;
  const controls = Array.from($("schedule-form").elements);
  const enabled = $("schedule-enabled").checked;
  controls.forEach((control) => { control.disabled = true; });
  $("schedule-save").textContent = "正在保存…";
  try {
    const response = await fetch("/api/schedule", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({enabled, cron: expression})
    });
    const schedule = await response.json();
    if (!response.ok) throw new Error(schedule.error || "保存失败");
    scheduleDirty = false;
    savingSchedule = false;
    applySchedule(schedule);
    scheduleNotice("配置已保存到 config，并立即生效。正在执行的抓取会正常完成。");
  } catch (error) { scheduleNotice(error.message); }
  finally {
    savingSchedule = false;
    controls.forEach((control) => { control.disabled = false; });
    $("schedule-save").textContent = "保存定时配置";
  }
});
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
  ordersNotice(data.error);
  const container = $("orders-records");
  container.replaceChildren();
  if (!data.orders.length) {
    container.append(node("div", "empty", data.updated_at ? "目前没有跟踪订单。" : "点击「获取跟踪订单」加载列表。"));
    return;
  }
  const wrapper = node("div", "table-scroll");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", "Gate 跟踪订单表格，可横向滚动查看全部列");
  const table = node("table", "data-table");
  const thead = node("thead");
  const header = node("tr");
  for (const label of ["订单 ID", "合约", "数量", "激活价格", "仅减仓", "原始状态", "接口时间"]) {
    const th = node("th", "", label);
    th.scope = "col";
    header.append(th);
  }
  thead.append(header);
  const tbody = node("tbody");
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
  table.append(thead, tbody);
  wrapper.append(table);
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
  if (fetchingOrders || loadingOrders) return;
  fetchingOrders = true;
  $("orders-refresh").disabled = true;
  $("orders-refresh").textContent = "正在获取订单…";
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
    $("orders-refresh").disabled = false;
    $("orders-refresh").textContent = "获取跟踪订单";
  }
});
loadOrders();
setInterval(loadOrders, 15000);
loadData();
setInterval(loadData, 15000);
setInterval(updateCountdown, 1000);
