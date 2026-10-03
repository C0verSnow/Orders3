export const $ = (id) => document.getElementById(id);

export function initWorkspace() {
  const control = document.querySelector(".workspace-switch");
  const tabs = Array.from(control.querySelectorAll('[role="tab"]'));
  const scrollPositions = new Map();
  let active = "live";

  function select(tab) {
    const view = tab.dataset.view;
    if (view === active) return;
    scrollPositions.set(active, window.scrollY);
    active = view;
    control.dataset.active = view;
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      $(item.getAttribute("aria-controls")).hidden = !selected;
    }
    window.scrollTo({top: scrollPositions.get(view) || 0, behavior: "instant"});
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      else if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs[tabs.length - 1];
      else return;
      event.preventDefault();
      next.focus({preventScroll: true});
      select(next);
    });
  }
}
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
