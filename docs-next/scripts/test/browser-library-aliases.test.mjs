import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { test } from 'node:test';

// Import the actual config without starting unrelated MDX content generation.
const previousMdx = process.env._FUMADOCS_MDX;
process.env._FUMADOCS_MDX = '1';
const { default: config } = await import('../../next.config.mjs');
if (previousMdx === undefined) delete process.env._FUMADOCS_MDX;
else process.env._FUMADOCS_MDX = previousMdx;

const docsRoot = resolve(import.meta.dirname, '../..');
const libraries = ['footprintjs', 'foottrace'];
function publicDoors(name) {
  const root = resolve(docsRoot, '../node_modules', name);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  return Object.entries(pkg.exports)
    .filter(([door, target]) => door !== './package.json' && target?.import?.default)
    .map(([door, target]) => [
      door === '.' ? name : `${name}/${door.slice(2)}`,
      resolve(root, target.import.default),
    ]);
}
function webpackConfig(isServer) {
  return config.webpack(
    { resolve: { alias: { existing: '/keep/me.js' } }, plugins: [] },
    {
      isServer,
      defaultLoaders: { babel: {} },
      webpack: { NormalModuleReplacementPlugin: class {} },
    },
  );
}

test('all three public Foottrace doors share the library root in the client', () => {
  const aliases = webpackConfig(false).resolve.alias;
  const doors = publicDoors('foottrace');
  assert.deepEqual(doors.map(([name]) => name).sort(), [
    'foottrace',
    'foottrace/paths',
    'foottrace/write',
  ]);
  for (const [request, file] of doors) {
    assert.equal(aliases[`${request}$`], file, request);
    assert.ok(existsSync(file), file);
    assert.equal(aliases[request], undefined, 'Webpack aliases must be exact');
  }
  assert.equal(aliases['foottrace/package.json$'], undefined);
  assert.equal(aliases.existing, '/keep/me.js');
});

test('every current public FootPrint engine door retains its exact client alias', () => {
  const aliases = webpackConfig(false).resolve.alias;
  assert.ok(publicDoors('footprintjs').length > 1);
  for (const [request, file] of publicDoors('footprintjs')) {
    assert.equal(aliases[`${request}$`], file, request);
    assert.ok(existsSync(file), file);
    assert.equal(aliases[request], undefined);
  }
  assert.equal(aliases['footprintjs/package.json$'], undefined);
});

test('Turbopack uses relative exact aliases to those same physical library files', () => {
  const aliases = config.turbopack.resolveAlias;
  for (const name of libraries) {
    for (const [request, file] of publicDoors(name)) {
      assert.equal(typeof aliases[request], 'string', request);
      assert.equal(isAbsolute(aliases[request]), false, request);
      assert.equal(resolve(docsRoot, aliases[request]), file, request);
    }
    assert.equal(aliases[`${name}/*`], undefined);
    assert.equal(aliases[`${name}/package.json`], undefined);
  }
});

test('server compiler keeps Node library resolution and existing aliases unchanged', () => {
  const aliases = webpackConfig(true).resolve.alias;
  for (const name of libraries) {
    for (const [request] of publicDoors(name)) {
      assert.equal(aliases[request], undefined, request);
      assert.equal(aliases[`${request}$`], undefined, request);
    }
  }
  assert.equal(aliases.existing, '/keep/me.js');
});
