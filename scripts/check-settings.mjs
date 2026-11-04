// Runs only in remote CI against an already built server. No exchange access.
import assert from 'node:assert/strict';
export async function checkSettings(browser, base, output) {
  for (const width of [1440, 390]) for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({language, theme}) => { localStorage.setItem('orders-language', language); localStorage.setItem('orders-theme', theme); }, {language, theme});
    await page.goto(`${base}/`);
    const zh = language === 'zh';
    const nav = async () => {
      if (width <= 768) await page.getByRole('button', {name: zh ? '打开导航' : 'Open navigation', exact: true}).click();
      await page.getByRole('button', {name: zh ? '系统设置' : 'Settings', exact: true}).click();
    };
    await nav();
    const overview = page.locator('[data-ui=settings-overview]');
    await overview.waitFor();
    const cards = overview.locator('[data-settings-section]');
    assert.equal(await cards.count(), 5);
    const titles = zh ? ['外观设置','连接与存储','预测抓取','平仓参数','自动开仓'] : ['Appearance Settings','Connections & Storage','Prediction Fetching','Closing Parameters','Automatic Entry'];
    for (let i=0;i<5;i++) await cards.nth(i).getByText(titles[i],{exact:true}).waitFor();
    assert.equal(await page.locator('[data-ui=settings] input:visible, [data-ui=settings] select:visible').count(), 0);
    const sizes = await cards.evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return [r.x,r.width,r.height,r.y]; }));
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(sizes[i].slice(0,3), sizes[0].slice(0,3));
      assert.equal(sizes[i][2], 96);
      if (i) assert.equal(sizes[i][3] - sizes[i-1][3] - 96, 16);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({path:`${output}/settings-overview-${width}-${language}-${theme}.png`,fullPage:true});
    for (const section of ['appearance','connections','prediction','trading','opening']) {
      await page.locator(`[data-settings-section=${section}]`).click();
      await page.locator('[data-ui=settings-back]').waitFor();
      const visibleForms = page.locator('[data-ui=settings] form:visible');
      assert.equal(await visibleForms.count(), section === 'appearance' ? 0 : 1);
      if (section === 'appearance') {
        for (const mode of ['light','dark','system']) {
          await page.locator(`[data-ui=theme-choice] input[value=${mode}]`).check();
          assert.equal(await page.evaluate(() => localStorage.getItem('orders-theme')), mode);
        }
        await page.locator(`[data-ui=theme-choice] input[value=${theme}]`).check();
      } else {
        const endpoint = ['connections','trading'].includes(section) ? '/api/settings' : section === 'prediction' ? '/api/schedule' : '/api/schedule/opening';
        const form = visibleForms;
        if (section === 'connections') await form.locator('input[name=ORDERS_DATA_DIR]').fill('');
        else if (section === 'trading') await form.locator('input[name=close_multiplier]').fill('2.75');
        else await form.locator('input:not([type=checkbox]):not([type=radio])').fill(section === 'prediction' ? '7 * * * *' : '3 * * * *');
        // Delay the genuine response, preserving production validation and persistence.
        let release, captured;
        const held = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { captured = resolve; });
        let posts = 0;
        const handler = async route => {
          if (route.request().method() !== 'POST') return route.continue();
          posts++;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          captured(); await held; await route.fulfill({response});
        };
        await page.route(`**${endpoint}`, handler);
        const button = form.locator('button[type=submit], button:not([type])').last();
        const dimensions = () => button.evaluate(el => { const r=el.getBoundingClientRect(); return [r.width,r.height]; });
        const initial = await dimensions();
        await button.click(); await started;
        // React Query batches observer notifications. Keep the real response
        // held while waiting for the pending render, then verify its state.
        await page.waitForFunction(() => [...document.querySelectorAll('[data-ui=settings] button[data-feedback=pending]')].some(el => el.checkVisibility() && el.disabled));
        assert.equal(await button.getAttribute('data-feedback'), 'pending', `${width}/${language}/${theme}/${section}: pending feedback, disabled=${await button.isDisabled()}`);
        assert.equal(await button.isDisabled(), true);
        assert.deepEqual(await dimensions(), initial);
        await button.evaluate(el => el.click());
        assert.equal(posts, 1);
        release();
        await page.waitForFunction(() => [...document.querySelectorAll('[data-ui=settings] button[data-feedback=success]')].some(el => el.checkVisibility()));
        assert.equal(await button.getAttribute('data-feedback'), 'success');
        assert.deepEqual(await dimensions(), initial);
        assert.equal(await page.getByText(/^(Schedule saved\.|Configuration saved,|定时配置已保存。|配置已保存，)/).count(), 0);
        const result = await page.evaluate(async endpoint => (await fetch(endpoint === '/api/schedule/opening' ? '/api/schedule' : endpoint)).json(), endpoint);
        if (section === 'trading') assert.equal(result.close_multiplier, '2.75');
        if (section === 'prediction') assert.equal(result.cron, '7 * * * *');
        if (section === 'opening') { assert.equal(result.opening.cron, '3 * * * *'); assert.equal(result.opening.enabled, false); }
        await page.screenshot({path:`${output}/settings-${section}-${width}-${language}-${theme}-success.png`,fullPage:true});
        await page.waitForFunction(el => el.dataset.feedback === 'idle', await button.elementHandle());
        await page.unroute(`**${endpoint}`, handler);
        // HTTP failure must retain an accessible explanation and show no success.
        await page.route(`**${endpoint}`, route => route.request().method() === 'POST' ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:zh ? '请求格式或参数无效' : 'Request unavailable'})}) : route.continue());
        await button.click();
        await page.waitForFunction(() => [...document.querySelectorAll('[data-ui=settings] button[data-feedback=error]')].some(el => el.checkVisibility()));
        assert.equal(await button.getAttribute('data-feedback'), 'error');
        assert.deepEqual(await dimensions(), initial);
        assert.ok(await page.locator('[data-ui=settings] p[role=alert]:visible').count());
        await page.unroute(`**${endpoint}`);
      }
      await page.locator('[data-ui=settings-back]').click();
      await overview.waitFor();
    }
    // Refresh feedback is held until both real API operations have completed.
    if (width <= 768) await page.getByRole('button',{name:zh ? '打开导航' : 'Open navigation',exact:true}).click();
    await page.getByRole('button',{name:zh ? '交易概览' : 'Overview',exact:true}).click();
    const refresh = page.locator('[data-ui=refresh-all]');
    let unblock, entered;
    const gate = new Promise(resolve => {unblock=resolve;});
    const hit = new Promise(resolve => {entered=resolve;});
    // Controlled fixture is limited to refresh: no credentials or exchange calls.
    await page.route('**/api/refresh', async route => { entered(); await gate; await route.fulfill({json:{error:null}}); });
    await page.route('**/api/orders/refresh', route => route.fulfill({json:{error:null}}));
    await refresh.hover();
    if (width === 1440) {
      await page.waitForTimeout(220);
      const hover = await refresh.evaluate(el => getComputedStyle(el).transform);
      // reduced motion deliberately suppresses movement.
      assert.equal(hover,'none');
      await page.emulateMedia({reducedMotion:'no-preference'});
      await refresh.hover(); await page.waitForTimeout(220);
      assert.equal(await refresh.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42), -2);
      await page.mouse.down(); await page.waitForTimeout(220);
      assert.equal(await refresh.evaluate(el => Math.round(new DOMMatrix(getComputedStyle(el).transform).a*100)),94);
      await page.mouse.up();
    } else await refresh.click();
    await hit;
    await page.waitForFunction(() => document.querySelector('[data-ui=refresh-all]').dataset.feedback === 'pending');
    assert.equal(await refresh.getAttribute('data-feedback'),'pending');
    assert.equal(await refresh.isDisabled(),true);
    unblock();
    await page.waitForFunction(() => document.querySelector('[data-ui=refresh-all]').dataset.feedback === 'success');
    await page.waitForFunction(() => document.querySelector('[data-ui=refresh-all]').dataset.feedback === 'idle');
    await page.route('**/api/refresh', route => route.fulfill({status:503,json:{error:'request failed'}}));
    await refresh.click();
    await page.waitForFunction(() => document.querySelector('[data-ui=refresh-all]').dataset.feedback === 'error');
    let orderAttempts = 0;
    await page.route('**/api/refresh', route => route.fulfill({json:{error:'source fixture failed'}}));
    await page.route('**/api/orders/refresh', route => { orderAttempts++; return route.fulfill({json:{error:null}}); });
    const orderResult = page.waitForResponse(response => response.url().endsWith('/api/orders/refresh'));
    await refresh.click();
    await orderResult;
    await page.waitForFunction(() => document.querySelector('[data-ui=refresh-all]').dataset.feedback === 'error');
    assert.equal(orderAttempts,1,'source result errors still allow the existing order sync');
    assert.deepEqual(errors,[]);
    await page.close();
  }
  await checkInteractions(browser, base, output);

}

async function checkInteractions(browser, base, output) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { localStorage.setItem('orders-language', 'en'); localStorage.setItem('orders-theme', 'light'); });
  await page.goto(base);
  for (const name of ['Predicted orders', 'Trailing orders', 'Positions', 'Entry history', 'Activity', 'Settings', 'Overview']) {
    await page.getByRole('button', { name, exact: true }).click();
    assert.ok(await page.locator('[data-ui=stagger]').count(), `${name} has shared staggered entry`);
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[data-settings-section=prediction]').click();
  const toggle = page.getByRole('switch', { name: 'Enable scheduled prediction fetching' });
  const wasChecked = await toggle.isChecked();
  await toggle.focus(); await page.keyboard.press('Space');
  assert.equal(await toggle.isChecked(), !wasChecked);
  const animation = await toggle.locator('..').locator('.jelly-thumb').evaluate(el => {
    const animation = el.getAnimations()[0];
    return animation && { duration: animation.effect.getTiming().duration, frames: animation.effect.getKeyframes().map(frame => frame.transform) };
  });
  assert.equal(animation.duration, 350);
  assert.ok(animation.frames.some(frame => frame.includes('1.35')), 'thumb stretches during its slide');
  await page.keyboard.press('Space');
  assert.equal(await toggle.isChecked(), wasChecked);
  const group = page.getByRole('group', { name: 'Quick interval' });
  await group.getByRole('radio', { name: 'Every 5 minutes', exact: true }).check();
  assert.equal(await page.getByLabel('Cron expression', { exact: true }).first().inputValue(), '*/5 * * * *');
  await group.getByRole('radio', { name: 'Custom', exact: true }).check();
  assert.equal(await page.getByLabel('Cron expression', { exact: true }).first().inputValue(), '');
  await page.locator('[data-ui=settings-back]').click();
  await page.locator('[data-settings-section=trading]').click();
  const multiplier = page.locator('input[name=close_multiplier]');
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST') writes++; });
  await multiplier.fill('0');
  await page.getByRole('button', { name: 'Save closing parameters', exact: true }).click();
  assert.equal(writes, 0, 'invalid fields block submission');
  assert.equal(await multiplier.getAttribute('aria-invalid'), 'true');
  assert.ok(await multiplier.getAttribute('aria-describedby'));
  await multiplier.fill('2.5');
  assert.equal(await multiplier.getAttribute('aria-invalid'), null, 'correcting the field clears its error');
  const save = page.getByRole('button', { name: 'Save closing parameters', exact: true });
  const began = Date.now();
  await save.click();
  await page.waitForFunction(() => document.querySelector('input[name=close_multiplier]').closest('form').querySelector('button').dataset.feedback === 'success');
  assert.ok(Date.now() - began >= 1150, 'fast real responses still show the 1.2 second loading phase');
  const circle = await save.locator('.button-surface').boundingBox();
  assert.ok(Math.abs(circle.width - 36) < 1 && Math.abs(circle.height - 36) < 1);
  assert.ok(await save.locator('.morph-check').count());
  await page.screenshot({ path: `${output}/issue-51-submit-morph.png` });
  await page.waitForFunction(() => document.querySelector('input[name=close_multiplier]').closest('form').querySelector('button').dataset.feedback === 'idle');
  assert.equal(writes, 1);
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('[data-settings-section=trading]').click();
  assert.equal(await multiplier.inputValue(), '2.5', 'saved multiplier survives page reload');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await save.locator('.button-surface').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  let resolved = false, reviewWrites = 0;
  const intent = { id: '11111111-1111-4111-8111-111111111111', operation: 'create', state: 'unknown', owner: 'test-owner', created_at: Date.now(), payload: '{}', request_id: 'test-request' };
  await page.route('**/api/status', route => route.fulfill({ json: { pending: resolved ? [] : [intent], database_error: null } }));
  await page.route('**/api/intents/resolve', route => {
    reviewWrites++;
    assert.deepEqual(route.request().postDataJSON(), { id: intent.id, evidence: 'Gate order 123456', confirmed_exchange_review: true });
    resolved = true;
    return route.fulfill({ json: { pending: [] } });
  });
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const evidence = page.getByLabel('Exchange review evidence', { exact: true });
  await evidence.waitFor();
  const review = evidence.locator('xpath=ancestor::form');
  const submit = review.getByRole('button');
  await submit.click();
  assert.equal(reviewWrites, 0, 'missing evidence and confirmation cannot submit');
  await evidence.fill('  Gate order 123456  ');
  await submit.click();
  assert.equal(reviewWrites, 0, 'evidence alone cannot clear the block');
  await review.getByRole('switch').check();
  await submit.click();
  await page.waitForFunction(() => !document.querySelector('input[name=evidence]'));
  assert.equal(reviewWrites, 1);
  await page.close();
}
