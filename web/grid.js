import { $, node, createTable } from "./ui.js";

// Decimal strings stay exact even beyond Number.MAX_SAFE_INTEGER.
export function compareDecimal(a, b) {
  const parse = (value) => {
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
  const result = Math.sign(left.integer.length - right.integer.length) ||
    left.integer.localeCompare(right.integer) || left.fraction.padEnd(width, "0").localeCompare(right.fraction.padEnd(width, "0"));
  return left.negative ? -result : result;
}

export function gridPage(rows, {query = "", status = "all", compare, page = 1, pageSize = 25, matches = () => true} = {}) {
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter((row) => matches(row, needle, status));
  if (compare) filtered.sort(compare);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  return {rows: filtered.slice((current - 1) * pageSize, current * pageSize), matched: filtered.length, total: rows.length, page: current, pages};
}

export function mountGrid({prefix, containerId, columns, caption, className, matches, comparators, renderRow, searchId = `${prefix}-search`, filterId = `${prefix}-filter`}) {
  let rows = [], page = 1, previousSnapshot;
  const expanded = new Set();
  const container = $(containerId);
  container.addEventListener("toggle", (event) => {
    const details = event.target;
    if (details.tagName !== "DETAILS" || !details.dataset.key) return;
    if (details.open) expanded.add(details.dataset.key);
    else if (details.isConnected) expanded.delete(details.dataset.key);
  }, true);
  function render() {
    const view = gridPage(rows, {query: $(searchId).value, status: $(filterId).value,
      compare: comparators[$(`${prefix}-sort`).value], page, matches});
    page = view.page;
    $(`${prefix}-page`).textContent = `${view.matched} / ${view.total} 条 · 第 ${page} / ${view.pages} 页`;
    $(`${prefix}-prev`).disabled = page === 1;
    $(`${prefix}-next`).disabled = page === view.pages;
    const scrollLeft = container.querySelector(".table-scroll")?.scrollLeft || 0;
    const activeKey = document.activeElement?.closest("details")?.dataset.key;
    // Capture open records synchronously; toggle events may be delivered after a render.
    container.querySelectorAll("details[open]").forEach((details) => expanded.add(details.dataset.key));
    const {wrapper, tbody} = createTable(columns, caption, className);
    for (const row of view.rows) tbody.append(renderRow(row, expanded));
    if (view.rows.length) container.replaceChildren(wrapper);
    else container.replaceChildren(node("div", "empty", rows.length ? "没有匹配的记录。调整关键词或筛选条件后重试。" : "当前快照暂无记录。成功同步后的数据将在这里显示。"));
    wrapper.scrollLeft = scrollLeft;
    if (activeKey) Array.from(container.querySelectorAll("details")).find((details) => details.dataset.key === activeKey)?.querySelector("summary")?.focus({preventScroll: true});
  }
  for (const id of [searchId, filterId, `${prefix}-sort`]) {
    $(id).addEventListener(id === searchId ? "input" : "change", () => { page = 1; render(); });
  }
  $(`${prefix}-prev`).addEventListener("click", () => { page--; render(); });
  $(`${prefix}-next`).addEventListener("click", () => { page++; render(); });
  return (nextRows) => {
    const snapshot = JSON.stringify(nextRows);
    rows = nextRows;
    if (snapshot !== previousSnapshot) { previousSnapshot = snapshot; render(); }
  };
}
