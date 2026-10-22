// Remote CI only. Exercise shared pagination with actual HTTP and SQLite snapshots.
import assert from 'node:assert/strict';
export async function checkTables(browser, base, store, output) {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const navigate = async name => {
      if (width < 768) await page.getByRole('button', {name:'打开导航',exact:true}).click();
      await page.getByRole('button', {name,exact:true}).click();
      await page.getByRole('heading', {name,exact:true,level:1}).waitFor();
      if (width < 768) await page.waitForFunction(() => document.querySelector('aside').getBoundingClientRect().right <= 1);
    };
    let baseline;
    for (const count of [0,1,2,3,4,5,8,9,10]) {
      const records = Array.from({length:count}, (_,i) => ({contract:`PAGE${String(i).padStart(2,'0')}_USDT`,activation_price:'100',amount:'1',side:'buy',timestamp:1700000000000+i}));
      store.saveSources(records);
      store.saveTrailing(records.map((row,i) => ({...row,id:String(i),reduce_only:false,original_status:1})));
      const positions = records.map(row => ({contract:row.contract,size:'1',entry_price:'100',value:'100',leverage_max:'20',unrealised_pnl:'0',realised_pnl:'0',initial_margin:'5',mark_price:'100',quanto_multiplier:'1',order_price_round:'0.01'}));
      store.savePositions(positions, positions);
      store.db.exec('DELETE FROM position_entry_history; DELETE FROM position_entry_seen');
      store.history('pagination', records.map((row,i) => ({event_id:String(i),entry_time:row.timestamp,contract:row.contract,side:1,initial_margin:'5'})),1700000000100);
      await page.goto(`${base}/`);
      await page.getByRole('heading', {name:'交易概览',exact:true}).waitFor();
      for (const name of ['预测订单','跟踪订单','当前持仓','入仓历史']) {
        await navigate(name);
        const table = page.getByRole('table', {name,exact:true});
        const viewport = page.getByRole('region', {name:`${name}表格，可横向或纵向滚动`,exact:true});
        await page.waitForFunction(({name,count}) => {
          const table = [...document.querySelectorAll('table')].find(el => el.caption?.textContent === name);
          return table?.querySelectorAll('tbody tr[data-ui=row]').length === Math.min(count,4);
        }, {name,count});
        const height = (await viewport.boundingBox()).height;
        baseline ??= height;
        assert.equal(height,baseline,`${width}px ${name}, ${count}: stable viewport`);
        assert.ok(await viewport.evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'four complete rows never require vertical scrolling');
        const seen = new Set();
        for (let index=0; index<Math.max(1,Math.ceil(count/4)); index++) {
          assert.equal(await table.locator('tbody [data-ui=row]').count(),Math.min(4,Math.max(0,count-index*4)));
          const cells = await table.locator('tbody [data-ui=row] td:first-child').allTextContents();
          for (const cell of cells) { assert.ok(!seen.has(cell),'no repeated records across pages'); seen.add(cell); }
          assert.equal((await viewport.boundingBox()).height,height);
          if (index < Math.ceil(count/4)-1) await page.getByRole('button',{name:'下一页',exact:true}).click();
        }
        assert.equal(seen.size,count);
        if (count > 4) {
          await page.getByRole('searchbox',{name:`搜索${name}`,exact:true}).fill('PAGE00');
          await table.getByRole('cell',{name:'PAGE00 / USDT',exact:true}).waitFor();
          assert.equal(await table.locator('tbody [data-ui=row]').count(),1,'filter resets a now-invalid last page');
          await page.getByRole('searchbox',{name:`搜索${name}`,exact:true}).fill('');
          await table.getByRole('columnheader').first().getByRole('button').click();
          assert.equal(await table.locator('tbody [data-ui=row]').count(),4);
          await table.locator('tbody [data-ui=row]').first().getByRole('button').click();
          await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
        }
        if (name === '预测订单') {
          assert.equal(await page.getByRole('button',{name:/刷新预测订单/}).count(),0);
          assert.equal(await page.getByRole('button',{name:/手动开仓/}).count(),1);
        }
      }
    }
    await page.screenshot({path:`${output}/four-row-pagination-${width}.png`,fullPage:true});
    await page.close();
  }
  console.log('Four tables passed 0/1/2/3/4/5/8/9/10 boundaries at 1440px and 390px, stable heights, search, sorting and details');
}
