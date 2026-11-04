// Remote CI only, using the production UI and the existing cached server.
import assert from 'node:assert/strict';

export async function checkNavigation(browser, base, output) {
  for (const width of [1440, 390]) {
    for (const language of ['zh', 'en']) {
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height: 950 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        await page.getByRole('heading', { name: '交易概览', exact: true }).waitFor();
        if (language === 'en') await page.locator('[data-ui="language-switch"]').click();
        await page.waitForFunction(() => !document.documentElement.hasAttribute('data-revealing'));
        if (theme === 'dark') await page.locator('[data-ui="theme-switch"]').click();
        await page.waitForFunction(() => !document.documentElement.hasAttribute('data-revealing'));
        const nav = page.getByRole('navigation');
        const buttons = nav.getByRole('button');
        assert.equal(await buttons.count(), 7);
        const labels = await buttons.locator('.button-label').allTextContents();
        const open = page.getByRole('button', { name: language === 'zh' ? '打开导航' : 'Open navigation', exact: true });
        for (let index = 0; index < labels.length; index++) {
          if (width === 390) await open.click();
          const button = buttons.nth(index);
          if (index % 2 === 0) await button.click();
          else { await button.focus(); await page.keyboard.press('Enter'); }
          await page.getByRole('heading', { name: labels[index], exact: true, level: 1 }).waitFor();
          assert.equal(await button.getAttribute('aria-current'), 'page');
          assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
          assert.deepEqual(await buttons.evaluateAll(elements => elements.map(element => ({
            feedback: element.dataset.feedback,
            busy: element.getAttribute('aria-busy'),
            labelOpacity: getComputedStyle(element.querySelector('.button-label')).opacity,
            feedbackText: element.querySelector('[role="status"]').textContent,
          }))), labels.map(() => ({ feedback: 'idle', busy: 'false', labelOpacity: '1', feedbackText: '' })), 'navigation keeps its labels instead of loading or success feedback');
          assert.deepEqual(await buttons.locator('.button-label').allTextContents(), labels);
          if (width === 390) assert.equal(await page.locator('aside').evaluate(element => element.inert), true);
        }
        if (width === 390) await open.click();
        await page.waitForTimeout(1300);
        assert.deepEqual(await buttons.evaluateAll(elements => elements.map(element => element.dataset.feedback)), labels.map(() => 'idle'), 'navigation never turns into delayed success feedback');
        await page.screenshot({ path: `${output}/issue-53-navigation-${width}-${language}-${theme}.png`, fullPage: true });
        assert.deepEqual(errors, []);
        await page.close();
      }
    }
  }
}
