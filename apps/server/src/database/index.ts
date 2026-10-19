import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, readdirSync, openSync, readSync, closeSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parse } from 'lossless-json';
import { decimal, two } from '../../../../packages/decimal/index.ts';
import type { SourceOrder, TrailOrder, Position, EntryEvent, Intent } from '../../../../packages/shared/types.ts';
import { sourceOrder, legacyOrders } from '../services/source-parser.ts';
import { AppError } from '../utils/errors.ts';

const fields = ['url', 'created_at', 'status_code', 'error', 'data'];
export const DATABASE_LIMIT = 450_000_000;
export class Storage {
  db: DatabaseSync;
  path: string;
  private limit: number;
  schemaError: string | null = null;
  constructor(path: string, limit = DATABASE_LIMIT) {
    this.path = path; this.limit = limit;
    this.db = new DatabaseSync(path, { timeout: 5000 });
    // Preserve legacy WAL mode: forcing a checkpoint here could grow an oversized
    // main file before quota enforcement and prevent read-only recovery.
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    try { this.transaction(() => this.schema()); }
    catch (error) { this.schemaError = error instanceof AppError ? error.message : '数据库升级失败，已保留旧数据，请检查数据库结构和空间'; }
  }
  columns(table: string): string[] { return this.db.prepare(`PRAGMA table_info("${table}")`).all().map(row => String(row.name)); }
  exists(table: string) { return this.columns(table).length > 0; }
  rows(table: string, order: string): Record<string, unknown>[] {
    if (!this.exists(table)) return [];
    const query = this.db.prepare(`SELECT * FROM "${table}" ORDER BY ${order}`);
    query.setReadBigInts(true);
    return query.all().map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, typeof value === 'bigint' ? (['timestamp', 'record_position', 'order_index', 'position', 'original_status', 'reduce_only', 'entry_time', 'through_ms'].includes(name) ? Number(value) : value.toString()) : value])));
  }
  budget() {
    let occupied = 0;
    for (const name of readdirSync(dirname(this.path))) {
      const file = join(dirname(this.path), name);
      if (resolve(file) === resolve(this.path) || !statSync(file).isFile()) continue;
      let sqlite = /\.(db|sqlite|sqlite3)$/.test(name);
      if (!sqlite && statSync(file).size >= 16) {
        const fd = openSync(file, 'r'), header = Buffer.alloc(16);
        try { readSync(fd, header, 0, 16, 0); sqlite = header.toString() === 'SQLite format 3\0'; } finally { closeSync(fd); }
      }
      if (!sqlite) continue;
      // A legacy WAL's committed pages may grow its main database later.
      let size = statSync(file).size;
      const other = new DatabaseSync(file, { readOnly: true, timeout: 1000 });
      try { size = Math.max(size, Number(other.prepare('PRAGMA page_count').get()!.page_count) * Number(other.prepare('PRAGMA page_size').get()!.page_size)); }
      finally { other.close(); }
      occupied += size;
    }
    const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
    const pages = Number(this.db.prepare('PRAGMA page_count').get()!.page_count);
    const maximum = Math.floor((this.limit - occupied) / pageSize);
    if (maximum < 1 || pages > maximum || (existsSync(this.path) && statSync(this.path).size > this.limit - occupied)) throw new AppError('数据库合计超过 450 MB，已拒绝写入；仍可读取和下载', 507);
    const actual = this.db.prepare(`PRAGMA max_page_count=${maximum}`).get()!;
    if (Number(actual.max_page_count) > maximum) throw new AppError('数据库空间预算设置失败', 507);
  }
  transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { this.budget(); const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* SQLITE_FULL may already roll back. */ } throw error; }
  }
  schema() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS orderslist (id TEXT PRIMARY KEY NOT NULL,contract TEXT NOT NULL,amount TEXT NOT NULL,activation_price TEXT NOT NULL,reduce_only INTEGER NOT NULL,original_status INTEGER NOT NULL,timestamp INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS position (contract TEXT NOT NULL,entry_price TEXT NOT NULL,value TEXT NOT NULL,leverage_max TEXT NOT NULL,unrealised_pnl TEXT NOT NULL,realised_pnl TEXT NOT NULL,size INTEGER NOT NULL,initial_margin TEXT NOT NULL,mark_price TEXT NOT NULL,close_price TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS position_entry_history (event_id TEXT PRIMARY KEY NOT NULL,entry_time INTEGER NOT NULL,contract TEXT NOT NULL,side INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS position_entry_sync (owner TEXT PRIMARY KEY NOT NULL,through_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS position_entry_margin (owner TEXT NOT NULL,contract TEXT NOT NULL,side INTEGER NOT NULL,event_id TEXT NOT NULL,entry_time INTEGER NOT NULL,initial_margin TEXT,PRIMARY KEY(owner,contract,side));
      CREATE TABLE IF NOT EXISTS trade_intents (id TEXT PRIMARY KEY,operation TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,exchange_id TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS raw_positions (contract TEXT NOT NULL,size TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(contract,size));
      CREATE TABLE IF NOT EXISTS snapshots (name TEXT PRIMARY KEY,updated_at TEXT NOT NULL);`);
    for (const [table, name] of [['position', 'quanto_multiplier'], ['position', 'order_price_round'], ['position_entry_history', 'initial_margin'], ['orderslist', 'raw_activation_price'], ['orderslist', 'raw_amount']]) {
      if (!this.columns(table).includes(name)) this.db.exec(`ALTER TABLE "${table}" ADD COLUMN "${name}" TEXT`);
    }
    if (this.columns('orderslist').includes('trigger_price')) {
      // Old trigger_price was not the activation price. Never promote it into an execution parameter.
      if (!this.columns('orderslist').includes('activation_price')) this.db.exec('ALTER TABLE orderslist ADD COLUMN activation_price TEXT');
    }
  }
  updated(name: string): string | null { return this.exists('snapshots') ? (this.db.prepare('SELECT updated_at FROM snapshots WHERE name=?').get(name)?.updated_at as string ?? null) : null; }
  touch(name: string) { this.db.prepare('INSERT OR REPLACE INTO snapshots VALUES (?,?)').run(name, new Date().toISOString()); }
  sources(): { items: Record<string, unknown>[]; orders: SourceOrder[] } {
    const items = this.rows('records', 'position').map(row => {
      if (typeof row.record_json === 'string') return parse(row.record_json, undefined, number => number) as Record<string, unknown>;
      const item = JSON.parse(String(row.extra_json)) as Record<string, unknown>;
      for (const name of JSON.parse(String(row.present_fields)) as string[]) {
        if (!fields.includes(name)) throw new AppError('旧来源记录字段无效');
        item[name] = name === 'data' && row.data_format === 'json' ? JSON.parse(String(row.data)) : row[name];
      }
      return item;
    });
    let orders: SourceOrder[];
    if (this.exists('orders')) orders = this.rows('orders', 'record_position,order_index').map(row => {
      const price = String(row.activation_price ?? row.price ?? '').replace(/\s+USDT$/i, ''), amount = String(row.amount ?? row.size ?? '').replace(/\s+contracts?$/i, '');
      const time = row.timestamp ?? row.orders_time;
      return { ...row, contract: row.contract ?? row.symbol, activation_price: price ? two(price) : null,
        amount: amount ? two(amount) : null, timestamp: time === null || time === undefined || !Number.isSafeInteger(Number(time)) ? null : Number(time),
        raw_activation_price: row.raw_activation_price ?? price, raw_amount: row.raw_amount ?? amount };
    }) as unknown as SourceOrder[];
    else orders = items.flatMap((item, index) => typeof item.data === 'string' ? legacyOrders(item.data, index) : []);
    return { items, orders };
  }
  saveSources(items: Record<string, unknown>[]) {
    const orders = items.map((item, index) => sourceOrder(item, index));
    this.transaction(() => {
      this.db.exec(`DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS records;
        CREATE TABLE records (position INTEGER PRIMARY KEY,url TEXT,created_at TEXT,status_code INTEGER,error TEXT,data TEXT,data_format TEXT NOT NULL,extra_json TEXT NOT NULL,present_fields TEXT NOT NULL);
        CREATE TABLE orders (record_position INTEGER NOT NULL REFERENCES records(position),order_index INTEGER NOT NULL,contract TEXT NOT NULL,activation_price TEXT,side TEXT,amount TEXT,timestamp INTEGER,quanto_multiplier TEXT,order_price_round TEXT,raw_activation_price TEXT,raw_amount TEXT,PRIMARY KEY(record_position,order_index));`);
      const record = this.db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?)'), order = this.db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      items.forEach((item, index) => {
        const extra = { ...item }; for (const name of fields) delete extra[name];
        record.run(index, item.url as string ?? null, item.created_at as string ?? null, item.status_code as string ?? null, item.error as string ?? null,
          typeof item.data === 'string' ? item.data : JSON.stringify(item.data ?? null), typeof item.data === 'string' ? 'text' : 'json', JSON.stringify(extra), JSON.stringify(fields.filter(name => Object.hasOwn(item, name))));
        const row = orders[index];
        if (row) order.run(index, 0, row.contract, row.activation_price, row.side, row.amount, row.timestamp, row.quanto_multiplier ?? null, row.order_price_round ?? null, String(item.activation_price), String(item.amount));
      });
      this.touch('sources');
    });
  }
  trailing(): TrailOrder[] { return this.rows('orderslist', 'id').map(row => ({ ...row, amount: String(row.amount), reduce_only: !!row.reduce_only, original_status: Number(row.original_status), activation_price: row.activation_price ?? null })) as unknown as TrailOrder[]; }
  saveTrailing(rows: TrailOrder[]) {
    this.transaction(() => {
      if (this.columns('orderslist').includes('trigger_price')) {
        this.db.exec('DROP TABLE orderslist; CREATE TABLE orderslist(id TEXT PRIMARY KEY NOT NULL,contract TEXT NOT NULL,amount TEXT NOT NULL,activation_price TEXT NOT NULL,reduce_only INTEGER NOT NULL,original_status INTEGER NOT NULL,timestamp INTEGER NOT NULL,raw_activation_price TEXT,raw_amount TEXT)');
      }
      this.db.exec('DELETE FROM orderslist');
      const insert = this.db.prepare('INSERT INTO orderslist(id,contract,amount,activation_price,reduce_only,original_status,timestamp,raw_activation_price,raw_amount) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const row of rows) {
        const raw = row as TrailOrder & { raw_activation_price?: string; raw_amount?: string };
        insert.run(row.id, row.contract, two(row.amount), two(row.activation_price), row.reduce_only ? 1 : 0, row.original_status, row.timestamp, raw.raw_activation_price ?? row.activation_price, raw.raw_amount ?? row.amount);
      }
      this.touch('orders');
    });
  }
  positions(): Position[] { return this.rows('position', 'contract,size').map(row => {
    const result: Record<string, unknown> = { ...row, size: two(String(row.size)) };
    for (const name of ['entry_price','value','leverage_max','unrealised_pnl','realised_pnl','initial_margin','mark_price','close_price']) if (typeof result[name] === 'string') result[name] = two(result[name] as string);
    return result;
  }) as unknown as Position[]; }
  rawPositions(): Record<string, unknown>[] {
    const raw = this.rows('raw_positions', 'contract,size').map(row => JSON.parse(String(row.payload)) as Record<string, unknown>);
    return raw.length ? raw : this.rows('position', 'contract,size');
  }
  savePositions(rows: Position[], raw: unknown[]) {
    this.transaction(() => {
      this.db.exec('DELETE FROM position; DELETE FROM raw_positions');
      const names = ['contract', 'entry_price', 'value', 'leverage_max', 'unrealised_pnl', 'realised_pnl', 'size', 'initial_margin', 'mark_price', 'close_price', 'quanto_multiplier', 'order_price_round'] as const;
      const insert = this.db.prepare(`INSERT INTO position(${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`);
      for (const row of rows) insert.run(...names.map(name => name === 'size' ? BigInt(decimal(row.size).toFixed(0)) : row[name]));
      const record = this.db.prepare('INSERT INTO raw_positions VALUES (?,?,?)');
      for (const item of raw as Record<string, unknown>[]) record.run(String(item.contract), String(item.size), JSON.stringify(item));
    });
  }
  watermark(owner: string) { return this.exists('position_entry_sync') ? Number(this.db.prepare('SELECT through_ms FROM position_entry_sync WHERE owner=?').get(owner)?.through_ms ?? -1) : -1; }
  history(owner: string, events: EntryEvent[], through: number) {
    this.transaction(() => {
      const previous = this.watermark(owner);
      if (through < previous) throw new AppError('入仓历史进度已变化');
      const insert = this.db.prepare('INSERT OR IGNORE INTO position_entry_history(event_id,entry_time,contract,side,initial_margin) VALUES (?,?,?,?,?)');
      const margin = this.db.prepare(`INSERT INTO position_entry_margin VALUES (?,?,?,?,?,?) ON CONFLICT(owner,contract,side) DO UPDATE SET event_id=excluded.event_id,entry_time=excluded.entry_time,initial_margin=excluded.initial_margin WHERE excluded.entry_time>position_entry_margin.entry_time OR (excluded.entry_time=position_entry_margin.entry_time AND excluded.event_id>position_entry_margin.event_id)`);
      for (const event of events) {
        if (event.entry_time <= previous) continue;
        if (event.initial_margin != null && decimal(event.initial_margin).lt(0)) throw new AppError('固定保证金不能为负');
        const id = `${owner}:${event.event_id}`;
        const result = insert.run(id, event.entry_time, event.contract, event.side, event.initial_margin ?? null);
        if (result.changes) margin.run(owner, event.contract, event.side, id, event.entry_time, event.initial_margin ?? null);
      }
      this.db.exec('DELETE FROM position_entry_history WHERE event_id NOT IN (SELECT event_id FROM position_entry_history ORDER BY entry_time DESC,event_id DESC LIMIT 100)');
      this.db.prepare('INSERT OR REPLACE INTO position_entry_sync VALUES (?,?)').run(owner, through);
    });
  }
  fixedMargin(owner: string, contract: string, side: number, observed: string): string {
    if (decimal(observed).lt(0)) throw new AppError('固定保证金不能为负');
    return this.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO position_entry_margin VALUES (?,?,?,'',-1,NULL)").run(owner, contract, side);
      this.db.prepare('UPDATE position_entry_margin SET initial_margin=? WHERE owner=? AND contract=? AND side=? AND initial_margin IS NULL').run(observed, owner, contract, side);
      const row = this.db.prepare('SELECT initial_margin,event_id FROM position_entry_margin WHERE owner=? AND contract=? AND side=?').get(owner, contract, side)!;
      this.db.prepare('UPDATE position_entry_history SET initial_margin=? WHERE event_id=? AND initial_margin IS NULL').run(row.initial_margin!, row.event_id!);
      return String(row.initial_margin);
    });
  }
  recentEntry(contract: string, side: number, now = Date.now()): boolean { return !!this.db.prepare('SELECT 1 FROM position_entry_history WHERE contract=? AND side=? AND entry_time>=? AND entry_time<=? LIMIT 1').get(contract, side, now - 7 * 86400000, now); }
  intents(): Intent[] { return this.exists('trade_intents') ? this.rows('trade_intents', 'created_at DESC').filter(row => ['pending', 'unknown'].includes(String(row.state))) as unknown as Intent[] : []; }
  intent(operation: string, payload: string): string {
    const id = randomUUID();
    this.transaction(() => this.db.prepare("INSERT INTO trade_intents VALUES (?,?,?,'pending',NULL,?)").run(id, operation, payload, Date.now()));
    return id;
  }
  intentState(id: string, state: string, exchangeId?: string) { this.transaction(() => this.db.prepare('UPDATE trade_intents SET state=?,exchange_id=? WHERE id=?').run(state, exchangeId ?? null, id)); }
  download(): Buffer {
    const directory = mkdtempSync(join(tmpdir(), 'orders-snapshot-')), target = join(directory, 'data.db');
    try { this.db.prepare('VACUUM INTO ?').run(target); return readFileSync(target); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
  close() { this.db.close(); }
}
