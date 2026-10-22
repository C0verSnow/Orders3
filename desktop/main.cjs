const { app, BrowserWindow, dialog, session } = require('electron');
const { spawn } = require('node:child_process');
const { join } = require('node:path');

let backend, window, quitting = false, backendExited = false;
const args = process.argv.slice(app.isPackaged ? 1 : 2).filter(arg => arg !== '--desktop' && !/^--(?:remote-debugging|inspect|no-sandbox|disable-gpu)/.test(arg));
const headless = args.some(arg => ['--no-browser', '--list', '--fetch-only', '--help', '-h', '--version', '-v'].includes(arg));
const service = join(process.resourcesPath, 'service', process.platform === 'win32' ? 'orders-service.exe' : 'orders-service');

async function stop() {
  if (!backend || backendExited) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { backend.kill(); resolve(); }, 15000);
    backend.once('exit', () => { clearTimeout(timer); resolve(); });
    // Closing the parent's private pipe requests graceful service shutdown on both OSes.
    backend.stdin.end();
  });
}
async function quit(code = 0) {
  if (quitting) return;
  quitting = true;
  await stop();
  app.exit(code);
}
async function fail(message) {
  if (quitting) return;
  if (headless) console.error(message);
  else { await app.whenReady(); dialog.showErrorBox('Orders3 启动失败', message); }
  await quit(1);
}
function start() {
  backend = spawn(service, [...args, '--no-browser', ...(!headless ? ['--host', '127.0.0.1'] : [])], {
    cwd: process.env.PORTABLE_EXECUTABLE_DIR || process.cwd(),
    env: { ...process.env, ORDERS_DESKTOP_CHILD: '1', ORDERS_NO_BROWSER: '1' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  backend.stdin.on('error', () => {});
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('本地服务在 30 秒内未就绪，请检查端口与数据目录。')), 30000);
    backend.once('error', error => { clearTimeout(timer); reject(error); });
    backend.once('exit', (code) => {
      backendExited = true;
      clearTimeout(timer);
      if (headless) { void quit(code ?? 1); return; }
      reject(new Error(`本地服务退出（${code}）。${output.slice(-2000)}`));
      if (window && !quitting) void fail('本地服务已退出，请关闭后重新启动。');
    });
    backend.stdout.on('data', chunk => {
      if (headless) process.stdout.write(chunk);
      output = (output + chunk).slice(-8000);
      const address = /本地看板：(http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1];
      if (address) { clearTimeout(timer); resolve(address); }
    });
    backend.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); if (headless) process.stderr.write(chunk); });
  });
  return ready;
}
app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void quit(); } });
app.on('window-all-closed', () => { void quit(); });
process.once('SIGTERM', () => { void quit(); });
process.once('SIGINT', () => { void quit(); });

if (headless) { start().catch(error => { void fail(error.message); }); }
else if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  (async () => {
    await app.whenReady();
    const address = await start();
    const response = await fetch(`${address}/health`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok || !(await response.json()).ok) throw new Error('本地服务健康检查失败');
    if (quitting) return;
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window = new BrowserWindow({ title: 'Orders3', width: 1440, height: 960, minWidth: 800, minHeight: 600, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== address) event.preventDefault(); });
    window.webContents.on('render-process-gone', () => { void fail('工作台窗口异常退出，请重新启动。'); });
    window.on('closed', () => { window = undefined; void quit(); });
    await window.loadURL(`${address}/`);
    if (!quitting) window.show();
  })().catch(error => { void fail(error.message); });
}
