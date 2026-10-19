import { $, node } from "./ui.js";
import { activityView, newActivityEvents } from "./activity.js";

const SYNC_MS = 600;
const REQUEST_TIMEOUT_MS = 3000;
const labels = {sources: "来源订单", gate: "Gate 交易接口", orders: "持仓与跟踪订单"};
let snapshot;
let sequence;
let timer;
let controller;
let stopped = false;
let synchronizing = false;
let epoch = 0;
let readError = "";
const counts = {sources: 0, orders: 0};

function eventText(event) {
  const subject = labels[event.node || event.job];
  if (event.type === "job-start") return `${subject} · 任务开始`;
  if (event.type === "job-end") return `${subject} · ${event.success ? "任务完成" : "任务失败"}`;
  const operation = event.write ? "提交交易" : "获取数据";
  if (event.type === "request-start") return `${subject} · ${operation}中`;
  return `${subject} · ${operation}${event.status >= 200 && event.status < 300 ? "完成" : "失败"} · ${event.status || "网络异常"}`;
}

function render(connected) {
  const view = activityView(snapshot, connected);
  $("flow-panel").dataset.state = view.state;
  $("flow-state").textContent = {
    offline: "执行状态连接中断", busy: "正在执行", error: "执行异常",
    ready: "本轮执行完成", idle: "等待任务"
  }[view.state];
  for (const name of ["sources", "gate"]) {
    const state = view.nodes[name];
    const link = $(`flow-link-${name}`);
    link.dataset.active = String(state.active);
    link.dataset.write = String(state.write);
    $(`flow-node-${name}`).dataset.state = state.state;
    $(name === "sources" ? "flow-source-status" : "flow-gate-status").textContent =
      !connected ? "状态不可用" : state.active ? state.write ? "正在提交交易" : "正在获取实盘数据"
        : state.state === "error" ? "请求失败" : state.completed ? `已完成 ${state.completed} 次请求` : "等待请求";
  }
  $("flow-node-workspace").dataset.state = view.state;
  $("flow-workspace-status").textContent = !connected ? "等待重新连接"
    : view.running ? Object.values(view.nodes).some((state) => state.active) ? "接口执行中" : "任务处理中 / 等待交易锁"
      : view.state === "error" ? "请查看执行结果" : view.state === "ready" ? "执行完成" : "等待任务";
  $("flow-workspace-count").textContent = `${counts.sources} 条来源 · ${counts.orders} 条跟踪`;
  $("flow-summary").textContent = `本次运行 · ${view.completed} 次请求完成 · ${view.failed} 次请求失败`;
  $("flow-caption").textContent = connected
    ? "仅实际请求期间显示流动；交易提交流向 Gate，数据获取流向工作台。状态每 600 毫秒同步。"
    : `状态同步中断，动画已停止。${readError || "连接建立中"}，正在自动重连。`;
  $("flow-fetch").disabled = !connected || view.running || synchronizing;
  $("flow-fetch").textContent = view.running || synchronizing ? "正在更新…" : "更新订单";
}

function renderEvents() {
  const container = $("flow-events");
  container.replaceChildren();
  for (const event of (snapshot.events || []).slice(-5).reverse()) {
    const row = node("li");
    const time = node("time", "", new Date(event.at).toLocaleTimeString("zh-CN", {hour12: false}));
    time.dateTime = event.at;
    row.append(time, node("span", "", eventText(event)));
    if ((event.type === "job-end" && !event.success) || (event.type === "request-end" && !(event.status >= 200 && event.status < 300)))
      row.classList.add("failed");
    container.append(row);
  }
  if (!container.children.length) container.append(node("li", "", "等待真实执行记录"));
}

function acknowledge(events) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const name of ["sources", "gate"]) {
    const event = [...events].reverse().find((item) => item.node === name && item.type === "request-end");
    if (!event) continue;
    const success = event.status >= 200 && event.status < 300;
    const card = $(`flow-node-${name}`).querySelector("rect");
    card.getAnimations().forEach((animation) => animation.cancel());
    card.animate([{stroke: success ? "#7eab51" : "#ce6956", strokeWidth: 4}, {strokeWidth: 1}], {duration: 450});
  }
}

// Cached table data only updates counts; it cannot start motion.
export function updateFlow(channel, data) {
  counts[channel] = data.orders?.length || 0;
  if (snapshot) render(!readError);
}

export function initFlow({refresh, onSettled}) {
  const narrow = window.matchMedia("(max-width: 600px)");
  function layout() {
    const mobile = narrow.matches;
    const map = $("flow-panel").querySelector("svg");
    map.setAttribute("viewBox", mobile ? "0 0 320 550" : "0 0 960 260");
    map.querySelector(":scope > rect").setAttribute("height", mobile ? "550" : "260");
    $("flow-node-sources").setAttribute("transform", mobile ? "translate(55 20)" : "translate(44 66)");
    $("flow-node-workspace").setAttribute("transform", mobile ? "translate(54 195)" : "translate(374 50)");
    $("flow-node-gate").setAttribute("transform", mobile ? "translate(55 402)" : "translate(706 66)");
    for (const name of ["sources", "gate"]) {
      const path = mobile ? name === "sources" ? "M 160 148 V 195" : "M 160 402 V 355"
        : name === "sources" ? "M 254 130 H 374" : "M 586 130 H 706";
      $(`flow-link-${name}`).querySelectorAll("path").forEach((link) => link.setAttribute("d", path));
    }
  }
  narrow.addEventListener("change", layout);
  layout();
  async function sync() {
    if (stopped) return;
    const generation = epoch;
    const pending = new AbortController();
    controller = pending;
    const timeout = setTimeout(() => pending.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/activity", {cache: "no-store", signal: pending.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json();
      if (stopped || generation !== epoch) return;
      if (!Number.isSafeInteger(next.sequence) || !next.jobs || !next.requests || !Array.isArray(next.events))
        throw new Error("执行状态格式错误");
      const events = newActivityEvents(next, sequence);
      const changed = next.sequence !== sequence;
      const recovered = Boolean(readError) || (sequence != null && next.sequence < sequence);
      snapshot = next;
      sequence = next.sequence;
      readError = "";
      render(true);
      if (changed) renderEvents();
      acknowledge(events);
      $("flow-synced").textContent = `同步于 ${new Date().toLocaleTimeString("zh-CN", {hour12: false})}`;
      if (recovered || events.some((event) => event.type === "job-end")) onSettled();
    } catch (error) {
      if (stopped || generation !== epoch) return;
      readError = error.name === "AbortError" ? "连接超时" : error.message;
      render(false);
    } finally {
      clearTimeout(timeout);
      if (!stopped && generation === epoch) timer = setTimeout(sync, readError ? 2000 : SYNC_MS);
    }
  }
  $("flow-fetch").addEventListener("click", async () => {
    synchronizing = true;
    render(!readError && Boolean(snapshot));
    try { await refresh(); }
    finally { synchronizing = false; render(!readError && Boolean(snapshot)); }
  });
  window.addEventListener("pagehide", () => { stopped = true; epoch++; clearTimeout(timer); controller?.abort(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) { stopped = false; sync(); } });
  render(false);
  sync();
}
