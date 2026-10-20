// Remote CI only: real standalone Windows EXE or real Linux Docker image.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Storage } from '../apps/server/src/database/index.ts';
const platform = process.argv[2];
assert.ok(['windows','docker'].includes(platform));
const out = resolve(`tests/artifacts/platform-${platform}`);
mkdirSync(out,{recursive:true});
const fontURL='https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf';
const fontResponse=await fetch(fontURL);assert.ok(fontResponse.ok);
const font=Buffer.from(await fontResponse.arrayBuffer());
const token='ci-platform-visual-token-at-least-32-characters';
const base='http://127.0.0.1:18093';
const manifest={platform,commit:process.env.GITHUB_SHA,fontURL,fontSHA256:createHash('sha256').update(font).digest('hex'),browser:null,deviceScaleFactor:1,timezone:'UTC',cases:[]};
const browser=await chromium.launch({args:['--disable-lcd-text','--font-render-hinting=none']});
manifest.browser=browser.version();
try {
  for(const count of [0,2,45]) {
    const directory=mkdtempSync(join(tmpdir(),'orders-platform-'));
    const seed=new Storage(join(directory,'data.db'));
    seed.saveSources(Array.from({length:count},(_,i)=>({contract:`VIS${String(i).padStart(2,'0')}_USDT`,activation_price:'100.005',amount:'2',price_round:'0.001',side:'buy',timestamp:1700000000000+i})));
    seed.close();
    if(platform==='docker') {
      // The production image runs as uid 1000 and hardens its data permissions.
      // Give that user ownership of the real seeded volume, matching deployment.
      assert.equal(spawnSync('sudo',['chown','-R','1000:1000',directory],{stdio:'inherit'}).status,0);
    }
    let child;
    const name='orders-platform-visual';
    if(platform==='windows') child=spawn(resolve('dist/orders-win32-x64.exe'),['--cached','--no-browser','--host','127.0.0.1','--port','18093'],{cwd:directory,env:{...process.env,ORDERS_DATA_DIR:directory,ORDERS_CONFIG_PATH:join(directory,'config'),ORDERS_ACCESS_TOKEN:token}});
    else child=spawn('docker',['run','--rm','--name',name,'-p','127.0.0.1:18093:8090','-v',`${directory}:/data`,'-e',`ORDERS_ACCESS_TOKEN=${token}`,'orders-dashboard:ci','--cached']);
    let logs='';child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
    try {
      let ready=false;
      for(let i=0;i<150;i++) { if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200)); }
      assert.ok(ready,logs);
      for(const width of [1440,390]) for(const language of ['zh','en']) for(const theme of ['light','dark']) {
        const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1,reducedMotion:'reduce',timezoneId:'UTC',locale:'en-US',bypassCSP:true});
        await page.addInitScript(({language,theme})=>{localStorage.setItem('orders-language',language);localStorage.setItem('orders-theme',theme);},{language,theme});
        // Serve identical font bytes locally; external dependencies never reach the application.
        await page.route('**/__ci_font.ttf',route=>route.fulfill({contentType:'font/ttf',body:font}));
        await page.goto(`${base}/#token=${token}`);
        await page.getByRole('heading',{name:language==='zh'?'交易概览':'Overview',exact:true}).waitFor();
        await page.addStyleTag({content:"@font-face { font-family: CIVisual; src: url('/__ci_font.ttf'); font-weight: 100 900; } *, *::before, *::after { font-family: CIVisual !important; }"});
        await page.evaluate(()=>document.fonts.ready);
        if(width<=768) await page.getByRole('button',{name:language==='zh'?'打开导航':'Open navigation',exact:true}).click();
        await page.getByRole('button',{name:language==='zh'?'预测订单':'Predicted orders',exact:true}).click();
        const fade=page.locator('[data-ui=scroll-fade]').first(), viewport=fade.locator('[data-ui=fade-viewport]');
        await viewport.waitFor();await page.waitForTimeout(300);
        for(const [position,ratio] of [['top',0],['quarter',.25],['middle',.5],['bottom',1]]) {
          await viewport.evaluate((el,ratio)=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*ratio;},ratio);
          await page.waitForTimeout(250);
          const metrics=await viewport.evaluate(el=>({height:el.clientHeight,width:el.clientWidth,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}));
          const more=metrics.scrollHeight-metrics.height-metrics.scrollTop>2;
          assert.equal(await fade.getAttribute('data-more'),String(more));
          const overlay=fade.locator('[data-ui=bottom-fade]');
          assert.equal(await overlay.evaluate(el=>getComputedStyle(el).opacity),more?'1':'0');
          assert.ok((await overlay.evaluate(el=>getComputedStyle(el).backgroundImage)).includes('linear-gradient'));
          const id=`${count}-${width}-${language}-${theme}-${position}`;
          const box=await viewport.boundingBox();
          // Keep the full viewport and a separately identified bottom 48px comparison region.
          await viewport.screenshot({path:join(out,`${id}.png`)});
          await page.screenshot({path:join(out,`${id}-fade.png`),clip:{x:box.x,y:box.y+metrics.height-48,width:metrics.width,height:48}});
          manifest.cases.push({id,count,width,language,theme,position,metrics,more,region:{width:metrics.width,height:48}});
        }
        await page.close();
      }
    } catch(error) {
      writeFileSync(join(out,`failure-${count}.log`), `${error.stack}\n${logs}`);
      throw error;
    } finally {
      if(platform==='docker') spawnSync('docker',['stop',name],{stdio:'inherit'});
      else child.kill('SIGTERM');
      if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},5000).unref();});
      if(platform==='docker') assert.equal(spawnSync('sudo',['rm','-rf','--',directory],{stdio:'inherit'}).status,0);
      else rmSync(directory,{recursive:true,force:true});
    }
  }
} finally {
  await browser.close();writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
}
assert.equal(manifest.cases.length,96);
console.log(`Captured ${manifest.cases.length} actual ${platform} table and fade regions`);
