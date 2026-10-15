import test from "node:test";
import assert from "node:assert/strict";
import {initSettings} from "../../web/settings.js";

test("settings distinguish credential sources and never save placeholders", async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {value: "", checked: false, disabled: false,
      addEventListener(event, handler) { this[event] = handler; }, elements: []});
    return elements.get(id);
  };
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  globalThis.document = {getElementById: element};
  let values = {SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY_SET: true,
    API_KEY_SET: true, API_SECRET_SET: true, API_KEY_SOURCE: "supabase", API_SECRET_SOURCE: "configuration"};
  const sent = [];
  globalThis.fetch = async (url, options) => {
    if (options.method === "POST") sent.push(JSON.parse(options.body));
    return {ok: true, json: async () => ({values, config_path: "/data/config"})};
  };
  try {
    initSettings();
    await new Promise(setImmediate);
    assert.match(element("settings-gate-key").placeholder, /Supabase 备用凭证/);
    assert.match(element("settings-gate-secret").placeholder, /本地配置/);
    assert.equal(element("settings-gate-key").value, "");
    await element("settings-form").submit({preventDefault() {}});
    assert.equal(Object.hasOwn(sent[0], "API_KEY"), false);
    assert.equal(Object.hasOwn(sent[0], "API_SECRET"), false);
    assert.equal(JSON.stringify(sent[0]).includes("已配置"), false);
    element("settings-gate-key").value = " replacement-key ";
    await element("settings-form").submit({preventDefault() {}});
    assert.equal(sent[1].API_KEY, "replacement-key");
    element("settings-clear-gate-key").checked = true;
    await element("settings-form").submit({preventDefault() {}});
    assert.equal(sent[2].API_KEY, "");
    values = {...values, API_KEY_SET: false, API_KEY_SOURCE: "missing"};
    await element("settings-form").submit({preventDefault() {}});
    assert.equal(element("settings-gate-key").placeholder, "未配置，请填写");
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});
