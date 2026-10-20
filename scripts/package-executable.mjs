// Use the same native Node executable for blob generation and injection.
import { copyFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { inject } = require('postject');
const config = { main: 'dist/server.cjs', output: 'dist/sea.blob', disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false };
writeFileSync('dist/sea.json', JSON.stringify(config));
const result = spawnSync(process.execPath, ['--experimental-sea-config', 'dist/sea.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const output = `dist/orders-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
copyFileSync(process.execPath, output);
if (process.platform === 'win32') {
  // Remove Node's Authenticode signature before changing PE resources.
  const sign = spawnSync(process.env.SIGNTOOL || 'signtool', ['remove', '/s', output], { stdio: 'inherit' });
  if (sign.status !== 0) throw new Error('Cannot remove original executable signature');
}
const { readFileSync } = await import('node:fs');
await inject(output, 'NODE_SEA_BLOB', readFileSync(config.output), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
chmodSync(output, 0o755);
console.log(output);
