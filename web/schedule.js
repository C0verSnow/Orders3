import { $, dateText } from "./ui.js";

let scheduleDirty = false;
let savingSchedule = false;
let currentSchedule = null;

function scheduleNotice(message) {
  $("schedule-notice").textContent = message || "";
  $("schedule-notice").hidden = !message;
}
function updateCountdown() {
  const next = currentSchedule?.enabled && currentSchedule.next_run ? new Date(currentSchedule.next_run).getTime() : NaN;
  const seconds = Math.ceil((next - Date.now()) / 1000);
  $("schedule-countdown").textContent = !Number.isFinite(next) ? "无待执行任务" : seconds <= 0 ? "等待执行及状态同步" : `剩余 ${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分 ${seconds % 60} 秒`;
}
export function applySchedule(schedule, running = false) {
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

export function initSchedule() {
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
  setInterval(updateCountdown, 1000);
}
