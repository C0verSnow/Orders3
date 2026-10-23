import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fixture, response } from './helpers.ts';
import { WorkspaceOrigin } from '../../apps/server/src/security/origin.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { Credentials } from '../../apps/server/src/services/credentials.ts';
import { createServer } from '../../apps/server/src/api/index.ts';
import { credential } from '../../apps/server/src/config/index.ts';

test('workspace opens without login while hostile origins, hosts and secret reflection stay blocked', async t => {
  const f=fixture(t), workspace=new WorkspaceOrigin(); workspace.origin='http://localhost';
  const app=createServer(f.dashboard,new Scheduler(f.config,f.dashboard),new Credentials(f.config,f.http),f.log,workspace);t.after(()=>app.close());
  for (const url of ['/api/data','/api/orders','/api/settings','/api/history','/api/activity'])
    assert.equal((await app.inject({method:'GET',url})).statusCode,200);
  for (const method of ['GET','POST','DELETE'] as const)
    assert.equal((await app.inject({method,url:'/api/session',headers:{origin:workspace.origin}})).statusCode,404);
  const settings=await app.inject({method:'GET',url:'/api/settings'});
  assert.doesNotMatch(settings.body,/test-secret|test-key|test-anon/);
  assert.equal(settings.headers['set-cookie'],undefined);
  assert.equal((await app.inject({method:'POST',url:'/api/schedule',headers:{origin:'http://evil.invalid'},payload:{enabled:false,cron:'* * * * *'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/schedule',payload:{enabled:false}})).statusCode,403);
  assert.equal((await app.inject({method:'GET',url:'/api/orders',headers:{host:'evil.invalid'}})).statusCode,403);
  assert.equal((await app.inject({method:'GET',url:'/config'})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/api/settings',headers:{origin:workspace.origin},payload:{INFISICAL_CLIENT_SECRET:'bad'}})).statusCode,400);
});
test('configuration blanks retain secrets, explicit clear persists and rejects placeholder values', t => {
  const f=fixture(t);f.config.update({API_KEY:'',API_SECRET:''});assert.equal(f.config.connection().gateKey,'test-key');
  f.config.fallback.API_KEY='fallback-key';f.config.update({clear:['API_KEY']});assert.equal(f.config.connection().gateKey,'fallback-key');
  assert.throws(()=>f.config.update({API_SECRET:'已配置，留空保留'}));assert.equal(f.config.connection().gateSecret,'test-secret');
  assert.equal(credential(' " valid-key " '),'valid-key');assert.equal(credential("'broken"),'');
  assert.doesNotMatch(JSON.stringify(f.config.snapshot()),/test-secret|test-anon|fallback-key/);
});
test('saving environment preserves Cron and unrelated INI sections', t => {
  const f=fixture(t);writeFileSync(f.config.path,'[other]\nvalue = keep\n[schedule]\nenabled = false\ncron = */5 * * * *\n');
  f.config.update({SUPABASE_URL:'https://supabase.invalid'});const content=readFileSync(f.config.path,'utf8');assert.match(content,/value = keep/);assert.equal(f.config.schedule().cron,'*/5 * * * *');
});
test('Infisical fields resolve independently and failures retain the last memory fallback', async t => {
  const f=fixture(t,async url=>{
    if(url.pathname.includes('/login'))return response({accessToken:'private-token'});
    if(url.pathname.endsWith('/GATE_API_KEY'))return response({secret:{secretKey:'GATE_API_KEY',secretValue:'new-fallback'}});
    return response({error:'private-upstream-error'},500);
  });
  Object.assign(f.config.startup,{INFISICAL_CLIENT_ID:'id',INFISICAL_CLIENT_SECRET:'machine-secret',INFISICAL_PROJECT_ID:'project'});
  f.config.fallback.API_SECRET='old-fallback';const credentials=new Credentials(f.config,f.http);await credentials.refresh(false);credentials.stop();
  assert.equal(f.config.fallback.API_KEY,'new-fallback');assert.equal(f.config.fallback.API_SECRET,'old-fallback');assert.equal(f.config.connection().gateKey,'test-key');
  const logs=readFileSync(f.log.path,'utf8');assert.doesNotMatch(logs,/private-token|machine-secret|new-fallback|private-upstream-error/);
});
test('rotation enforces the 50 MB aggregate even with a legacy oversized current file', t => {
  const f = fixture(t);
  writeFileSync(f.log.path, Buffer.alloc(20_000_000));
  for (let index = 1; index <= 3; index++) writeFileSync(`${f.log.path}.${index}`, Buffer.alloc(10_000_000));
  f.log.write('outbound','GET',new URL('https://api.gateio.ws/api/v4/futures/usdt/positions?private=query'),200);
  let bytes = 0;
  for (let index = 0; index <= 4; index++) { const path = f.log.path + (index ? `.${index}` : ''); if (existsSync(path)) bytes += statSync(path).size; }
  assert.ok(bytes <= 50_000_000);
  assert.doesNotMatch(readFileSync(f.log.path,'utf8'),/private=query/);
});
