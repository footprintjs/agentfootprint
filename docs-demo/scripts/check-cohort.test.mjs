import { deepStrictEqual, equal, match, ok } from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const manifest = require('../package.json');
const lock = require('../package-lock.json');

test('the demo resolves its exact published cohort with one engine and Foottrace', () => {
  const packages = [
    'agentfootprint',
    'agentfootprint-lens',
    'footprint-explainable-ui',
    'footprintjs',
    'foottrace',
  ];
  for (const name of packages) {
    const key = `node_modules/${name}`;
    const entries = Object.keys(lock.packages).filter(
      (path) => path === key || path.endsWith(`/${key}`),
    );
    deepStrictEqual(entries, [key], `${name} must resolve to a single installed package`);
    const entry = lock.packages[key];
    equal(entry.version, manifest.dependencies[name]);
    match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
    match(entry.integrity, /^sha512-/);
  }
  for (const owner of packages.slice(0, 3)) {
    const ownerRequire = createRequire(require.resolve(owner));
    for (const shared of ['footprintjs', 'foottrace']) {
      equal(ownerRequire.resolve(shared), require.resolve(shared), `${owner} must share ${shared}`);
    }
  }
});

test('the published weather viewer stays within its asset budget', () => {
  const assets = new URL('../dist/assets/', import.meta.url);
  const names = readdirSync(assets);
  ok(names.some((name) => name.endsWith('.js')));
  ok(names.some((name) => name.endsWith('.css')));
  const bytes = names.reduce(
    (sum, name) => sum + gzipSync(readFileSync(new URL(name, assets)), { level: 9 }).byteLength,
    0,
  );
  ok(bytes <= 200_000, `Quick Start viewer: ${bytes} B gzip exceeds its 200,000 B budget`);
  console.log(`Quick Start viewer: ${bytes} B gzip across ${names.length} assets`);
});
