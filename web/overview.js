// Read-only view model: never converts order IDs, prices or amounts to Number.
export function selectOverview(orders = [], {query = "", status = "all", sort = "recent", page = 1, pageSize = 8} = {}) {
  const visible = orders.filter((order) => Number(order.original_status) !== 5);
  const needle = query.trim().toLowerCase();
  const filtered = visible.filter((order) =>
    (status === "all" || String(order.original_status) === status) &&
    [order.id, order.contract, order.amount, order.activation_price].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  const rows = [...filtered].sort((a, b) => sort === "contract"
    ? String(a.contract ?? "").localeCompare(String(b.contract ?? ""))
    : (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  return {rows: rows.slice((current - 1) * pageSize, current * pageSize), total: visible.length,
    matched: rows.length, pages, page: current};
}

export function exactValue(value) {
  return value == null || value === "" ? "—" : String(value);
}

export function pnlTone(value) {
  const text = String(value ?? "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(text) || !/[1-9]/.test(text)) return "neutral";
  return text.startsWith("-") ? "negative" : "positive";
}
