// Remote CI only. Refresh fixtures never contact an exchange or submit trades.
import assert from 'node:assert/strict';

export async function checkRefresh(browser, base, token, output) {
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => {
      localStorage.setItem('orders-language', 'zh');
      localStorage.setItem('orders-theme', theme);
    }, theme);
    await page.goto(`${base}/#token=${token}`);
    await page.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
    const navigate = async name => {
      if (width <= 768) await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.getByRole('button', { name, exact: true }).click();
      await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    };
    const all = page.locator('[data-ui=refresh-all]');
    const source = page.getByRole('button').filter({ hasText: '刷新来源' });
    const predicted = page.getByRole('button').filter({ hasText: '刷新预测订单' });
    const state = async (button, expected) => {
      await page.waitForFunction(({el, expected}) => el.dataset.feedback === expected,
        {el: await button.elementHandle(), expected}, {timeout: 2500});
    };
    let release;
    let requests = 0, orderRequests = 0;
    let gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/refresh', async route => {
      requests++;
      await gate;
      await route.fulfill({json:{error:null}});
    });
    await page.route('**/api/orders/refresh', route => {
      orderRequests++;
      return route.fulfill({json:{error:null}});
    });
    await source.click();
    await state(source, 'pending');
    assert.equal(await all.getAttribute('data-feedback'), 'idle', 'source refresh must not animate Refresh all');
    await source.evaluate(el => { el.click(); el.click(); });
    await page.waitForTimeout(100);
    assert.equal(requests, 1, 'duplicate clicks cannot start more requests');
    release();
    await state(source, 'success');
    await state(source, 'idle');
    assert.equal(orderRequests, 0, 'source refresh keeps its original API scope');
    await navigate('预测订单');
    assert.equal(await predicted.getAttribute('data-feedback'), 'idle');
    await navigate('交易概览');
    assert.equal(await source.getAttribute('data-feedback'), 'idle', 'expired success cannot replay on remount');
    await page.waitForTimeout(100);
    assert.equal(await source.getAttribute('data-feedback'), 'idle');
    assert.equal(await all.getAttribute('data-feedback'), 'idle');
    // A page-local request keeps its owner while its button is unmounted.
    await navigate('预测订单');
    gate = new Promise(resolve => { release = resolve; });
    await predicted.click();
    await state(predicted, 'pending');
    assert.equal(await all.getAttribute('data-feedback'), 'idle');
    await navigate('交易概览');
    assert.equal(await source.getAttribute('data-feedback'), 'idle');
    release();
    await page.waitForTimeout(1300);
    await navigate('预测订单');
    assert.equal(await predicted.getAttribute('data-feedback'), 'idle', 'off-page feedback expires without a mounted button');
    await navigate('交易概览');

    // Refresh all stays pending until BOTH operations finish. Then a new
    // request crosses the old result deadline without being reset by it.
    let releaseOrders;
    let ordersGate = new Promise(resolve => { releaseOrders = resolve; });
    await page.route('**/api/orders/refresh', async route => {
      orderRequests++;
      await ordersGate;
      await route.fulfill({json:{error:null}});
    });
    gate = Promise.resolve();
    await all.click();
    await state(all, 'pending');
    await page.waitForTimeout(1200);
    assert.equal(await all.getAttribute('data-feedback'), 'pending', 'second API is still running');
    assert.equal(await source.getAttribute('data-feedback'), 'idle');
    releaseOrders();
    await state(all, 'success');
    // Wait for the success color, then inspect the real return transition.
    await page.waitForTimeout(220);
    const successColor = await all.evaluate(el => getComputedStyle(el).backgroundColor);
    await state(all, 'idle');
    const returning = await all.evaluate(el => ({
      color: getComputedStyle(el).backgroundColor,
      transitioning: el.getAnimations().some(animation => animation.transitionProperty === 'background-color'),
    }));
    assert.ok(returning.transitioning, 'green-to-blue uses a real CSS transition');
    await page.waitForTimeout(220);
    assert.notEqual(await all.evaluate(el => getComputedStyle(el).backgroundColor), successColor);
    await all.click();
    await state(all, 'success');
    gate = new Promise(resolve => { release = resolve; });
    const started = requests;
    await all.click();
    await state(all, 'pending');
    await all.evaluate(el => { el.click(); el.click(); });
    await page.waitForTimeout(2000);
    assert.equal(requests, started + 1);
    assert.equal(await all.getAttribute('data-feedback'), 'pending', 'old success timeout cannot finish a new request');
    await navigate('当前持仓');
    assert.equal(await page.getByRole('button').filter({hasText:'同步持仓与订单'}).count(), 0);
    await page.getByRole('cell', {name:'BTC_USDT',exact:true}).waitFor();
    release();
    await state(all, 'success');
    await state(all, 'idle');
    const positionReads = [];
    page.on('response', response => { if (response.url().endsWith('/api/orders')) positionReads.push(response.status()); });
    const read = page.waitForResponse(response => response.url().endsWith('/api/orders'));
    await all.click();
    await read;
    await state(all, 'success');
    assert.ok(orderRequests >= 4, 'global refresh continues to sync positions and orders');
    assert.ok(positionReads.includes(200), 'position snapshot is reloaded');
    await page.getByRole('cell', {name:'BTC_USDT',exact:true}).waitFor();
    await state(all, 'idle');

    // Transport and business errors retain their explanation; business
    // errors still allow the original orders sync behavior.
    await page.route('**/api/refresh', route => route.fulfill({status:503,json:{error:'refresh unavailable'}}));
    await all.click();
    await state(all, 'error');
    await page.getByText('refresh unavailable', {exact:true}).waitFor();
    await state(all, 'idle');
    const beforeError = orderRequests;
    await page.route('**/api/refresh', route => route.fulfill({json:{error:'source fixture failed'}}));
    await all.click();
    await state(all, 'error');
    assert.equal(orderRequests, beforeError + 1);
    await page.getByText('source fixture failed', {exact:true}).waitFor();
    await state(all, 'idle');
    await navigate('交易概览');
    assert.equal(await source.getAttribute('data-feedback'), 'idle');
    assert.equal(await all.getAttribute('data-feedback'), 'idle');
    await page.screenshot({path:`${output}/refresh-idle-${width}-${theme}.png`,fullPage:true});
    // A real logout unmounts Workspace while its result timer exists.
    await page.route('**/api/refresh', route => route.fulfill({json:{error:null}}));
    await all.click();
    await state(all, 'success');
    if (width <= 768) await page.getByRole('button', {name:'打开导航',exact:true}).click();
    await page.locator('[data-ui=logout]').click();
    await page.getByRole('button', {name:/连接工作台/}).waitFor();
    await page.waitForTimeout(1100);
    await page.goto(`${base}/#token=${token}`);
    await page.getByRole('heading', {name:'交易概览',exact:true}).waitFor();
    assert.equal(await all.getAttribute('data-feedback'), 'idle');
    assert.equal(await source.getAttribute('data-feedback'), 'idle');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Refresh lifecycle regression passed on desktop and phone, light and dark');
}
