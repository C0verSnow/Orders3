// Remote CI only, against the built production server; no exchange calls or mocked API.
import { chromium } from 'playwright';
import { checkSettings } from './check-settings.mjs';
import { checkRefresh } from './check-refresh.mjs';
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
  await checkRefresh(browser, base, token, 'tests/artifacts');
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
  for (const name of ['预测订单', '跟踪订单', '当前持仓']) {
    await precision.getByRole('button', { name, exact: true }).click();
    await precision.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    await precision.getByRole('cell', { name: '100.01', exact: true }).waitFor();
    await precision.getByRole('cell', { name: '2.00', exact: true }).waitFor();
    assert.equal(await precision.getByRole('cell', { name: '100.005', exact: true }).count(), 0);
  }
  assert.equal(await precision.getByRole('columnheader', { name: '保护激活价', exact: true }).count(), 0);
  await precision.screenshot({ path: 'tests/artifacts/precision-positions.png', fullPage: true });
  await precision.close();
  for(const width of [1920,1440,1280]) {
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/#token=${token}`);await page.getByRole('heading',{name:'交易概览',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>location.hash),'');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no document overflow');
    await page.screenshot({path:`tests/artifacts/overview-${width}-light.png`,fullPage:true});
    await page.locator('[data-ui="theme-switch"]').click();
    if(width<=768)await page.getByRole('button',{name:'打开导航',exact:true}).click();
    await page.getByRole('button',{name:'系统设置',exact:true}).click();
    await page.locator('[data-settings-section=connections]').click();
    await page.getByRole('heading',{name:'连接与存储',exact:true}).waitFor();
    assert.equal(await page.locator('input[name="API_SECRET"]').inputValue(),'');
    await page.screenshot({path:`tests/artifacts/settings-${width}-dark.png`,fullPage:true});
    await page.reload();await page.getByRole('heading',{name:'交易概览',exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.deepEqual(errors,[]);
    await page.close();
  }
  // Production UI + SQLite: desktop grouped details, full precision and keyboard.
  for (const width of [1440]) {
    for (const theme of ['light', 'dark']) {
      const detail = await browser.newPage({ viewport: { width, height: 850 } });
      await detail.goto(`${base}/#token=${token}`);
      await detail.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
      if (theme === 'dark') await detail.locator('[data-ui="theme-switch"]').click();
      if (width <= 768) await detail.getByRole('button', { name: '打开导航', exact: true }).click();
      await detail.getByRole('button', { name: '预测订单', exact: true }).click();
      const trigger = detail.getByRole('button', { name: '查看第 1 条记录详情', exact: true });
      await trigger.click();
      const modal = detail.getByRole('dialog', { name: '预测订单详情', exact: true });
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
  await motion.getByRole('button', { name: '预测订单', exact: true }).hover();
  await motion.waitForTimeout(350);
  const firstIndicator = await indicator.boundingBox();
  await motion.getByRole('button', { name: '运行状态', exact: true }).hover();
  await motion.waitForTimeout(100);
  const middleIndicator = await indicator.boundingBox();
  await motion.waitForTimeout(250);
  const finalIndicator = await indicator.boundingBox();
  assert.ok(middleIndicator.y > firstIndicator.y && middleIndicator.y < finalIndicator.y, 'one shared indicator moves continuously');
  assert.equal(await indicator.count(), 1);
  await motion.mouse.move(1000, 20);
  await motion.waitForFunction(() => getComputedStyle(document.querySelector('[data-ui="nav-indicator"]')).opacity === '0');
  assert.equal(await indicator.evaluate(el => getComputedStyle(el).opacity), '0');
  await motion.getByRole('button', { name: '预测订单', exact: true }).focus();
  await motion.waitForFunction(() => getComputedStyle(document.querySelector('[data-ui="nav-indicator"]')).opacity === '1');
  assert.equal(await indicator.evaluate(el => getComputedStyle(el).opacity), '1', 'keyboard focus gets the same indicator');
  const fade = motion.locator('[data-ui="scroll-fade"]').first(), viewport = fade.locator('[data-ui="fade-viewport"]');
  await motion.waitForFunction(() => document.querySelector('[data-ui="scroll-fade"]').dataset.more === 'true');
  assert.equal(await fade.locator('[data-ui="bottom-fade"]').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  await viewport.evaluate(el => { const row = el.querySelectorAll('tbody [data-ui="row"]')[8]; el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().bottom + 24; });
  await motion.waitForTimeout(50);
  const edgeRows = await viewport.locator('tbody [data-ui="row"]').evaluateAll(rows => rows.map(row => Number(row.style.getPropertyValue('--scroll-opacity'))));
  assert.ok(edgeRows.some(value => value > 0 && value < 1), 'row opacity follows its actual position in the bottom 48px');
  assert.equal(await viewport.locator('thead').evaluate(el => getComputedStyle(el).filter), 'none');
  assert.equal(await viewport.locator('tbody td:last-child').first().evaluate(el => getComputedStyle(el).filter), 'none', 'details remain legible and usable at the edge');
  await viewport.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await motion.waitForFunction(() => document.querySelector('[data-ui="scroll-fade"]').dataset.more === 'false');
  await motion.getByRole('button', { name: '查看第 20 条记录详情', exact: true }).click();
  await motion.getByRole('dialog').waitFor(); await motion.keyboard.press('Escape');
  await motion.getByRole('button', { name: '下一页', exact: true }).click();
  await motion.getByRole('cell', { name: 'UI20 / USDT', exact: true }).waitFor();
  await motion.waitForFunction(() => document.querySelectorAll('[data-ui="row-exit"]').length === 0);
  assert.equal(await motion.getByRole('cell', { name: 'UI00 / USDT', exact: true }).count(), 0);
  const beforeFilter = await viewport.boundingBox();
  await motion.getByRole('searchbox', { name: '搜索预测订单', exact: true }).fill('UI44');
  await motion.getByRole('cell', { name: 'UI44 / USDT', exact: true }).waitFor();
  await motion.waitForFunction(() => document.querySelectorAll('[data-ui="row-exit"]').length === 0 && document.querySelector('[data-ui="scroll-fade"]').dataset.more === 'false');
  assert.equal(await fade.getAttribute('data-more'), 'false', 'short filtered table has no bottom fade');
  assert.equal((await viewport.boundingBox()).height, beforeFilter.height, 'filtering preserves viewport height');
  await motion.getByRole('searchbox', { name: '搜索预测订单', exact: true }).fill('no-such-contract');
  await motion.getByText('没有匹配的记录', { exact: true }).waitFor();
  await motion.getByRole('searchbox', { name: '搜索预测订单', exact: true }).fill('');
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
  await animated.evaluate(async el => { await Promise.allSettled(el.getAnimations({ subtree: true }).map(a => a.finished)); });
  assert.equal(await animated.locator('[data-ui="value-out"]').evaluate(el => getComputedStyle(el).opacity), '0');
  // Retarget an active number animation through actual SQLite/API updates.
  const refreshQueries = async () => {
    // Query cache is fresh for 1s, longer than the 850ms animation. Advance only
    // Date.now for staleness; WAAPI's monotonic document timeline keeps running.
    await motion.evaluate(() => { const previousNow = Date.now; Date.now = () => previousNow() + 2000; });
    const received = motion.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'GET');
    await motion.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); window.dispatchEvent(new Event('visibilitychange')); });
    await motion.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); window.dispatchEvent(new Event('visibilitychange')); });
    assert.equal((await received).status(), 200);
  };
  const pnl = animated.locator('[data-ui="value-in"]');
  uiStore.savePositions([{ ...seededPosition, unrealised_pnl: '-2.855' }], [{ ...seededPosition, unrealised_pnl: '-2.855' }]);
  await refreshQueries();
  await motion.waitForFunction(() => [...document.querySelectorAll('[data-ui="metric"] [data-ui="value-in"]')].some(el => el.textContent === '-2.86'));
  await motion.waitForTimeout(120);
  uiStore.savePositions([{ ...seededPosition, unrealised_pnl: '-3.855' }], [{ ...seededPosition, unrealised_pnl: '-3.855' }]);
  await refreshQueries();
  await motion.waitForFunction(() => [...document.querySelectorAll('[data-ui="metric"] [data-ui="value-in"]')].some(el => el.textContent === '-3.86'));
  const retarget = await pnl.evaluate(el => {
    const animation = el.getAnimations()[0], frames = animation.effect.getKeyframes();
    return { duration: animation.effect.getTiming().duration, easing: animation.effect.getTiming().easing, startOpacity: Number(frames[0].opacity), value: el.textContent };
  });
  assert.equal(retarget.duration, 850); assert.equal(retarget.easing, 'cubic-bezier(0.22, 0.61, 0.36, 1)');
  assert.ok(retarget.startOpacity > 0 && retarget.startOpacity < 1, 'interrupted number continues from its visible state');
  await animated.evaluate(async el => { await Promise.allSettled(el.getAnimations({ subtree: true }).map(a => a.finished)); });
  assert.equal(await pnl.textContent(), '-3.86');
  await motion.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  assert.ok(await motion.locator('[data-ui="position-count"] [data-ui="animated-value"]>span').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 28), 'position count retains card typography');
  await motion.screenshot({ path: 'tests/artifacts/ui-motion-light.png', fullPage: true });
  await motion.locator('[data-ui="theme-switch"]').click();
  await motion.locator('html[data-theme="dark"]').waitFor();
  const tableForeground = await motion.locator('table td').first().evaluate(el => ({ cell: getComputedStyle(el).color, table: getComputedStyle(el.closest('table')).color, main: getComputedStyle(document.querySelector('main')).color }));
  assert.equal(tableForeground.cell, tableForeground.main, `dark table inherits readable foreground: ${JSON.stringify(tableForeground)}`);
  assert.ok(await motion.locator('table').evaluate(el => getComputedStyle(el).fontFamily === getComputedStyle(document.querySelector('main')).fontFamily), 'table inherits the application sans font');
  await motion.screenshot({ path: 'tests/artifacts/ui-motion-dark.png', fullPage: true });
  await motion.emulateMedia({ reducedMotion: 'reduce' });
  await motion.waitForFunction(el => el.getAnimations().length === 0, await pnl.elementHandle());
  assert.equal(await animated.locator('[data-ui="value-in"]').evaluate(el => el.getAnimations().length), 0);
  assert.equal(await animated.locator('[data-ui="value-out"]').evaluate(el => getComputedStyle(el).display), 'none');
  for (const name of ['预测订单', '跟踪订单', '当前持仓', '入仓历史', '运行状态']) {
    await motion.getByRole('button', { name, exact: true }).click();
    await motion.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    assert.ok(await motion.locator('[data-ui="scroll-fade"]').count() > 0, `${name} uses shared scroll behavior`);
    assert.ok(await motion.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.deepEqual(motionErrors, []);
  await motion.close(); uiStore.close();

  const appearance = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await appearance.goto(`${base}/#token=${token}`);
  await appearance.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
  assert.equal(await appearance.locator('header [aria-label="本地受信任会话"]').count(), 0);
  assert.equal(await appearance.locator('svg[data-ui="brand-logo"]').count(), 1);
  await appearance.getByRole('button', { name: '系统设置', exact: true }).click();
  await appearance.locator('[data-settings-section=appearance]').click();
  await appearance.locator('[data-ui="theme-select"]').selectOption('system');
  await appearance.waitForFunction(() => !document.documentElement.dataset.revealing);
  await appearance.emulateMedia({ colorScheme: 'dark' });
  await appearance.locator('html[data-theme="dark"]').waitFor();
  await appearance.emulateMedia({ colorScheme: 'light' });
  await appearance.locator('html[data-theme="light"]').waitFor();
  await appearance.locator('[data-ui="theme-switch"]').click();
  await appearance.emulateMedia({ colorScheme: 'light' });
  await appearance.locator('html[data-theme="dark"]').waitFor();
  assert.equal(await appearance.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await appearance.locator('[data-ui="theme-select"]').inputValue(), 'dark');
  await appearance.waitForFunction(() => !document.documentElement.dataset.revealing);
  for (const mode of ['light', 'dark', 'system']) {
    await appearance.locator('[data-ui="theme-select"]').selectOption(mode);
    await appearance.waitForFunction(() => !document.documentElement.dataset.revealing);
    assert.equal(await appearance.evaluate(() => localStorage.getItem('orders-theme')), mode);
    await appearance.locator(`html[data-theme="${mode === 'system' ? 'light' : mode}"]`).waitFor();
  }
  await appearance.emulateMedia({ colorScheme: 'dark' });
  await appearance.locator('html[data-theme="dark"]').waitFor();
  await appearance.reload();
  await appearance.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
  await appearance.locator('html[data-theme="dark"]').waitFor();
  await appearance.getByRole('button', { name: '系统设置', exact: true }).click();
  await appearance.locator('[data-settings-section=opening]').click();
  assert.equal(await appearance.getByLabel('启用自动开仓（涉及真实交易）', { exact: true }).isChecked(), false);
  await appearance.getByLabel('Cron 表达式', { exact: true }).nth(1).fill('3 * * * *');
  await appearance.locator('[data-ui=settings-back]').click();
  await appearance.locator('[data-settings-section=prediction]').click();
  await appearance.getByLabel('Cron 表达式', { exact: true }).first().fill('7 * * * *');
  assert.equal(await appearance.getByLabel('Cron 表达式', { exact: true }).nth(1).inputValue(), '3 * * * *');
  await appearance.screenshot({ path: 'tests/artifacts/independent-schedules-dark.png', fullPage: true });
  await appearance.close();

  // Latest comment: real two-snapshot circular reveals, both directions, at the
  // actual trigger centre. No second app tree, API writes or reset form drafts.
  for (const width of [1440]) {
    const reveal = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [], writes = [];
    reveal.on('pageerror', error => errors.push(error.message));
    reveal.on('request', request => { if (request.method() === 'POST' && !request.url().endsWith('/api/session')) writes.push(request.url()); });
    await reveal.goto(`${base}/#token=${token}`);
    await reveal.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
    assert.equal(await reveal.locator('header [data-ui="preferences"]').count(), 1);
    assert.equal(await reveal.locator('header [data-ui="theme-switch"]').count(), 1);
    assert.equal(await reveal.locator('header [data-ui="preferences"] button').count(), 2);
    assert.equal(await reveal.locator('aside [data-ui="download-database"]').count(), 1);
    assert.equal(await reveal.locator('header [data-ui="download-database"]').count(), 0);
    await reveal.getByRole('cell', { name: 'UI00 / USDT', exact: true }).waitFor();
    await reveal.locator('[data-ui="metric"]').first().evaluate(async el => { await Promise.allSettled(el.getAnimations({ subtree: true }).map(a => a.finished)); });
    await reveal.locator('tbody').first().evaluate(async el => { await Promise.allSettled(el.getAnimations({ subtree: true }).map(a => a.finished)); });
    const runReveal = async (button, name) => {
      await button.scrollIntoViewIfNeeded();
      // Measure at the actual click: shared hover/press motion moves the trigger
      // between Playwright's pre-click bounding box and the React click handler.
      await button.evaluate(el => el.addEventListener('click', () => {
        const rect = el.getBoundingClientRect();
        window.revealClickBounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }, { capture: true, once: true }));
      await button.click();
      const bounds = await reveal.evaluate(() => window.revealClickBounds);
      await reveal.waitForFunction(() => document.getAnimations().some(a => a.animationName === 'circular-reveal'));
      const animation = await reveal.evaluate(() => {
        const a = document.getAnimations().find(a => a.animationName === 'circular-reveal');
        a.pause(); a.currentTime = 240;
        const root = document.documentElement;
        return { duration: a.effect.getTiming().duration, easing: getComputedStyle(document.documentElement, '::view-transition-new(root)').animationTimingFunction,
          x: parseFloat(root.style.getPropertyValue('--reveal-x')), y: parseFloat(root.style.getPropertyValue('--reveal-y')),
          radius: parseFloat(root.style.getPropertyValue('--reveal-radius')), frames: a.effect.getKeyframes(),
          oldOpacity: getComputedStyle(root, '::view-transition-old(root)').opacity,
          newOpacity: getComputedStyle(root, '::view-transition-new(root)').opacity,
          groupTransform: getComputedStyle(root, '::view-transition-group(root)').transform };
      });
      assert.equal(animation.duration, 600);
      assert.equal(animation.easing, 'cubic-bezier(0.4, 0, 0.2, 1)');
      assert.ok(Math.abs(animation.x - bounds.x - bounds.width / 2) < 1);
      assert.ok(Math.abs(animation.y - bounds.y - bounds.height / 2) < 1);
      assert.ok(animation.radius >= Math.hypot(Math.max(animation.x, width - animation.x), Math.max(animation.y, 1000 - animation.y)) - 1);
      assert.match(animation.frames[0].clipPath, /^circle\(0px at /);
      assert.equal(animation.oldOpacity, '1'); assert.equal(animation.newOpacity, '1');
      assert.ok(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(animation.groupTransform), 'snapshot group does not move or scale');
      await reveal.screenshot({ path: `tests/artifacts/reveal-${width}-${name}-midpoint.png` });
      await reveal.evaluate(() => document.getAnimations().find(a => a.animationName === 'circular-reveal').finish());
      await reveal.waitForFunction(() => !document.documentElement.dataset.revealing);
    };
    await runReveal(reveal.locator('[data-ui="theme-switch"]'), 'dark');
    assert.equal(await reveal.locator('html').getAttribute('data-theme'), 'dark');
    await runReveal(reveal.locator('[data-ui="theme-switch"]'), 'light');
    assert.equal(await reveal.locator('html').getAttribute('data-theme'), 'light');
    if (width <= 768) await reveal.getByRole('button', { name: '打开导航', exact: true }).click();
    await reveal.getByRole('button', { name: '系统设置', exact: true }).click();
    await reveal.locator('[data-settings-section=opening]').click();
    await reveal.getByLabel('Cron 表达式', { exact: true }).nth(1).fill('3 * * * *');
    await reveal.locator('[data-ui=settings-back]').click();
    await reveal.locator('[data-settings-section=connections]').click();
    await reveal.getByRole('heading', { name: '连接与存储', exact: true }).waitFor();
    await reveal.locator('input[name="API_KEY"]').fill('unsaved-language-draft');
    const formBefore = await reveal.locator('input[name="API_KEY"]').evaluate(el => { window.originalDraftInput = el; return true; });
    assert.ok(formBefore);
    const layout = () => reveal.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(n => Math.round(n * 10) / 10); };
      return [...document.querySelectorAll('#main [data-ui="two-tone-title"], #main input, header [data-ui="preferences"], aside nav button, aside [data-ui="download-database"], aside [data-ui="logout"]')].map(rect);
    });
    await reveal.locator('aside').evaluate(async el => { await Promise.allSettled(el.getAnimations().map(a => a.finished)); });
    await reveal.evaluate(() => window.scrollTo(0, 0));
    const chineseLayout = await layout();
    // Mobile drawer is closed but still laid out, so its two actions can be compared.
    const actions = await reveal.locator('aside [data-ui="download-database"], aside [data-ui="logout"]').evaluateAll(elements => elements.map(el => {
      const button = el.getBoundingClientRect(), icon = el.querySelector('svg').getBoundingClientRect();
      const text = document.createRange();
      text.selectNodeContents(el.querySelector('[data-ui="stable-text"] > span:last-child'));
      return [button.x, button.width, button.height, icon.x, icon.width, icon.height, text.getBoundingClientRect().x];
    }));
    assert.deepEqual(actions[0], actions[1], 'sidebar actions have identical dimensions, icon size and text left edges');
    assert.equal(await reveal.locator('[data-ui="theme-select"]').inputValue(), 'light');
    const coloursBefore = await reveal.locator('#main').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, colour: getComputedStyle(el).color }));
    await runReveal(reveal.locator('[data-ui="language-switch"]'), 'english');
    await reveal.getByRole('heading', { name: 'Connections & Storage', exact: true }).waitFor();
    assert.deepEqual(await layout(), chineseLayout, 'English and Chinese keep title, field, navigation and toolbar positions');
    assert.equal(await reveal.locator('html').getAttribute('lang'), 'en');
    assert.equal(await reveal.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await reveal.locator('input[name="API_KEY"]').inputValue(), 'unsaved-language-draft');
    assert.equal(await reveal.getByLabel('Cron expression', { exact: true }).nth(1).inputValue(), '3 * * * *');
    assert.ok(await reveal.locator('input[name="API_KEY"]').evaluate(el => el === window.originalDraftInput));
    assert.deepEqual(await reveal.locator('#main').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, colour: getComputedStyle(el).color })), coloursBefore);
    assert.ok(await reveal.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'English has no page overflow');
    assert.doesNotMatch(await reveal.locator('body').innerText(), /[\u3400-\u9fff]/, 'all visible settings UI is translated');
    await runReveal(reveal.locator('[data-ui="language-switch"]'), 'chinese');
    await reveal.getByRole('heading', { name: '连接与存储', exact: true }).waitFor();
    assert.equal(await reveal.locator('input[name="API_KEY"]').inputValue(), 'unsaved-language-draft');
    await runReveal(reveal.locator('[data-ui="language-switch"]'), 'english-again');
    await reveal.reload();
    await reveal.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    assert.equal(await reveal.locator('html').getAttribute('lang'), 'en');
    assert.ok(await reveal.getByRole('columnheader', { name: 'Activation price', exact: true }).count());
    for (const name of ['Overview', 'Predicted orders', 'Trailing orders', 'Positions', 'Entry history', 'Activity']) {
      if (width <= 768) await reveal.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await reveal.getByRole('button', { name, exact: true }).click();
      await reveal.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
      assert.doesNotMatch(await reveal.locator('body').innerText(), /[\u3400-\u9fff]/, name + ' UI is translated');
    }
    if (width <= 768) await reveal.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await reveal.getByRole('button', { name: 'Predicted orders', exact: true }).click();
    await reveal.getByRole('button', { name: 'View details for record 1', exact: true }).click();
    const englishDialog = reveal.getByRole('dialog', { name: 'Predicted orders details', exact: true });
    await englishDialog.getByRole('heading', { name: 'Raw values and precision', exact: true }).waitFor();
    assert.equal((await englishDialog.locator('dd').allTextContents()).filter(value => value === uiSources[0].activation_price).length, 1, 'language switching preserves the current raw fixture price');
    await reveal.keyboard.press('Escape');
    // Reduced motion and older browsers retain functional, persistent controls.
    await reveal.emulateMedia({ reducedMotion: 'reduce' });
    await reveal.locator('[data-ui="language-switch"]').click();
    await reveal.getByRole('heading', { name: '预测订单', exact: true, level: 1 }).waitFor();
    assert.equal(await reveal.locator('html').getAttribute('data-revealing'), null);
    await reveal.emulateMedia({ reducedMotion: 'no-preference' });
    await reveal.evaluate(() => { document.startViewTransition = undefined; });
    await reveal.locator('[data-ui="language-switch"]').click();
    await reveal.getByRole('heading', { name: 'Predicted orders', exact: true, level: 1 }).waitFor();
    assert.equal(await reveal.locator('html').getAttribute('data-revealing'), null);
    assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    await reveal.close();
  }

  // Fault-injection regressions: production UI + real server, only /api/status failure is intercepted.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/#token=${token}`);
  await page.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.locator('[data-settings-section=prediction]').click();
  await page.getByLabel('Cron 表达式', { exact: true }).first().fill('7 * * * *');
  await page.locator('[data-ui=settings-back]').click();
  await page.locator('[data-settings-section=connections]').click();
  await page.locator('input[name="API_KEY"]').fill('unsaved-key-draft');
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
  assert.equal(await page.getByLabel('Cron 表达式', { exact: true }).first().inputValue(), '7 * * * *');
  await page.route('**/api/status', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'status fixture unavailable' }) }));
  await page.getByRole('button', { name: '运行状态', exact: true }).click();
  await page.getByText('无法确认当前阻断状态，请重试。', { exact: true }).waitFor();
  assert.equal(await page.getByText('当前没有待核对请求。', { exact: true }).count(), 0);
  await page.screenshot({ path: 'tests/artifacts/status-unavailable.png', fullPage: true });
  await page.close();
  await checkSettings(browser, base, token, 'tests/artifacts');
  console.log('Browser checks passed at three desktop widths, both themes, session bootstrap, settings and secret fields');
} finally {
  await browser?.close();child.kill('SIGTERM');
  if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},5000).unref();});
  rmSync(directory,{recursive:true,force:true});
}
