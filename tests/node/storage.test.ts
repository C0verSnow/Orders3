import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fixture, source } from './helpers.ts';
import { Storage } from '../../apps/server/src/database/index.ts';

test('source raw decimals and IDs survive normalization, atomic failure preserves snapshot', t => {
  const { storage } = fixture(t); storage.saveSources([{ ...source, activation_price: '100.505' }]);
  assert.equal(storage.sources().orders[0].activation_price, '100.51');
  assert.equal(storage.sources().items[0].activation_price, '100.505');
  assert.equal(storage.sources().items[0].id, source.id);
  assert.throws(() => storage.saveSources([{ ...source, amount: '2.1' }]));
  assert.equal(storage.sources().items[0].activation_price, '100.505');
  storage.saveSources([{ contract: null, activation_price: null, amount: null, side: null, timestamp: 1700000000001 }]);
  assert.equal(storage.sources().orders.length, 0); assert.equal(storage.sources().items.length, 1);
});
test('entry history keeps 100 events and fixed margins survive pruning and duplicate fill replay', t => {
  const { storage } = fixture(t), now = Date.now();
  const events = Array.from({ length: 105 }, (_, index) => ({ event_id: String(index), entry_time: now - 105 + index, contract: 'BTC_USDT', side: 1, initial_margin: '1.005' }));
  storage.history('owner', events, now);
  assert.equal(storage.rows('position_entry_history','entry_time').length, 100);
  assert.equal(storage.fixedMargin('owner','BTC_USDT',1,'99'), '1.005');
  storage.history('owner', events, now + 1); assert.equal(storage.rows('position_entry_history','entry_time').length, 100);
  assert.equal(storage.recentEntry('BTC_USDT', 1, now), true); assert.equal(storage.recentEntry('BTC_USDT', -1, now), false);
});
test('seven-day boundary is inclusive and opposite direction does not block', t => {
  const { storage } = fixture(t), now = Date.now(); storage.history('owner', [{ event_id: '1', contract: 'BTC_USDT', side: 1, entry_time: now - 7 * 86400000 }], now);
  assert.ok(storage.recentEntry('BTC_USDT', 1, now)); assert.equal(storage.recentEntry('BTC_USDT', 1, now + 1), false);
});
test('unknown intents remain across database reopen and download is a standalone SQLite snapshot', t => {
  const { storage, root } = fixture(t); const id = storage.intent('create', '{"contract":"BTC_USDT"}'); storage.intentState(id,'unknown');
  const path = join(root,'copy.db'); writeFileSync(path, storage.download());
  const copy = new Storage(path); try { assert.equal(copy.intents()[0].id, id); } finally { copy.close(); }
});
test('legacy records and aliases remain readable without rewriting raw JSON numbers', t => {
  const { storage } = fixture(t);
  storage.db.exec(`CREATE TABLE records(position INTEGER PRIMARY KEY,record_json TEXT); CREATE TABLE orders(record_position INTEGER,order_index INTEGER,symbol TEXT,price TEXT,size TEXT,orders_time TEXT)`);
  storage.db.prepare('INSERT INTO records VALUES (0,?)').run('{"id":9007199254740993,"data":"raw"}');
  storage.db.prepare('INSERT INTO orders VALUES (0,0,?,?,?,?)').run('BTC_USDT','100.50','2','1700000000000');
  assert.equal(storage.sources().items[0].id,'9007199254740993'); assert.equal(storage.sources().orders[0].contract,'BTC_USDT');
});
test('quota rollback includes another SQLite file and leaves old snapshot readable', t => {
  const { root } = fixture(t), path = join(root,'limited.db');
  const limited = new Storage(path, 160000); try {
    limited.saveSources([source]);
    const other = new DatabaseSync(join(root,'other.db')); other.exec('CREATE TABLE blobs(data BLOB); INSERT INTO blobs VALUES (zeroblob(140000))'); other.close();
    assert.throws(() => limited.saveSources([])); assert.equal(limited.sources().orders.length,1);
  } finally { limited.close(); }
});
