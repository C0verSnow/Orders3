// Remote CI only, against the built production server; no exchange calls or mocked API.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Storage } from '../apps/server/src/database/index.ts';
const directory = mkdtempSync(join(tmpdir(), 'orders-browser-'));
// Persist high-precision fixtures before launching the real server; do not mock data APIs.
const seed = new Storage(join(directory, 'data.db'));
seed.saveSources([{ contract: 'BTC_USDT', activation_price: '100.005', amount: '2', price_round: '0.001', side: 'buy', timestamp: 1700000000000 }]);
seed.saveTrailing([{ id: '123', contract: 'BTC_USDT', activation_price: '100.005', amount: '2', reduce_only: false, original_status: 1, timestamp: 1700000000000 }]);
const seededPosition = { contract: 'BTC_USDT', size: '2', entry_price: '100.005', value: '20.001', leverage_max: '20', unrealised_pnl: '0.005', realised_pnl: '-0.004', initial_margin: '1.005', mark_price: '100.1234', close_price: '101.005', quanto_multiplier: '0.1', order_price_round: '0.0001' };
seed.savePositions([seededPosition], [seededPosition]);
seed.close();
const token = 'ci-browser-access-token-at-least-32-characters';
const child = spawn(process.execPath, [resolve('dist/server.cjs'), '--cached', '--no-browser', '--port', '18091'], { cwd: directory,
  env: { ...process.env, ORDERS_DATA_DIR: directory, ORDERS_CONFIG_PATH: join(directory, 'config'), ORDERS_ACCESS_TOKEN: token } });
let output=''; child.stderr.on('data',chunk=>{output+=chunk;});
const base='http://127.0.0.1:18091';
let browser;
try {
  let ready=false;
  for(let index=0;index<100;index++) { if(child.exitCode!==null)throw new Error(output); try {if((await fetch(base+'/health')).ok){ready=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,100)); }
  assert.ok(ready);
  browser=await chromium.launch();mkdirSync('tests/artifacts',{recursive:true});
  // Hold an anonymous session GET until after the real login POST succeeds.
  // A late anonymous response must never replace the authenticated cache.
  const bootstrap = await browser.newPage();
  let releaseSession, captureSession;
  const sessionHeld = new Promise(resolve => { releaseSession = resolve; });
  const sessionCaptured = new Promise(resolve => { captureSession = resolve; });
  let held = false;
  let finishSession;
  const sessionFinished = new Promise(resolve => { finishSession = resolve; });
  await bootstrap.route('**/api/session', async route => {
    if (route.request().method() === 'GET' && !held) {
      held = true;
      const response = await route.fetch();
      assert.equal((await response.json()).authenticated, false);
      captureSession();
      await sessionHeld;
      // Cancellation may already have aborted the browser's request.
      try { await route.fulfill({ response }); } finally { finishSession(); }
    } else {
      if (route.request().method() === 'POST') await sessionCaptured;
      await route.continue();
    }
  });
  await bootstrap.goto(`${base}/#token=${token}`);
  await bootstrap.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
  releaseSession();
  await sessionFinished;
  await bootstrap.waitForTimeout(300);
  assert.ok(await bootstrap.getByRole('heading', { name: '交易概览', exact: true }).isVisible(), 'late anonymous session cannot undo login');
  await bootstrap.close();
  const precision = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await precision.goto(`${base}/#token=${token}`);
  await precision.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
  for (const name of ['来源订单', 'Gate 跟踪订单', '持仓与保护']) {
    await precision.getByRole('button', { name, exact: true }).click();
    await precision.getByRole('heading', { name, exact: true }).waitFor();
    await precision.getByRole('cell', { name: '100.01', exact: true }).waitFor();
    await precision.getByRole('cell', { name: '2.00', exact: true }).waitFor();
    assert.equal(await precision.getByRole('cell', { name: '100.005', exact: true }).count(), 0);
  }
  await precision.screenshot({ path: 'tests/artifacts/precision-positions.png', fullPage: true });
  await precision.close();
  for(const width of [1920,1440,1280,1024,768,390]) {
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/#token=${token}`);await page.getByRole('heading',{name:'交易概览',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>location.hash),'');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no document overflow');
    await page.screenshot({path:`tests/artifacts/overview-${width}-light.png`,fullPage:true});
    if(width<=768)await page.getByRole('button',{name:'打开导航',exact:true}).click();
    await page.getByRole('combobox',{name:'外观主题'}).selectOption('dark');
    await page.getByRole('button',{name:'系统设置',exact:true}).click();
    await page.getByRole('heading',{name:'连接与存储',exact:true}).waitFor();
    assert.equal(await page.locator('input[name="API_SECRET"]').inputValue(),'');
    await page.screenshot({path:`tests/artifacts/settings-${width}-dark.png`,fullPage:true});
    await page.reload();await page.getByRole('heading',{name:'交易概览',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.deepEqual(errors,[]);
    await page.close();
  }
  // Fault-injection regressions: production UI + real server, only /api/status failure is intercepted.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/#token=${token}`);
  await page.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.locator('input[name="API_KEY"]').fill('unsaved-key-draft');
  await page.getByLabel('Cron 表达式', { exact: true }).fill('7 * * * *');
  await page.waitForTimeout(1200);
  // Match Query's window listener and a full hidden/visible transition.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  const settingsRead = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'GET');
  const scheduleRead = page.waitForResponse(response => response.url().endsWith('/api/schedule') && response.request().method() === 'GET');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await Promise.all([settingsRead, scheduleRead]);
  assert.equal(await page.locator('input[name="API_KEY"]').inputValue(), 'unsaved-key-draft');
  assert.equal(await page.getByLabel('Cron 表达式', { exact: true }).inputValue(), '7 * * * *');
  await page.route('**/api/status', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'status fixture unavailable' }) }));
  await page.getByRole('button', { name: '活动与运行状态', exact: true }).click();
  await page.getByText('无法确认当前阻断状态，请重试。', { exact: true }).waitFor();
  assert.equal(await page.getByText('当前没有待核对请求。', { exact: true }).count(), 0);
  await page.screenshot({ path: 'tests/artifacts/status-unavailable.png', fullPage: true });
  await page.close();
  console.log('Browser checks passed at six widths, both themes, session bootstrap, settings and secret fields');
} finally {
  await browser?.close();child.kill('SIGTERM');
  if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});
  rmSync(directory,{recursive:true,force:true});
}
