import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fixture, response } from './helpers.ts';
import { Sessions } from '../../apps/server/src/security/session.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { Credentials } from '../../apps/server/src/services/credentials.ts';
import { createServer } from '../../apps/server/src/api/index.ts';
import { credential } from '../../apps/server/src/config/index.ts';

test('authenticated API rejects missing auth, hostile origins, hosts, and secret reflection', async t => {
  const f=fixture(t), sessions=new Sessions('test-workspace-token-with-at-least-32-chars');sessions.origin='http://localhost';
  const app=createServer(f.dashboard,new Scheduler(f.config,f.dashboard),new Credentials(f.config,f.http),f.log,sessions);t.after(()=>app.close());
  assert.equal((await app.inject({method:'GET',url:'/api/data'})).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/session',headers:{origin:'http://localhost',authorization:`Bearer ${sessions.token}`}});
  assert.equal(login.statusCode,200); const cookie=String(login.headers['set-cookie']).split(';')[0];
  assert.match(String(login.headers['set-cookie']),/HttpOnly; SameSite=Strict/);
  const settings=await app.inject({method:'GET',url:'/api/settings',headers:{cookie}});assert.equal(settings.statusCode,200);assert.doesNotMatch(settings.body,/test-secret|test-key|test-anon/);
  assert.equal((await app.inject({method:'POST',url:'/api/schedule',headers:{cookie,origin:'http://evil.invalid'},payload:{enabled:false,cron:'* * * * *'}})).statusCode,403);
  assert.equal((await app.inject({method:'GET',url:'/api/orders',headers:{cookie,host:'evil.invalid'}})).statusCode,403);
  assert.equal((await app.inject({method:'GET',url:'/config',headers:{cookie}})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/api/settings',headers:{cookie,origin:'http://localhost'},payload:{INFISICAL_CLIENT_SECRET:'bad'}})).statusCode,400);
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
