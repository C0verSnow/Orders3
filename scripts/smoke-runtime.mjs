// Remote CI only. Starts an already-built server or the actual installed artifact.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory = mkdtempSync(join(tmpdir(), 'orders-runtime-'));
const token = 'ci-only-runtime-access-token-0123456789';
const [executable = process.execPath, ...args] = process.argv.slice(2);
const port = 18090;
const processArgs = args.length ? args : executable === process.execPath ? ['dist/server.cjs'] : [];
const command = resolve(executable), resolvedArgs = processArgs.map(value => value.endsWith('.cjs') ? resolve(value) : value);
const child = spawn(command, [...resolvedArgs, '--cached', '--no-browser', '--host', '127.0.0.1', '--port', String(port)], { cwd: directory,
  env: { ...process.env, ORDERS_DATA_DIR: directory, ORDERS_CONFIG_PATH: join(directory, 'config'), ORDERS_ACCESS_TOKEN: token } });
let output = '';
child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let index = 0; index < 100; index++) {
    if (child.exitCode !== null) throw new Error(`Artifact exited: ${output}`);
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'artifact readiness');
  const html = await (await fetch(base)).text(); assert.match(html, /<html/); assert.doesNotMatch(html, /qwebchannel|QtWebEngine/i);
  for (const path of [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1])) assert.equal((await fetch(base + path)).status, 200);
  assert.equal((await fetch(base + '/api/data')).status, 401);
  const headers = { Authorization: `Bearer ${token}`, Origin: base, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/session', { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(base + '/api/data', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/orders', { headers })).status, 200);
  const schedule = await fetch(base + '/api/schedule', { method: 'POST', headers, body: JSON.stringify({ enabled: false, cron: '*/15 * * * *' }) }); assert.equal(schedule.status, 200);
  assert.match(readFileSync(join(directory, 'config'), 'utf8'), /enabled/);
  assert.equal((await fetch(base + '/api/settings', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/settings', { method: 'POST', headers: { ...headers, Origin: 'http://evil.invalid' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/download', { headers })).status, 200);
  assert.equal((await fetch(base + '/config')).status, 404);
  assert.ok(existsSync(join(directory, 'data.db')));
  console.log('Actual artifact passed authenticated HTTP, React assets, persistence, download and origin checks');
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000).unref(); });
  rmSync(directory, { recursive: true, force: true });
}
