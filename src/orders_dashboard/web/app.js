"use strict";
const $ = (id) => document.getElementById(id);
let items = [];
let orderRows = [];
let refreshing = false;
let loading = false;
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
loadData();
setInterval(loadData, 15000);
