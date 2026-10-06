import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

async function runExport(mock, check, config) {
  const root = await mkdtemp(join(tmpdir(), 'orders-export-'));
  try {
    await mkdir(join(root, 'scripts'));
    const script = join(root, 'scripts', 'export-orders.mjs');
    await copyFile(new URL('../../scripts/export-orders.mjs', import.meta.url), script);
    await writeFile(join(root, '.env'), 'SUPABASE_URL=https://example.supabase.co\nSUPABASE_ANON_KEY=sb_publishable_test\n');
    if (config) await writeFile(join(root, 'config'), config);
    await writeFile(join(root, 'orderstable.json'), '[{"old":true}]\n');
    const runner = join(root, 'runner.mjs');
    await writeFile(runner, `import assert from 'node:assert/strict';\n${mock}\nawait import(${JSON.stringify(pathToFileURL(script).href)});`);
    const env = { ...process.env };
    for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ORDERS_CONFIG_PATH']) delete env[name];
    const result = spawnSync(process.execPath, [runner], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    await check(result, await readFile(join(root, 'orderstable.json'), 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('continues after capped pages and preserves large integers and decimals', async () => {
  await runExport(`
    const pages = ['[{"id":9007199254740993,"value":0.1234567890123456789}]', '[{"id":9007199254740994}]'];
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(url.pathname, '/rest/v1/orders');
      assert.equal(url.searchParams.get('order'), 'id.asc');
      assert.equal(url.searchParams.get('offset'), String(calls));
      assert.equal(options.headers.apikey, 'sb_publishable_test');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, 'error');
      return new Response(pages[calls++], { headers: { 'content-range': (calls - 1) + '-' + (calls - 1) + '/2' } });
    };
  `, (result, output) => {
    assert.equal(result.status, 0, result.stderr);
    assert.match(output, /9007199254740993/);
    assert.match(output, /0\.1234567890123456789/);
    assert.equal(JSON.parse(output).length, 2);
  });
});

test('HTTP failure on a later page preserves the existing file and hides server details', async () => {
  await runExport(`
    let calls = 0;
    globalThis.fetch = async () => calls++ === 0
      ? new Response('[{"id":1}]', { headers: { 'content-range': '0-0/2' } })
      : new Response('private-server-detail', { status: 401 });
  `, (result, output) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HTTP 401/);
    assert.doesNotMatch(result.stderr, /private-server-detail|sb_publishable_test/);
    assert.equal(output, '[{"old":true}]\n');
  });
});

test('changing row count aborts without replacing the existing file', async () => {
  await runExport(`
    let calls = 0;
    globalThis.fetch = async () => new Response('[{"id":1}]', {
      headers: { 'content-range': calls++ === 0 ? '0-0/2' : '1-1/3' }
    });
  `, (result, output) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /数量发生变化/);
    assert.equal(output, '[{"old":true}]\n');
  });
});

test('invalid response keeps the existing file', async () => {
  await runExport(`globalThis.fetch = async () => new Response('{"error":true}');`, (result, output) => {
    assert.equal(result.status, 1);
    assert.equal(output, '[{"old":true}]\n');
  });
});

test('saved config overrides environment and dotenv, with legacy JWT authentication', async () => {
  await runExport(`
    process.env.SUPABASE_ANON_KEY = 'environment-key';
    globalThis.fetch = async (url, options) => {
      assert.equal(url.host, 'saved.supabase.co');
      assert.equal(options.headers.apikey, 'a.b.c');
      assert.equal(options.headers.Authorization, 'Bearer a.b.c');
      return new Response('[]', { headers: { 'content-range': '*/0' } });
    };
  `, (result, output) => {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(output, '[]\n');
  }, '[environment]\nSUPABASE_URL = "https://saved.supabase.co"\nSUPABASE_ANON_KEY = "a.b.c"\n');
});
