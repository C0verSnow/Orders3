import { $, dateText, node, createTable } from "./ui.js";
import { mountGrid, compareDecimal } from "./grid.js";
import { selectOverview, exactValue, pnlTone } from "./overview.js";

const textMatch = (values, query) => values.some((value) => String(value ?? "").toLowerCase().includes(query));
const byContract = (a, b) => String(a.contract ?? "").localeCompare(String(b.contract ?? ""));
const byTime = (a, b) => (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0);
export const sourceFailed = (item) => Boolean(item.error) || Number(item.status_code) >= 400;
export function positionDirection(position) {
  const size = String(position.size ?? "");
  return !size ? "unknown" : /^-?0+$/.test(size) ? "flat" : size.startsWith("-") ? "short" : "long";
}
const directionLabels = {unknown: "—", flat: "空仓", short: "空头", long: "多头"};

export function initBusinessTables() {
  const updateOrders = mountGrid({prefix: "tracking", containerId: "orders-records", caption: "Gate 跟踪订单", className: "trailing-table",
    columns: ["订单 ID", "合约", "数量（张）", "激活价格", "仅减仓", "原始状态", "接口时间"],
    matches: (row, query, status) => textMatch([row.id, row.contract, row.amount, row.activation_price], query) &&
      (status === "all" || String(row.original_status) === status),
    comparators: {recent: byTime, contract: byContract, amount: (a, b) => compareDecimal(b.amount, a.amount)},
    renderRow(order) {
      const tr = node("tr");
      for (const field of ["id", "contract", "amount", "activation_price"]) {
        tr.append(node("td", field === "contract" ? "table-symbol" : ["amount", "activation_price"].includes(field) ? "numeric" : "", exactValue(order[field])));
      }
      const status = node("td");
      status.append(node("span", "badge status-code", `状态 ${exactValue(order.original_status)}`));
      tr.append(node("td", "", order.reduce_only ? "是" : "否"), status, node("td", "table-date", dateText(order.timestamp)));
      return tr;
    }
  });
  const updatePositions = mountGrid({prefix: "holdings", containerId: "positions-records", caption: "Gate 持仓与计算平仓价格", className: "positions-table",
    columns: ["合约", "方向", "持仓数量（张）", "开仓价格", "持仓价值（USDT）", "最大杠杆", "未实现盈亏（USDT）", "已实现盈亏（USDT）", "初始保证金（USDT）", "标记价格", "计算平仓价格"],
    matches: (row, query, status) => textMatch([row.contract, directionLabels[positionDirection(row)]], query) &&
      (status === "all" || positionDirection(row) === status),
    comparators: {contract: byContract, pnl: (a, b) => compareDecimal(b.unrealised_pnl, a.unrealised_pnl), value: (a, b) => compareDecimal(b.value, a.value)},
    renderRow(position) {
      const tr = node("tr");
      tr.append(node("td", "table-symbol", exactValue(position.contract)), node("td", "", directionLabels[positionDirection(position)]));
      for (const field of ["size", "entry_price", "value", "leverage_max", "unrealised_pnl", "realised_pnl", "initial_margin", "mark_price", "close_price"]) {
        const cell = node("td", "numeric", exactValue(position[field]));
        if (field.endsWith("pnl")) cell.dataset.tone = pnlTone(position[field]);
        tr.append(cell);
      }
      return tr;
    }
  });
  const updateSources = mountGrid({prefix: "source", containerId: "records", searchId: "search", filterId: "filter",
    caption: "Supabase 来源订单，每个订单一行；原始记录可展开", className: "source-table",
    columns: ["来源订单", "状态", "交易对", "方向", "价格", "数量", "订单时间", "创建时间", "订单内容"],
    matches: ({item, order}, query, status) => (status === "all" || sourceFailed(item) === (status === "failed")) &&
      textMatch([JSON.stringify(item), JSON.stringify(order)], query),
    comparators: {recent: (a, b) => (new Date(b.item.created_at).getTime() || 0) - (new Date(a.item.created_at).getTime() || 0),
      original: (a, b) => a.position - b.position, contract: (a, b) => byContract(a.order, b.order)},
    renderRow({item, order, position}, expanded) {
      const tr = node("tr");
      const source = node("td", "table-source");
      source.append(node("span", "source-index", String(position + 1).padStart(2, "0")));
      let url;
      try { url = new URL(item.url); } catch { /* Historical text stays text. */ }
      const link = node(url && ["http:", "https:"].includes(url.protocol) ? "a" : "span", "source-url", item.contract ? `订单 ${item.id ?? position + 1}` : item.url || "历史来源");
      if (link.tagName === "A") { link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; }
      source.append(link);
      const status = node("td");
      status.append(node("span", `badge${sourceFailed(item) ? " failed" : ""}`, sourceFailed(item) ? `失败 · ${item.status_code ?? "无状态码"}` : item.contract ? "已同步" : `成功 · ${item.status_code ?? "无状态码"}`));
      if (item.error) status.append(node("p", "error-text", item.error));
      tr.append(source, status);
      for (const field of ["contract", "side", "activation_price", "amount"]) tr.append(node("td", field === "contract" ? "table-symbol" : ["activation_price", "amount"].includes(field) ? "numeric" : "", exactValue(order[field])));
      tr.append(node("td", "table-date", order.timestamp == null ? "—" : dateText(Number(order.timestamp))), node("td", "table-date", dateText(item.created_at)));
      const content = node("td", "table-content");
      const text = typeof item.data === "string" ? item.data : JSON.stringify(item.data ?? item, null, 2) ?? "";
      content.append(node("div", "table-preview", text ? text.slice(0, 100) + (text.length > 100 ? "…" : "") : "—"));
      const details = node("details");
      details.dataset.key = `${position}:${order.order_index ?? "none"}`;
      details.open = expanded.has(details.dataset.key);
      details.append(node("summary", "", "查看完整记录"), node("pre", "", JSON.stringify(item, null, 2)));
      content.append(details);
      tr.append(content);
      return tr;
    }
  });
  return {
    orders(rows) { const visible = rows.filter((row) => Number(row.original_status) !== 5); $("orders-count").textContent = `${visible.length} 条`; updateOrders(visible); },
    positions(rows) { $("positions-count").textContent = `${rows.length} 条`; updatePositions(rows); },
    sources(items, orders) {
      const grouped = new Map();
      for (const order of orders) { const group = grouped.get(order.record_position) || []; group.push(order); grouped.set(order.record_position, group); }
      const rows = items.flatMap((item, position) => (grouped.get(position) || [{}]).map((order) => ({item, order, position})));
      $("count").textContent = `${items.length} 条来源 · ${rows.length} 行`;
      updateSources(rows);
    }
  };
}

export function initOverview() {
let overviewOrders = [];
let overviewPage = 1;
function renderOverview() {
  const view = selectOverview(overviewOrders, {query: $("overview-search").value,
    status: $("overview-status").value, sort: $("overview-sort").value, page: overviewPage});
  overviewPage = view.page;
  $("overview-count").textContent = `${view.total} 条`;
  $("overview-page").textContent = `${view.matched} 条匹配 · 第 ${view.page} / ${view.pages} 页`;
  $("overview-prev").disabled = view.page === 1;
  $("overview-next").disabled = view.page === view.pages;
  const container = $("overview-records");
  const scrollLeft = container.querySelector(".table-scroll")?.scrollLeft || 0;
  container.replaceChildren();
  if (!view.rows.length) {
    container.append(node("div", "empty", view.total ? "没有匹配订单。请调整搜索或状态。" : "当前快照没有可显示的跟踪订单；状态 5 按原规则隐藏。"));
    return;
  }
  const {wrapper, tbody} = createTable(["合约 / 订单 ID", "数量（张）", "激活价格", "原始状态", "仅减仓", "接口时间"], "跟踪订单速览，每页最多 8 条", "overview-table");
  for (const order of view.rows) {
    const row = node("tr");
    const symbol = node("td", "table-symbol", exactValue(order.contract));
    symbol.append(node("small", "order-id", exactValue(order.id)));
    row.append(symbol, node("td", "numeric", exactValue(order.amount)), node("td", "numeric", exactValue(order.activation_price)));
    const status = node("td");
    status.append(node("span", "badge status-code", `状态 ${exactValue(order.original_status)}`));
    row.append(status, node("td", "", order.reduce_only ? "是" : "否"), node("td", "table-date", dateText(order.timestamp)));
    tbody.append(row);
  }
  container.append(wrapper);
  wrapper.scrollLeft = scrollLeft;
}
for (const id of ["overview-search", "overview-status", "overview-sort"]) {
  $(id).addEventListener(id.endsWith("search") ? "input" : "change", () => { overviewPage = 1; renderOverview(); });
}
$("overview-prev").addEventListener("click", () => { overviewPage--; renderOverview(); });
$("overview-next").addEventListener("click", () => { overviewPage++; renderOverview(); });


  return (rows) => { overviewOrders = rows; renderOverview(); };
}
