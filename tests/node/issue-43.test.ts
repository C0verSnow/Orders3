// Remote CI only. Real SQLite, fake exchange; no live account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, response, list } from './helpers.ts';
import { syncEntries } from '../../apps/server/src/services/entry-history.ts';
import { Scheduler } from '../../apps/server/src/scheduler/index.ts';
import { Storage } from '../../apps/server/src/database/index.ts';
const now = new Date('2026-10-23T12:00:00Z').getTime();
const position = { contract: 'BTC_USDT', size: '2', entry_price: '100', initial_margin: '1.25', leverage_max: '20', unrealised_pnl: '0', realised_pnl: '0', mark_price: '101' };
const rule = { name: 'BTC_USDT', quanto_multiplier: '0.1', order_price_round: '0.5' };
const fill = { trade_id: '900', contract: 'BTC_USDT', size: '2', close_size: '0', create_time: String(now / 1000 - 60) };

test('43 independent ten-minute poll runs with opening off and no sources', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  let fills = 0;
  const f = fixture(t, async (url, init) => {
    assert.equal(init.method, 'GET');
    if (url.pathname.includes('my_trades_timerange')) { fills++; return response(url.searchParams.get('offset') === '0' ? [fill] : []); }
    if (url.pathname.endsWith('/positions')) return response([position]);
    if (url.pathname.includes('/contracts/')) return response(rule);
    return response(list([]));
  });
  const scheduler = new Scheduler(f.config, f.dashboard);
  assert.equal(scheduler.snapshot().opening?.enabled, false);
  await scheduler.tick(new Date(now + 599999)); assert.equal(fills, 0);
  t.mock.timers.setTime(now + 600000); await scheduler.tick();
  assert.ok(fills > 0); assert.equal(f.storage.entrySeen(f.gate.owner, '900'), true);
});

test('43 missing margin is filled on later poll without a new fill and stays fixed after restart', async t => {
  let positions: typeof position[] = [];
  const f = fixture(t, async url => response(url.pathname.endsWith('/positions') ? positions : url.searchParams.get('offset') === '0' ? [fill] : []));
  await syncEntries(f.gate, f.storage, now);
  assert.equal(f.storage.rows('position_entry_history', 'entry_time')[0].initial_margin, null);
  positions = [position]; await syncEntries(f.gate, f.storage, now + 1000);
  assert.equal(f.storage.rows('position_entry_history', 'entry_time')[0].initial_margin, '1.25');
  const reopened = new Storage(f.storage.path); t.after(() => reopened.close());
  positions = [{ ...position, initial_margin: '99' }]; await syncEntries(f.gate, reopened, now + 2000);
  assert.equal(reopened.rows('position_entry_history', 'entry_time').length, 1);
  assert.equal(reopened.rows('position_entry_history', 'entry_time')[0].initial_margin, '1.25');
});

test('43 failed position query does not advance successful sync and later cycle retries', async t => {
  let fail = true;
  const f = fixture(t, async url => {
    if (url.pathname.endsWith('/positions')) return response(fail ? {} : [position], fail ? 503 : 200);
    return response(url.searchParams.get('offset') === '0' ? [fill] : []);
  });
  await assert.rejects(syncEntries(f.gate, f.storage, now));
  assert.equal(f.storage.watermark(f.gate.owner), -1);
  fail = false; await syncEntries(f.gate, f.storage, now + 1000);
  assert.equal(f.storage.watermark(f.gate.owner), now + 1000);
  assert.equal(f.storage.rows('position_entry_history', 'entry_time').length, 1);
});
