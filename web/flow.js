import { $, dateText } from "./ui.js";

const channels = {
  sources: {ready: false, busy: false, phase: "", error: "", updated: null, summary: "等待来源数据加载"},
  orders: {ready: false, busy: false, error: "", updated: null, summary: "等待 Gate 数据加载"}
};
const descriptions = {
  sources: {
    input: "从 Supabase 分页读取来源地址，再逐条抓取内容。单个来源失败会记录错误，其他来源继续处理。",
    process: "从文本中识别交易对、方向、价格、数量和时间。价格与带单位的数量保留原文，缺失字段显示为 —。",
    store: "保存来源和解析订单后自动下单：先跳过7天内同合约同方向的已完成订单，再停止未完成的开仓追踪单，最后发布新单。执行结果显示在来源区域。"
  },
  orders: {
    input: "使用已保存的 Gate 配置，每分钟独立获取跟踪订单列表；不受来源定时任务开关影响。网页每秒同步本地状态。",
    process: "校验接口响应和订单字段，整理为看板可读的列表，保留价格与数量的字符串精度。",
    store: "完整列表校验通过后，事务更新本地跟踪订单快照。获取失败时继续展示已保存的订单。"
  }
};
let selected = "sources";
let step = "input";
let demo = false;
let paused = false;

function renderFlow() {
  const current = channels[selected];
  const panel = $("flow-panel");
  panel.dataset.channel = selected;
  panel.dataset.state = current.busy ? "busy" : current.error ? "error" : current.updated ? "ready" : "idle";
  panel.dataset.demo = String(demo);
  panel.dataset.motion = String(!paused);
  $("flow-state").textContent = demo ? "动画演示 · 不发起请求"
    : current.busy ? current.phase === "trading" ? "来源已保存 · 正在自动下单" : "正在获取 · 当前显示缓存"
    : current.error ? "获取异常 · 可查看下方提示"
    : current.updated ? "本地快照已就绪" : current.ready ? "等待首次获取" : "等待本地数据";
  $("flow-summary").textContent = current.summary;
  $("flow-detail").textContent = descriptions[selected][step];
  $("flow-caption").textContent = demo
    ? "演示模式：光点展示所选数据路径，不代表真实请求或执行进度。"
    : `动画表示任务运行，不表示逐节点进度。最近更新：${dateText(current.updated)}`;
  for (const channel of Object.keys(channels))
    $(`flow-${channel}`).setAttribute("aria-pressed", String(channel === selected));
  for (const button of panel.querySelectorAll("[data-flow-step]")) {
    button.setAttribute("aria-pressed", String(button.dataset.flowStep === step));
    if (button.dataset.flowStep === "process")
      button.textContent = selected === "sources" ? "02 解析" : "02 校验";
  }
  $("flow-fetch").disabled = !current.ready || current.busy;
  $("flow-fetch").textContent = current.busy ? "正在获取…"
    : selected === "sources" ? "获取来源订单" : "获取跟踪订单";
  $("flow-demo").setAttribute("aria-pressed", String(demo));
  $("flow-demo").textContent = demo ? "结束演示" : "演示动画";
  $("flow-motion").setAttribute("aria-pressed", String(paused));
  $("flow-motion").textContent = paused ? "继续动画" : "暂停动画";
}

export function updateFlow(channel, snapshot) {
  const current = channels[channel];
  current.ready = true;
  current.busy = Boolean(snapshot.refreshing);
  current.phase = snapshot.phase || "";
  current.error = snapshot.error || "";
  current.updated = snapshot.updated_at;
  if (channel === "sources") {
    const failures = snapshot.items.filter((item) => item.error || Number(item.status_code) >= 400).length;
    current.summary = `${snapshot.items.length} 个来源 · ${snapshot.orders?.length || 0} 条解析订单 · ${failures} 个异常来源`;
    const execution = snapshot.execution || [];
    if (execution.length) current.summary += ` · 已创建 ${execution.filter((row) => row.action === "created").length} · 跳过 ${execution.filter((row) => row.action === "skipped").length}`;
  } else {
    current.summary = `${snapshot.orders.length} 条跟踪订单 · 本地快照`;
  }
  renderFlow();
}

export function beginFlow(channel) {
  selected = channel;
  demo = false;
  channels[channel].busy = true;
  channels[channel].error = "";
  renderFlow();
}

export function finishFlow(channel, busy, error = "") {
  channels[channel].busy = busy;
  channels[channel].error = error;
  renderFlow();
}

export function flowReadError(channel, error) {
  channels[channel].ready = true;
  channels[channel].error = error;
  renderFlow();
}

export function initFlow() {
  for (const channel of Object.keys(channels)) {
    $(`flow-${channel}`).addEventListener("click", () => {
      selected = channel;
      renderFlow();
    });
  }
  for (const button of $("flow-panel").querySelectorAll("[data-flow-step]")) {
    button.addEventListener("click", () => {
      step = button.dataset.flowStep;
      renderFlow();
    });
  }
  $("flow-demo").addEventListener("click", () => { demo = !demo; renderFlow(); });
  $("flow-motion").addEventListener("click", () => { paused = !paused; renderFlow(); });
  $("flow-fetch").addEventListener("click", () => {
    $(selected === "sources" ? "refresh" : "orders-refresh").click();
  });
  renderFlow();
}
