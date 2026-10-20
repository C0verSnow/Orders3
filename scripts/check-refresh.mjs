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
    await page.screenshot({path:`${output}/refresh-idle-${width}-${theme}.png`,fullPage:true});
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Refresh lifecycle regression passed on desktop and phone, light and dark');
}
