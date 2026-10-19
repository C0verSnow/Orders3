import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Settings, Schedule } from '../../../../packages/shared/types.ts';
import { AppError } from '../utils/errors.ts';

const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_KEY', 'API_SECRET', 'ORDERS_DATA_DIR', 'ORDERS_ALLOWED_ORIGIN'] as const;
const secrets = ['SUPABASE_ANON_KEY', 'API_KEY', 'API_SECRET'];
const expand = (value: string) => resolve(value.replace(/^~(?=$|[/\\])/, homedir()));
export function credential(value: string): string {
  let text = value.trim();
  if ((text.startsWith('"') || text.startsWith("'")) && text.at(-1) === text[0]) text = text.slice(1, -1).trim();
  return text.length <= 4096 && /^[!-~]*$/.test(text) && !/["']/.test(text) ? text : '';
}
export function serviceUrl(value: string, rootOnly = false): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('服务地址不是有效网址'); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || (rootOnly && url.pathname !== '/')) throw new AppError('服务地址须为 HTTPS（本机可 HTTP），不含账号、查询或片段');
  return url;
}
export function iniSection(text: string, section: string): Record<string, string> {
  const result: Record<string, string> = {};
  let current = '';
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    if (/^\[.*\]$/.test(line)) { current = line.slice(1, -1); continue; }
    if (current !== section) continue;
    const match = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new AppError('配置文件格式错误');
    let value: unknown = match[2];
    if (match[2].startsWith('"')) {
      try { value = JSON.parse(match[2]); } catch { throw new AppError('配置文件字符串格式错误'); }
    }
    if (typeof value !== 'string') throw new AppError('配置值必须是文本');
    result[match[1].trim()] = value;
  }
  return result;
}
export function replaceSection(text: string, section: string, values: Record<string, string>): string {
  let skip = false;
  const output = text.split(/\r?\n/).filter(line => {
    if (/^\[.*\]$/.test(line.trim())) skip = line.trim() === `[${section}]`;
    return !skip;
  });
  return `${output.join('\n').trim()}\n\n[${section}]\n${Object.entries(values).map(([name, value]) => `${name} = ${JSON.stringify(value)}`).join('\n')}\n`;
}
export interface Connection { supabaseUrl: string; supabaseKey: string; gateKey: string; gateSecret: string }
export class Configuration {
  path: string;
  databasePath: string;
  environment: Record<string, string>;
  fallback: Record<string, string> = {};
  startup: NodeJS.ProcessEnv;
  restartRequired = false;
  private connectionUsers = 0;
  private pendingFallback: Record<string, string> | null = null;
  private defaultDataPath: string;
  acquireConnection() {
    this.connectionUsers++;
    return () => {
      this.connectionUsers--;
      if (!this.connectionUsers && this.pendingFallback) { this.fallback = this.pendingFallback; this.pendingFallback = null; }
    };
  }
  setFallback(values: Record<string, string>) {
    const next = { ...(this.pendingFallback ?? this.fallback), ...values };
    if (this.connectionUsers) this.pendingFallback = next;
    else this.fallback = next;
  }
  constructor(startup: NodeJS.ProcessEnv = process.env, root = process.cwd()) {
    const defaults: Record<string, string> = {};
    const executableRoot = dirname(process.execPath);
    const envPath = existsSync(join(executableRoot, '.env')) ? join(executableRoot, '.env') : join(root, '.env');
    if (existsSync(envPath)) {
      for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(raw.trim());
        if (!match) continue;
        let value = match[2];
        if (value.startsWith('"') || value.startsWith("'")) {
          const end = value.indexOf(value[0], 1);
          if (end < 0) throw new AppError('.env 引号没有闭合');
          value = value.slice(1, end);
        } else value = value.split(/\s+#/)[0].trim();
        defaults[match[1]] = value;
      }
    }
    this.startup = { ...defaults, ...startup };
    const checkout = existsSync(join(root, 'apps/server/src/main.ts'));
    this.path = expand(this.startup.ORDERS_CONFIG_PATH || (checkout ? join(root, 'config') : join(homedir(), '.orders-dashboard/config')));
    const saved = iniSection(this.text(), 'environment');
    this.environment = Object.fromEntries(names.map(name => [name, saved[name] ?? this.startup[name] ?? '']));
    for (const name of ['API_KEY', 'API_SECRET']) this.environment[name] = credential(this.environment[name]);
    this.defaultDataPath = checkout ? join(root, 'data') : join(homedir(), '.orders-dashboard');
    this.databasePath = join(expand(this.environment.ORDERS_DATA_DIR || this.defaultDataPath), 'data.db');
  }
  text() { return existsSync(this.path) ? readFileSync(this.path, 'utf8') : ''; }
  saveSection(section: string, values: Record<string, string>) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, replaceSection(this.text(), section, values), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.path);
    } finally { rmSync(temporary, { force: true }); }
  }
  connection(): Connection {
    return { supabaseUrl: this.environment.SUPABASE_URL, supabaseKey: this.environment.SUPABASE_ANON_KEY,
      gateKey: credential(this.environment.API_KEY) || this.fallback.API_KEY || '', gateSecret: credential(this.environment.API_SECRET) || this.fallback.API_SECRET || '' };
  }
  snapshot(): Settings {
    const connection = this.connection();
    return { SUPABASE_URL: this.environment.SUPABASE_URL, ORDERS_DATA_DIR: this.environment.ORDERS_DATA_DIR,
      ORDERS_ALLOWED_ORIGIN: this.environment.ORDERS_ALLOWED_ORIGIN, config_path: this.path, database_path: this.databasePath,
      restart_required: this.restartRequired, configured: { SUPABASE_ANON_KEY: !!connection.supabaseKey, API_KEY: !!connection.gateKey, API_SECRET: !!connection.gateSecret },
      credential_sources: Object.fromEntries(['API_KEY', 'API_SECRET'].map(name => [name, this.environment[name] ? '本地配置' : this.fallback[name] ? 'Infisical 备用凭证' : '未配置'])) };
  }
  update(payload: unknown): Settings {
    if (this.connectionUsers) throw new AppError('任务正在使用连接配置，请等待任务完成后保存', 409);
    const schema = z.object(Object.fromEntries(names.map(name => [name, z.string().max(8192).optional()]))).extend({ clear: z.array(z.enum(['SUPABASE_ANON_KEY', 'API_KEY', 'API_SECRET'])).optional() }).strict();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new AppError('配置包含无效字段或类型');
    const next = { ...this.environment };
    for (const name of names) {
      const value = parsed.data[name];
      if (typeof value !== 'string') continue;
      if (secrets.includes(name) && value === '') continue;
      if (['API_KEY', 'API_SECRET'].includes(name)) {
        const normalized = credential(value);
        if (!normalized) throw new AppError('Gate 凭证格式无效');
        next[name] = normalized;
      } else next[name] = value.trim();
    }
    for (const name of parsed.data.clear ?? []) next[name] = '';
    if (next.SUPABASE_URL) serviceUrl(next.SUPABASE_URL, true);
    if (next.ORDERS_ALLOWED_ORIGIN && new URL(next.ORDERS_ALLOWED_ORIGIN).origin !== next.ORDERS_ALLOWED_ORIGIN) throw new AppError('允许来源须为完整 Origin，不带路径');
    this.saveSection('environment', next);
    this.environment = next;
    this.restartRequired = join(expand(next.ORDERS_DATA_DIR || this.defaultDataPath), 'data.db') !== this.databasePath;
    return this.snapshot();
  }
  schedule(): Schedule {
    const section = iniSection(this.text(), 'schedule');
    return { enabled: section.enabled !== 'false', cron: section.cron ?? '*/15 * * * *' };
  }
}
