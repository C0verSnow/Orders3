export const $ = (id) => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat("zh-CN", {dateStyle: "medium", timeStyle: "medium"});

export function dateText(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date);
}
export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
export function createTable(labels, captionText, className = "") {
  const wrapper = node("div", "table-scroll");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", `${captionText}，可横向滚动查看全部列`);
  const table = node("table", `data-table ${className}`.trim());
  const caption = node("caption", "sr-only", captionText);
  const thead = node("thead");
  const header = node("tr");
  for (const label of labels) {
    const th = node("th", "", label);
    th.scope = "col";
    header.append(th);
  }
  thead.append(header);
  const tbody = node("tbody");
  table.append(caption, thead, tbody);
  wrapper.append(table);
  return {wrapper, tbody};
}

export function updateFetchButton(id, busy, label) {
  const button = $(id);
  button.disabled = busy;
  button.textContent = busy ? "正在获取订单…" : label;
  button.setAttribute("aria-busy", String(busy));
}
