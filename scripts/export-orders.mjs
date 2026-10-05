import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'orderstable.json');
const fields = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

async function optionalFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new Error('无法读取本地配置文件。');
  }
}

async function connectionSettings() {
  const values = {};
  for (const raw of (await optionalFile(join(root, '.env'))).split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    const match = line.match(/^([^#=]+?)\s*=\s*(.*)$/);
    if (!match || !fields.has(match[1])) continue;
    let value = match[2].trim();
    if (/^["']/.test(value)) {
      const end = value.indexOf(value[0], 1);
      if (end < 0) throw new Error('.env 中的 Supabase 配置引号没有闭合。');
      value = value.slice(1, end);
    } else {
      value = value.split(/\s+#/)[0].trim();
    }
    values[match[1]] = value;
  }
  for (const name of fields) {
    if (Object.hasOwn(process.env, name)) values[name] = process.env[name];
  }

  let configPath = process.env.ORDERS_CONFIG_PATH ?? join(root, 'config');
  if (/^~(?:[/\\]|$)/.test(configPath)) configPath = homedir() + configPath.slice(1);
  let environmentSection = false;
  for (const raw of (await optionalFile(configPath)).split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) {
      environmentSection = line === '[environment]';
      continue;
    }
    const match = line.match(/^([^#;=]+?)\s*=\s*(.*)$/);
    if (!environmentSection || !match || !fields.has(match[1])) continue;
    let value = match[2].trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error('config 中的 Supabase 配置不是有效的 JSON 字符串。');
      }
    }
    if (typeof value !== 'string') throw new Error('Supabase 配置必须是字符串。');
    values[match[1]] = value;
  }
  if (!values.SUPABASE_URL || !values.SUPABASE_ANON_KEY) {
    throw new Error('请在 .env、环境变量或 config 的 [environment] 中填写 SUPABASE_URL 和 SUPABASE_ANON_KEY。');
  }
  let url;
  try {
    url = new URL(values.SUPABASE_URL);
  } catch {
    throw new Error('SUPABASE_URL 不是有效的网址。');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SUPABASE_URL 必须是 HTTP/HTTPS 项目地址，不能带账号、查询参数或片段。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/rest/v1/orders';
  return { url, key: values.SUPABASE_ANON_KEY };
}

async function main() {
  const { url, key } = await connectionSettings();
  const headers = { apikey: key, Accept: 'application/json', Prefer: 'count=exact' };
  // Legacy anon/service-role keys are JWTs. New sb_* keys belong only in apikey.
  if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`;
  const pages = [];
  let count = 0;
  let total;
  while (true) {
    url.search = new URLSearchParams({ select: '*', order: 'id.asc', offset: String(count), limit: '1000' });
    let response;
    let body;
    try {
      response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
      body = await response.text();
    } catch {
      throw new Error('Supabase 请求失败或超过 30 秒，请检查网络和项目地址。');
    }
    if (!response.ok) throw new Error(`Supabase 返回 HTTP ${response.status}，请检查配置和 orders 表的读取权限。`);
    let rows;
    try {
      rows = JSON.parse(body);
    } catch {
      throw new Error('Supabase 返回的内容不是有效 JSON。');
    }
    if (!Array.isArray(rows) || rows.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('Supabase 返回的内容不是订单对象数组。');
    }
    const range = response.headers.get('content-range')?.match(/\/(\d+)$/);
    if (range) {
      const currentTotal = Number(range[1]);
      if (total !== undefined && currentTotal !== total) throw new Error('导出期间可读取的订单数量发生变化，请稍后重新执行。');
      total = currentTotal;
    }
    if (rows.length === 0) {
      if (total !== undefined && count !== total) throw new Error('分页提前结束，未覆盖旧文件。');
      break;
    }
    // Keep the original JSON text so large integers and decimal literals retain their precision.
    pages.push(body.trim().slice(1, -1).trim());
    count += rows.length;
    console.log(`已读取 ${count} 条订单。`);
    if (total !== undefined && count > total) throw new Error('订单数量与接口统计不一致，请重新执行。');
    if (count === total) break;
  }
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, pages.length ? `[\n${pages.join(',\n')}\n]\n` : '[]\n', { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`已将 ${count} 条订单保存到 orderstable.json。`);
}

main().catch(error => {
  console.error(`导出失败：${error.message}`);
  process.exitCode = 1;
});
