// Remote CI only. Launch the actual portable EXE / installed DEB in a graphical session.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const executable = resolve(process.argv[2]);
const directory = mkdtempSync(join(tmpdir(),'orders-desktop-'));
mkdirSync('tests/artifacts/desktop',{recursive:true});
let child, browser;
async function launch() {
  let output = '';
  browser = undefined;
  child = spawn(executable,['--cached','--desktop','--port','18095','--remote-debugging-port=19295','--no-sandbox'], {
    cwd:directory,env:{...process.env,ORDERS_DATA_DIR:directory,ORDERS_CONFIG_PATH:join(directory,'config')},stdio:['ignore','pipe','pipe'],
  });
  child.stdout.on('data',chunk=>{output+=chunk;}); child.stderr.on('data',chunk=>{output+=chunk;});
  for(let i=0;i<300;i++) {
    if(child.exitCode!==null) throw new Error(`Desktop exited ${child.exitCode}: ${output}`);
    try { browser=await chromium.connectOverCDP('http://127.0.0.1:19295'); break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(browser,`desktop debugging endpoint ready: ${output}`);
  const context = browser.contexts()[0];
  let page;
  for(let i=0;i<150;i++) {
    if(child.exitCode!==null) throw new Error(`Desktop exited before loading the service (${child.exitCode}): ${output}`);
    page=context.pages().find(page=>page.url().startsWith('http://127.0.0.1:18095'));
    if(page) break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(page,`native window loaded local service; pages=${JSON.stringify(context.pages().map(page=>page.url()))}: ${output}`);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('heading',{name:'交易概览',exact:true}).waitFor();
  assert.equal(context.pages().length,1,'one embedded window, no extra browser tab');
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined','renderer has no Node access');
  assert.equal(await page.locator('input[type=password]').count(),0);
  for(const name of ['预测订单','跟踪订单','当前持仓','入仓历史','系统设置']) {
    await page.getByRole('button',{name,exact:true}).click();
    await page.getByRole('heading',{name,exact:true,level:1}).waitFor();
  }
  await page.screenshot({path:`tests/artifacts/desktop/${process.platform}-${process.arch}.png`,fullPage:true});
  await page.reload();
  await page.getByRole('heading',{name:'交易概览',exact:true}).waitFor();
  await page.evaluate(()=>window.close());
  for(let i=0;i<100;i++) {
    let running=false;
    try { running=(await fetch('http://127.0.0.1:18095/health',{signal:AbortSignal.timeout(500)})).ok; } catch {}
    // The portable wrapper and HTTP service can exit before Electron's CDP
    // endpoint. Reconnecting to that old endpoint races the second launch.
    let debugging=false;
    try { debugging=(await fetch('http://127.0.0.1:19295/json/version',{signal:AbortSignal.timeout(500)})).ok; } catch {}
    if(!running && !debugging && child.exitCode!==null) { browser=undefined; return; }
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error(`Window close left service/desktop/debug endpoint running: ${output}`);
}
try {
  await launch();
  // Reuse the same data directory and port: proves the lock and listener were released.
  await launch();
  writeFileSync(`tests/artifacts/desktop/${process.platform}-${process.arch}.json`,JSON.stringify({executable,passed:['real native window','no token prompt','all pages','sandbox renderer','reload','window close stops backend','restart same port and database']},null,2));
  console.log('Actual desktop package passed startup, embedded UI, close and restart checks');
} catch(error) {
  writeFileSync(`tests/artifacts/desktop/${process.platform}-${process.arch}-failure.log`,String(error.stack || error));
  throw error;
} finally {
  if(browser) await browser.close().catch(()=>{});
  if(child?.exitCode===null) child.kill();
  rmSync(directory,{recursive:true,force:true});
}
