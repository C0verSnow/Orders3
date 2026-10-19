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
seed.saveSources([{ contract: 'BTC_USDT', activation_price: '100.005', amount: '2', price_round: '0.001', order_price_round: '0.0001', side: 'buy', timestamp: 1700000000000 }]);
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
  for (const name of ['来源订单', 'Gate 跟踪订单', '持仓']) {
    await precision.getByRole('button', { name, exact: true }).click();
    await precision.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    await precision.getByRole('cell', { name: '100.01', exact: true }).waitFor();
    await precision.getByRole('cell', { name: '2.00', exact: true }).waitFor();
    assert.equal(await precision.getByRole('cell', { name: '100.005', exact: true }).count(), 0);
  }
  assert.equal(await precision.getByRole('columnheader', { name: '保护激活价', exact: true }).count(), 0);
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
  // Production UI + SQLite: grouped details, full precision, keyboard and mobile scrolling.
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark']) {
      const detail = await browser.newPage({ viewport: { width, height: 850 } });
      await detail.goto(`${base}/#token=${token}`);
      await detail.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
      if (width <= 768) await detail.getByRole('button', { name: '打开导航', exact: true }).click();
      await detail.getByRole('combobox', { name: '外观主题' }).selectOption(theme);
      await detail.getByRole('button', { name: '来源订单', exact: true }).click();
      const trigger = detail.getByRole('button', { name: '查看第 1 条记录详情', exact: true });
      await trigger.click();
      const modal = detail.getByRole('dialog', { name: '来源订单详情', exact: true });
      await modal.waitFor();
      await modal.getByRole('heading', { name: '原始值与精度', exact: true }).waitFor();
      assert.equal(await modal.locator('dd').filter({ hasText: /^100\.005$/ }).count(), 1);
      assert.equal(await modal.locator('dd').filter({ hasText: /^0\.001$/ }).count(), 1);
      assert.equal(await modal.locator('dd').filter({ hasText: /^0\.0001$/ }).count(), 1);
      assert.ok(await modal.evaluate(el => { const r = el.getBoundingClientRect(); return el.scrollWidth <= el.clientWidth + 1 && Math.abs(r.left + r.width / 2 - innerWidth / 2) <= 2 && r.top >= 15 && r.bottom <= innerHeight - 15; }), 'dialog stays centered inside viewport');
      assert.ok(await detail.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await detail.screenshot({ path: `tests/artifacts/details-${width}-${theme}.png`, fullPage: true });
      await detail.keyboard.press('Escape');
      await modal.waitFor({ state: 'hidden' });
      assert.ok(await trigger.evaluate(el => document.activeElement === el));
      await trigger.click();
      await modal.getByRole('button', { name: '关闭详情', exact: true }).first().click();
      await modal.waitFor({ state: 'hidden' });
      await trigger.click();
      await detail.mouse.click(5, 5);
      await modal.waitFor({ state: 'hidden' });
      await detail.close();
    }
  }
  // Latest UI comment: real production UI + SQLite, no exchange access.
  const uiStore = new Storage(join(directory, 'data.db'));
  const uiSources = Array.from({ length: 45 }, (_, index) => ({ contract: `UI${String(index).padStart(2, '0')}_USDT`, activation_price: '100.005', amount: '2', price_round: '0.001', side: 'buy', timestamp: 1700000000000 + index }));
  uiStore.saveSources(uiSources);
  const motion = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const motionErrors = [];
  motion.on('pageerror', error => motionErrors.push(error.message));
  await motion.goto(`${base}/#token=${token}`);
  await motion.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
  await motion.getByRole('cell', { name: 'UI00 / USDT', exact: true }).waitFor();
  assert.equal(await motion.getByText('服务端确认 · 十进制计算 · 原始记录可追溯', { exact: true }).count(), 0);
  const titleStyles = await motion.locator('[data-ui="panel-title"] [data-ui="two-tone-title"]').first().evaluate(el => {
    const main = getComputedStyle(el.querySelector('h2')), secondary = getComputedStyle(el.querySelector('p'));
    return { main: main.color, secondary: secondary.color, size: main.fontSize === secondary.fontSize, weight: main.fontWeight === secondary.fontWeight };
  });
  assert.deepEqual(titleStyles, { main: 'rgb(29, 29, 31)', secondary: 'rgb(134, 134, 139)', size: true, weight: true });
  const indicator = motion.locator('[data-ui="nav-indicator"]');
  await motion.getByRole('button', { name: '来源订单', exact: true }).hover();
  await motion.waitForTimeout(350);
  const firstIndicator = await indicator.boundingBox();
  await motion.getByRole('button', { name: '活动与运行状态', exact: true }).hover();
  await motion.waitForTimeout(100);
  const middleIndicator = await indicator.boundingBox();
  await motion.waitForTimeout(250);
  const finalIndicator = await indicator.boundingBox();
  assert.ok(middleIndicator.y > firstIndicator.y && middleIndicator.y < finalIndicator.y, 'one shared indicator moves continuously');
  assert.equal(await indicator.count(), 1);
  await motion.mouse.move(1000, 20);
  await motion.waitForFunction(() => getComputedStyle(document.querySelector('[data-ui="nav-indicator"]')).opacity === '0');
  assert.equal(await indicator.evaluate(el => getComputedStyle(el).opacity), '0');
  await motion.getByRole('button', { name: '来源订单', exact: true }).focus();
  await motion.waitForFunction(() => getComputedStyle(document.querySelector('[data-ui="nav-indicator"]')).opacity === '1');
  assert.equal(await indicator.evaluate(el => getComputedStyle(el).opacity), '1', 'keyboard focus gets the same indicator');
  const fade = motion.locator('[data-ui="scroll-fade"]').first(), viewport = fade.locator('[data-ui="fade-viewport"]');
  await motion.waitForFunction(() => document.querySelector('[data-ui="scroll-fade"]').dataset.more === 'true');
  assert.equal(await fade.locator('[data-ui="bottom-fade"]').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  await viewport.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await motion.waitForFunction(() => document.querySelector('[data-ui="scroll-fade"]').dataset.more === 'false');
  await motion.getByRole('button', { name: '查看第 20 条记录详情', exact: true }).click();
  await motion.getByRole('dialog').waitFor(); await motion.keyboard.press('Escape');
  await motion.getByRole('button', { name: '下一页', exact: true }).click();
  await motion.getByRole('cell', { name: 'UI20 / USDT', exact: true }).waitFor();
  await motion.waitForTimeout(350);
  assert.equal(await motion.getByRole('cell', { name: 'UI00 / USDT', exact: true }).count(), 0);
  const beforeFilter = await viewport.boundingBox();
  await motion.getByRole('searchbox', { name: '搜索来源订单', exact: true }).fill('UI44');
  await motion.getByRole('cell', { name: 'UI44 / USDT', exact: true }).waitFor();
  await motion.waitForTimeout(350);
  assert.equal(await fade.getAttribute('data-more'), 'false', 'short filtered table has no bottom fade');
  assert.equal((await viewport.boundingBox()).height, beforeFilter.height, 'filtering preserves viewport height');
  await motion.getByRole('searchbox', { name: '搜索来源订单', exact: true }).fill('no-such-contract');
  await motion.getByText('没有匹配的记录', { exact: true }).waitFor();
  await motion.getByRole('searchbox', { name: '搜索来源订单', exact: true }).fill('');
  // A changed cache value must reach the UI immediately and trigger only a local animation.
  uiSources[0].activation_price = '129.755'; uiStore.saveSources(uiSources.slice(0, 44));
  uiStore.savePositions([{ ...seededPosition, unrealised_pnl: '-1.855' }], [{ ...seededPosition, unrealised_pnl: '-1.855' }]);
  await motion.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); window.dispatchEvent(new Event('visibilitychange')); });
  await motion.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); window.dispatchEvent(new Event('visibilitychange')); });
  await motion.getByRole('cell', { name: '129.76', exact: true }).waitFor();
  await motion.locator('[data-ui="metric"] [data-ui="value-in"]').filter({ hasText: /^-1\.86$/ }).waitFor();
  const animated = motion.locator('[data-ui="metric"]').nth(2);
  assert.equal(await animated.locator('[data-ui="value-out"]').getAttribute('aria-hidden'), 'true');
  assert.equal(await animated.locator('[data-ui="value-in"]').textContent(), '-1.86');
  await motion.waitForTimeout(400);
  assert.equal(await animated.locator('[data-ui="value-out"]').evaluate(el => getComputedStyle(el).opacity), '0');
  await motion.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  assert.ok(await motion.locator('[data-ui="position-count"] [data-ui="animated-value"]>span').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 28), 'position count retains card typography');
  await motion.screenshot({ path: 'tests/artifacts/ui-motion-light.png', fullPage: true });
  await motion.getByRole('combobox', { name: '外观主题' }).selectOption('dark');
  await motion.locator('html[data-theme="dark"]').waitFor();
  const tableForeground = await motion.locator('table td').first().evaluate(el => ({ cell: getComputedStyle(el).color, table: getComputedStyle(el.closest('table')).color, main: getComputedStyle(document.querySelector('main')).color }));
  assert.equal(tableForeground.cell, tableForeground.main, `dark table inherits readable foreground: ${JSON.stringify(tableForeground)}`);
  assert.ok(await motion.locator('table').evaluate(el => getComputedStyle(el).fontFamily === getComputedStyle(document.querySelector('main')).fontFamily), 'table inherits the application sans font');
  await motion.screenshot({ path: 'tests/artifacts/ui-motion-dark.png', fullPage: true });
  await motion.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await animated.locator('[data-ui="value-in"]').evaluate(el => el.getAnimations().length), 0);
  assert.equal(await animated.locator('[data-ui="value-out"]').evaluate(el => getComputedStyle(el).display), 'none');
  for (const name of ['来源订单', 'Gate 跟踪订单', '持仓', '真实入仓历史', '活动与运行状态']) {
    await motion.getByRole('button', { name, exact: true }).click();
    await motion.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    assert.ok(await motion.locator('[data-ui="scroll-fade"]').count() > 0, `${name} uses shared scroll behavior`);
    assert.ok(await motion.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.deepEqual(motionErrors, []);
  await motion.close(); uiStore.close();

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
