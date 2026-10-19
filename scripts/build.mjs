// Remote CI / developer build entry. Never run locally during agent tasks.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

if (!process.argv.includes('--server-only')) {
  const result = spawnSync(process.execPath, ['../../node_modules/vite/bin/vite.js', 'build'], { cwd: 'apps/web', stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const assets = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else {
      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      if (!types[extension]) throw new Error(`Unsupported production asset: ${entry.name}`);
      assets['/' + relative('dist/web', path).replaceAll('\\', '/')] = { type: types[extension], body: (await readFile(path)).toString('base64') };
    }
  }
}
await collect('dist/web');
if (!assets['/index.html']) throw new Error('Missing built React application');
assets['/'] = assets['/index.html'];
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['apps/server/src/main.ts'], outfile: 'dist/server.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs',
  define: { 'process.env.ORDERS_VERSION': JSON.stringify(process.env.ORDERS_VERSION || '1.0.0'), 'process.env.ORDERS_COMMIT': JSON.stringify(process.env.ORDERS_COMMIT || 'development') },
  plugins: [{ name: 'embedded-react-assets', setup(builder) {
    builder.onLoad({ filter: /[\\/]api[\\/]web-assets\.ts$/ }, () => ({ contents: `export const webAssets = ${JSON.stringify(assets)};`, loader: 'js' }));
  } }],
  // Fastify's optional logger workers are unused (logger:false); all runtime code is bundled.
  external: ['node:*'], legalComments: 'eof', metafile: true
});
