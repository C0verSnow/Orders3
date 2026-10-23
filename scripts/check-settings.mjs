// Runs only in remote CI against an already built server. No exchange access.
import assert from 'node:assert/strict';
export async function checkSettings(browser, base, output) {
  for (const width of [1440]) for (const language of ['zh', 'en']) for (const theme of ['light', 'dark']) {
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
    assert.equal(await cards.count(), 4);
    const titles = zh ? ['外观设置','连接与存储','预测抓取','自动开仓'] : ['Appearance Settings','Connections & Storage','Prediction Fetching','Automatic Entry'];
    for (let i=0;i<4;i++) await cards.nth(i).getByText(titles[i],{exact:true}).waitFor();
    assert.equal(await page.locator('[data-ui=settings] input:visible, [data-ui=settings] select:visible').count(), 0);
    const sizes = await cards.evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return [r.x,r.width,r.height,r.y]; }));
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(sizes[i].slice(0,3), sizes[0].slice(0,3));
      assert.equal(sizes[i][2], 96);
      if (i) assert.equal(sizes[i][3] - sizes[i-1][3] - 96, 16);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({path:`${output}/settings-overview-${width}-${language}-${theme}.png`,fullPage:true});
    for (const section of ['appearance','connections','prediction','opening']) {
      await page.locator(`[data-settings-section=${section}]`).click();
      await page.locator('[data-ui=settings-back]').waitFor();
      const visibleForms = page.locator('[data-ui=settings] form:visible');
      assert.equal(await visibleForms.count(), section === 'appearance' ? 0 : 1);
      if (section === 'appearance') {
        for (const mode of ['light','dark','system']) {
          await page.locator('[data-ui=theme-select]').selectOption(mode);
          assert.equal(await page.evaluate(() => localStorage.getItem('orders-theme')), mode);
        }
        await page.locator('[data-ui=theme-select]').selectOption(theme);
      } else {
        const endpoint = section === 'connections' ? '/api/settings' : section === 'prediction' ? '/api/schedule' : '/api/schedule/opening';
        const form = visibleForms;
        if (section === 'connections') await form.locator('input[name=ORDERS_DATA_DIR]').fill('');
        else await form.locator('input:not([type=checkbox])').fill(section === 'prediction' ? '7 * * * *' : '3 * * * *');
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
}
