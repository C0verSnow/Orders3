// Static checks only: no build, native executable, credentials or remote API access.
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name) => readFileSync(path.join(root, name), "utf8");
const html = read("web/index.html");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "Duplicate HTML IDs");
const resources = read("resources.qrc");
const server = read("src/app/server.cpp");
const files = readdirSync(path.join(root, "web"));
for (const name of files.filter((file) => /\.(js|css|html|svg)$/.test(file))) {
  assert(resources.includes(`alias="${name}"`), `${name} missing from Qt resources`);
  assert(server.includes(`"/${name}"`), `${name} missing from server whitelist`);
  if (!name.endsWith(".js")) continue;
  const source = read(`web/${name}`);
  const result = spawnSync(process.execPath, ["--check", path.join(root, "web", name)], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  for (const [, dependency] of source.matchAll(/from\s+"\.\/([^"]+)"/g)) {
    assert(files.includes(dependency), `${name} imports missing ${dependency}`);
  }
  for (const [, id] of source.matchAll(/\$\("([^"]+)"\)/g)) {
    assert(ids.includes(id), `${name} references missing #${id}`);
  }
}
for (const [, target] of html.matchAll(/(?:src|href)="\/([^"?#]+)"/g)) {
  if (!target.startsWith("api/")) assert(files.includes(target), `HTML references missing ${target}`);
}
console.log("Web syntax, imports, DOM references and embedded asset routes passed.");
