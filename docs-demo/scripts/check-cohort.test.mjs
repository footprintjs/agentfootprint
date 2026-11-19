import { deepStrictEqual, equal, match } from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

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
