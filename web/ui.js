export const $ = (id) => document.getElementById(id);

export function setNotice(id, message, tone = "info") {
  const element = $(id);
  element.textContent = message || "";
  element.hidden = !message;
  element.dataset.tone = tone;
}

export function initWorkspace() {
  const control = document.querySelector(".workspace-switch");
  const tabs = Array.from(control.querySelectorAll('[role="tab"]'));
  const scrollPositions = new Map();
  let active = "live";

  function select(tab, {focusPanel = false, remember = true} = {}) {
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
    $("page-context").textContent = tab.textContent.trim();
    document.title = `${tab.textContent.trim()} · 特洛伊资本`;
    if (remember) history.replaceState(null, "", `#${view}`);
    if (focusPanel) $(tab.getAttribute("aria-controls")).focus({preventScroll: true});
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let next;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) next = tabs[(index + 1) % tabs.length];
      else if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = tabs[(index + tabs.length - 1) % tabs.length];
      else if (event.key === "Home") next = tabs[0];
      else if (event.key === "End") next = tabs[tabs.length - 1];
      else return;
      event.preventDefault();
      next.focus({preventScroll: true});
      select(next);
    });
  }
  document.querySelectorAll("[data-workspace]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    const tab = tabs.find((item) => item.dataset.view === link.dataset.workspace);
    if (tab) select(tab, {focusPanel: true});
  }));
  function fromLocation() {
    const tab = tabs.find((item) => item.dataset.view === location.hash.slice(1));
    if (tab) select(tab, {remember: false});
  }
  window.addEventListener("hashchange", fromLocation);
  fromLocation();
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
