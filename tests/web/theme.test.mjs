import test from "node:test";
import assert from "node:assert/strict";

test("theme survives unavailable storage and follows system until explicitly selected", async () => {
  const original = Object.fromEntries(["document", "matchMedia", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const events = {};
  const meta = {};
  const root = {dataset: {}};
  const select = {value: "", addEventListener: (name, callback) => { events[name] = callback; }};
  const media = {matches: true, addEventListener: (name, callback) => { events.media = callback; }};
  try {
    Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }}});
    globalThis.matchMedia = () => media;
    globalThis.document = {documentElement: root, querySelector: () => meta, getElementById: () => select,
      addEventListener: (name, callback) => { events[name] = callback; }};
    await import("../../web/theme.js");
    assert.equal(root.dataset.theme, "dark");
    events.DOMContentLoaded();
    assert.equal(select.value, "system");
    media.matches = false;
    events.media();
    assert.equal(root.dataset.theme, "light");
    select.value = "dark";
    events.change();
    assert.equal(root.dataset.theme, "dark");
    events.media();
    assert.equal(root.dataset.theme, "dark");
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
