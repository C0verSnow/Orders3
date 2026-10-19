import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, source, list } from './helpers.ts';
import { signedHeaders } from '../../apps/server/src/exchange/gate.ts';
import { openOrders, closeOrders, matchOrders } from '../../apps/server/src/services/trading.ts';
import { syncEntries, fillDirection } from '../../apps/server/src/services/entry-history.ts';
import { fetchSources } from '../../apps/server/src/exchange/supabase.ts';
import { sourceOrder } from '../../apps/server/src/services/source-parser.ts';
import { Cron } from '../../apps/server/src/scheduler/index.ts';
import type { TrailOrder } from '../../packages/shared/types.ts';

test('Gate signature matches the existing official fixed test vector', () => {
  const headers = signedHeaders('GET','/api/v4/futures/orders?contract=BTC_USD&status=finished&limit=50','','key','secret',1541993715);
  assert.equal(headers.SIGN,'55f84ea195d6fe57ce62464daaa7c3c02fa9d1dde954e4c898289c9a2407a3d6fb3faf24deff16790d726b66ac9f74526668b13bd01029199cc4fcc522418b8a');
});
test('fill direction distinguishes adds, closes and reversals', () => {
  assert.equal(fillDirection('5','0'),1); assert.equal(fillDirection('-5','-2'),-1); assert.equal(fillDirection('5','5'),null);
  assert.throws(() => fillDirection('0','0')); assert.throws(() => fillDirection('5','-1'));
});
test('Cron preserves day/week OR, Sunday 7, local-time next run and strict validation', () => {
  const cron = new Cron('0 10 1 * 7');
  assert.ok(cron.matches(new Date(2026,10,1,10,0))); assert.ok(cron.matches(new Date(2026,10,8,10,0)));
  assert.equal(new Cron('*/15 * * * *').nextAfter(new Date(2026,0,1,10,15)).getMinutes(),30);
  assert.throws(() => new Cron('0 0 * * MON')); assert.throws(() => new Cron('*/0 * * * *'));
});
test('partial null source is invalid, explicit empty marker is valid, side never reverses signed size', () => {
  assert.equal(sourceOrder({ ...source, contract: null, activation_price: null, amount: null, side: null },0),null);
  assert.throws(() => sourceOrder({ ...source, contract: null },0));
  assert.equal(sourceOrder({ ...source, amount:'-2',side:'buy' },0)?.amount,'-2');
});
test('matching keeps at most one active order per desired row and preserves numeric equality', () => {
  const old: TrailOrder = { id:'1',contract:'BTC_USDT',amount:'2',activation_price:'100.5',reduce_only:false,original_status:2,timestamp:0 };
  const result = matchOrders([{ contract:'BTC_USDT',amount:'2.00',activation_price:'100.50' }],[old,{ ...old,id:'2' }],false);
  assert.equal(result.retained.size,1); assert.equal(result.candidates.length,0); assert.equal(result.results[0].id,'1');
});
test('Supabase short pages continue and numeric JSON literals remain exact', async t => {
  let count = 0;
  const f = fixture(t, async () => { count++; return count === 1 ? new Response('[{"id":9007199254740993,"contract":"BTC_USDT","activation_price":100.50,"amount":2,"side":null,"timestamp":1700000000000}]') : response([]); });
  const rows = await fetchSources(f.http, f.config.connection());
  assert.equal(rows[0].id,'9007199254740993'); assert.equal(rows[0].activation_price,'100.50'); assert.equal(count,2);
});
test('Supabase changing total fails before replacing persisted data', async t => {
  let count=0;
  const f=fixture(t,async()=>response(count++ === 0 ? [source] : [],200,{ 'content-range':count===1?'0-0/2':'*/3' })); f.storage.saveSources([source]);
  await assert.rejects(fetchSources(f.http,f.config.connection())); assert.equal(f.storage.sources().orders.length,1);
});
test('failed history batch never advances watermark', async t => {
  const f = fixture(t, async () => response([{ trade_id:'1',create_time:'1700000000',contract:'BTC_USDT',size:'5',close_size:'-1' }]));
  await assert.rejects(syncEntries(f.gate,f.storage)); assert.equal(f.storage.watermark(f.gate.owner),-1);
});
test('precision conflict stops the whole opening batch before any write', async t => {
  let posts=0;
  const f=fixture(t,async(url,init)=> { if(init.method==='POST')posts++; return response({name:'BTC_USDT',quanto_multiplier:'0.1',order_price_round:'0.005'}); });
  f.storage.saveSources([{ ...source,activation_price:'100.005', price_round:'0.003' }]);
  await assert.rejects(openOrders(f.gate,f.storage),/精度冲突/); assert.equal(posts,0); assert.equal(f.storage.intents().length,0);
});
test('ambiguous POST is persisted and never retried by a later refresh', async t => {
  let posts=0;
  const f=fixture(t,async(url,init)=> {
    if(init.method==='POST'){ posts++; throw new Error('offline'); }
    if(url.pathname.includes('/contracts/'))return response({name:'BTC_USDT',quanto_multiplier:'0.1',order_price_round:'0.5'});
    if(url.pathname.endsWith('/list'))return response(list([]));
    return response([]);
  });
  f.storage.saveSources([source]); const result=await openOrders(f.gate,f.storage);
  assert.equal(result[0].action,'failed'); assert.equal(f.storage.intents()[0].state,'unknown');
  await assert.rejects(openOrders(f.gate,f.storage),/结果未知/); assert.equal(posts,1);
});
test('empty sources stop only state 1 opening orders, preserving activated and protection orders', async t => {
  const orders: TrailOrder[] = [1,2,3].map((id,index)=>({ id:String(id),contract:'BTC_USDT',amount:'2',activation_price:'100.50',reduce_only:index===2,original_status:index===1?2:1,timestamp:0 }));
  let bodies:string[]=[];
  const f=fixture(t,async(url,init)=>{
    if(init.method==='POST'){bodies.push(String(init.body));return response({code:0,data:{orders:[]}});}
    return response(list(new URL(url).searchParams.get('page_num')==='1'?orders:[]));
  });
  f.storage.saveSources([]);f.storage.saveTrailing(orders); const result=await openOrders(f.gate,f.storage);
  assert.deepEqual(bodies,['{"id":1}']); assert.equal(result[0].action,'stopped'); assert.equal(f.storage.trailing().find(row=>row.id==='2')?.original_status,2);
});
test('close reconciliation preserves an equivalent manual protection order', async t => {
  let posts=0;
  const f=fixture(t,async(url,init)=>{
    if(init.method==='POST'){posts++;throw new Error('unexpected write');}
    if(url.pathname.endsWith('/positions')) return response([{contract:'BTC_USDT',size:2,entry_price:'100',leverage_max:'20',unrealised_pnl:'0.005',realised_pnl:'1.1',initial_margin:'1',mark_price:'101'}]);
    if(url.pathname.includes('/contracts/'))return response({name:'BTC_USDT',quanto_multiplier:'0.1',order_price_round:'0.5'});
    if(url.pathname.endsWith('/list'))return response(list(url.searchParams.get('page_num')==='1'?[{id:'999',contract:'BTC_USDT',amount:'-2',activation_price:'116.5',reduce_only:true,original_status:1}]:[]));
    return response([]);
  });
  f.storage.saveSources([source]);
  const result=await closeOrders(f.gate,f.storage);assert.equal(posts,0);assert.equal(result[0].action,'skipped');assert.equal(f.storage.positions()[0].close_price,'116.50');
});
test('acknowledged creation persists once and a repeated unchanged source does not create again', async t => {
  let created: Record<string, unknown> | undefined, posts = 0;
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') {
      posts++; const payload = JSON.parse(String(init.body));
      assert.equal(payload.amount, '2'); assert.equal(payload.activation_price, '100.5'); assert.equal(payload.is_gte, false); assert.equal(payload.price_type, 3);
      assert.equal(payload.price_offset, '1%'); assert.equal(payload.position_mode, 'dual_plus'); assert.equal(payload.reduce_only, false);
      const saved = { ...payload, id: '999999999999999999', original_status: 1 };
      created = saved;
      return response({ code: 0, data: { id: saved.id } });
    }
    if (url.pathname.includes('/contracts/')) return response({ name: 'BTC_USDT', quanto_multiplier: '0.1', order_price_round: '0.5' });
    if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' && created ? [created] : []));
    return response([]);
  });
  f.storage.saveSources([source]); assert.equal((await openOrders(f.gate, f.storage))[0].action, 'created');
  assert.equal(f.storage.trailing()[0].id, '999999999999999999'); assert.equal(f.storage.intents().length, 0);
  assert.equal((await openOrders(f.gate, f.storage))[0].action, 'skipped'); assert.equal(posts, 1);
});
test('a stop failure ends the batch before any replacement creation', async t => {
  const posts: string[] = [];
  const old = { id: '1', contract: 'BTC_USDT', amount: '3', activation_price: '100.50', reduce_only: false, original_status: 1, timestamp: 0 };
  const f = fixture(t, async (url, init) => {
    if (init.method === 'POST') { posts.push(url.pathname); return response({ code: 1, message: 'private remote text' }); }
    if (url.pathname.includes('/contracts/')) return response({ name: 'BTC_USDT', quanto_multiplier: '0.1', order_price_round: '0.5' });
    if (url.pathname.endsWith('/list')) return response(list(url.searchParams.get('page_num') === '1' ? [old] : []));
    return response([]);
  });
  f.storage.saveSources([source]); const result = await openOrders(f.gate, f.storage);
  assert.equal(result[0].action, 'failed'); assert.equal(posts.length, 1); assert.match(posts[0], /\/stop$/);
  assert.doesNotMatch(result[0].error!, /private remote text/);
});
