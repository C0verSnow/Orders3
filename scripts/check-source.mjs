// Parse-only static inspection: no TypeScript program, type checking, transpilation or build.
import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
let count = 0;
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) inspect(path);
    else if (/\.(?:ts|tsx|mjs)$/.test(path)) {
      const source = readFileSync(path, 'utf8');
      const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      if (parsed.parseDiagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.parseDiagnostics, { getCanonicalFileName: value => value, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
      if (directory.startsWith('apps') && /QWebChannel|QtWebEngine|\.cpp\b|CMake/.test(source)) throw new Error(`Legacy runtime dependency in ${path}`);
      count++;
    }
  }
}
for (const directory of ['apps', 'packages', 'tests/node', 'scripts']) inspect(directory);
for (const file of ['package.json', 'apps/server/package.json', 'apps/web/package.json', 'package-lock.json']) JSON.parse(readFileSync(file, 'utf8'));
for (const file of ['CMakeLists.txt', 'resources.qrc']) if (existsSync(file)) throw new Error(`Legacy build entry remains: ${file}`);
console.log(`Static syntax and architecture checks passed for ${count} source files (no compilation)`);
