// Real Chromium, local fixture HTTP server, no build and no production requests.
// CHROME_PATH points to an installed Chrome/Chromium executable.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile, mkdtemp, mkdir, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const artifacts = path.join(root, "tests/artifacts");
const profile = await mkdtemp(path.join(tmpdir(), "orders3-browser-"));
const orders = Array.from({length: 19}, (_, index) => ({id: `90071992547409931${index}`,
  contract: index === 18 ? "合约很长_".repeat(16) : index % 2 ? "ETH_USDT" : "BTC_USDT",
  amount: "-12345678901234567890", activation_price: "0.000000000000123456789",
  original_status: index % 2 ? 2 : 1, reduce_only: index % 2 === 0, timestamp: 1700000000000 + index * 1000}));
const schedule = {enabled: false, cron: "*/15 * * * *"};
let mode = "data";
let writes = 0;
const fixture = (url) => {
  if (url === "/api/activity") return {sequence: 0, jobs: {}, requests: {}, events: []};
  if (url === "/api/settings") return {values: {}, config_path: "/fixture/config"};
  if (url === "/api/schedule") return schedule;
  if (url === "/api/data") return {items: [], orders: [], schedule};
  if (url === "/api/orders") return {orders: mode === "empty" ? [] : orders, positions: [],
    unrealised_pnl: "-0.0000000000123456789", realised_pnl: "12345678901234567890.123456789", uptime_ms: 2000};
};
const server = createServer(async (request, response) => {
  if (request.method !== "GET") { writes++; response.writeHead(405).end(); return; }
  if (request.url.startsWith("/api/")) {
    response.setHeader("Content-Type", "application/json");
    if (mode === "error" && request.url === "/api/orders") {
      response.writeHead(503).end(JSON.stringify({error: "fixture network unavailable"}));
    } else response.end(JSON.stringify(fixture(request.url) ?? {}));
    return;
  }
  const name = request.url === "/" ? "index.html" : request.url.slice(1);
  if (!/^[\w.-]+$/.test(name)) { response.writeHead(404).end(); return; }
  try {
    const content = await readFile(path.join(root, "web", name));
    response.setHeader("Content-Type", name.endsWith("js") ? "text/javascript" : name.endsWith("css") ? "text/css" : name.endsWith("svg") ? "image/svg+xml" : "text/html");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'");
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROME_PATH || "google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {stdio: "ignore", windowsHide: true});
let launchError;
chrome.on("error", (error) => { launchError = error; });
const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { await pause(); }
  }
  assert(port, "Chrome did not expose its debugging port");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.id) {
      const handlers = pending.get(message.id);
      if (!handlers) return;
      pending.delete(message.id);
      clearTimeout(handlers.timeout);
      if (message.error) handlers.reject(new Error(message.error.message));
      else handlers.resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, {resolve, reject, timeout});
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true});
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(); }
    assert.fail(`Browser condition not reached: ${expression}`);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", {url: origin});
  await until('document.querySelectorAll("#overview-records tbody tr").length === 8');
  assert.equal(await evaluate('document.getElementById("unrealised-pnl").textContent'), "-0.0000000000123456789");
  await evaluate('document.getElementById("overview-next").click()');
  assert.match(await evaluate('document.getElementById("overview-page").textContent'), /第 2/);
  await evaluate('const search = document.getElementById("overview-search"); search.value="ETH"; search.dispatchEvent(new Event("input"))');
  assert.match(await evaluate('document.getElementById("overview-page").textContent'), /9 条匹配 · 第 1/);
  await evaluate('document.getElementById("overview-search").value=""; document.getElementById("overview-search").dispatchEvent(new Event("input"))');
  await mkdir(artifacts, {recursive: true});
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await send("Emulation.setDeviceMetricsOverride", {width, height: 1000, deviceScaleFactor: 1, mobile: false});
    for (const theme of ["light", "dark"]) {
      await evaluate(`document.getElementById("theme").value=${JSON.stringify(theme)}; document.getElementById("theme").dispatchEvent(new Event("change"))`);
      await until(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
      assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `Page overflows at ${width}/${theme}`);
      const shot = await send("Page.captureScreenshot", {format: "png"});
      await writeFile(path.join(artifacts, `overview-${width}-${theme}.png`), Buffer.from(shot.data, "base64"));
    }
  }
  await evaluate('document.getElementById("segment-live").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}))');
  assert(await evaluate('!document.getElementById("workspace-config").hidden && document.activeElement.id === "segment-config"'));
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), "Settings overflow on narrow window");
  await evaluate('document.getElementById("segment-live").click(); document.querySelector(".flow-details").open=true');
  await until('document.getElementById("flow-panel").dataset.layout === "narrow"');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), "Expanded flow overflows");
  await send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-motion", value: "reduce"}]});
  assert.equal(await evaluate('getComputedStyle(document.getElementById("overview-next")).transitionDuration'), "0s");
  mode = "empty";
  await send("Page.reload");
  await until('document.getElementById("overview-count").textContent === "0 条"');
  mode = "error";
  await send("Page.reload");
  await until('document.getElementById("overview-notice").textContent.includes("fixture network unavailable")');
  assert.equal(writes, 0, "Read-only overview or navigation issued a POST");
  assert.deepEqual(errors, [], "Browser JavaScript exceptions");
  console.log("Browser fixture checks passed: 5 widths × 2 themes, precision, paging/search, keyboard tabs, expanded flow, reduced motion, empty/error states; zero writes.");
} finally {
  socket?.close();
  chrome.kill();
  server.closeAllConnections();
  server.close();
}
