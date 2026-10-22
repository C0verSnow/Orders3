// Remote CI only. Bundle a window runtime beside the unchanged standalone service.
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('dist/desktop', { recursive: true });
mkdirSync('dist/desktop-service', { recursive: true });
copyFileSync('desktop/main.cjs', 'dist/desktop/main.cjs');
writeFileSync('dist/desktop/package.json', JSON.stringify({ name: 'orders3-desktop', version: process.env.FILE_VERSION || '1.0.0', main: 'main.cjs', description: 'Orders3 trading workspace', author: 'Orders3 maintainers', license: 'UNLICENSED' }));
const suffix = process.platform === 'win32' ? '.exe' : '';
copyFileSync(`dist/orders-${process.platform}-${process.arch}${suffix}`, `dist/desktop-service/orders-service${suffix}`);
const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'electron-builder@26.15.3', '--config', 'desktop/builder.json', process.platform === 'win32' ? '--win' : '--linux', process.arch === 'arm64' ? '--arm64' : '--x64', '--publish', 'never'], { stdio: 'inherit', shell: process.platform === 'win32' });
process.exitCode = result.status ?? 1;
