import { $ } from "./ui.js";

export function initSettings() {
  const secretFields = [
    ["SUPABASE_ANON_KEY", "supabase-key"], ["API_KEY", "gate-key"], ["API_SECRET", "gate-secret"]
  ];
  function settingsNotice(message) {
    $("settings-notice").textContent = message || "";
    $("settings-notice").hidden = !message;
  }
  function applySettings(settings) {
    const values = settings.values;
    $("settings-url").value = values.SUPABASE_URL || "";
    $("settings-data-dir").value = values.ORDERS_DATA_DIR || "";
    $("settings-origin").value = values.ORDERS_ALLOWED_ORIGIN || "";
    for (const [name, id] of secretFields) {
      $("settings-" + id).value = "";
      $("settings-" + id).placeholder = values[name + "_SET"] ? "已配置；留空保留，输入可替换" : "尚未配置，请填写";
      $("settings-clear-" + id).checked = false;
    }
    $("settings-path").textContent = settings.config_path;
    $("settings-status").textContent = values.SUPABASE_URL && values.SUPABASE_ANON_KEY_SET ? "来源连接已配置" : "请先填写来源连接信息";
  }
  async function loadSettings() {
    try {
      const response = await fetch("/api/settings", {cache: "no-store"});
      const settings = await response.json();
      if (!response.ok) throw new Error(settings.error || "读取配置失败");
      applySettings(settings);
      $("settings-save").disabled = false;
    } catch (error) { settingsNotice(error.message + "，刷新页面后重试。"); }
  }
  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      SUPABASE_URL: $("settings-url").value.trim(),
      ORDERS_DATA_DIR: $("settings-data-dir").value.trim(),
      ORDERS_ALLOWED_ORIGIN: $("settings-origin").value.trim()
    };
    for (const [name, id] of secretFields) {
      const value = $("settings-" + id).value.trim();
      if ($("settings-clear-" + id).checked) payload[name] = "";
      else if (value) payload[name] = value;
    }
    const controls = Array.from($("settings-form").elements);
    controls.forEach((control) => { control.disabled = true; });
    $("settings-save").textContent = "正在保存…";
    try {
      const response = await fetch("/api/settings", {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)
      });
      const settings = await response.json();
      if (!response.ok) throw new Error(settings.error || "保存失败");
      applySettings(settings);
      settingsNotice("配置已保存。连接设置立即生效，数据目录重启后生效。");
    } catch (error) { settingsNotice(error.message); }
    finally {
      controls.forEach((control) => { control.disabled = false; });
      $("settings-save").textContent = "保存程序配置";
    }
  });
  loadSettings();
}
