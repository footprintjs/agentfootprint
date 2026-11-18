import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { resolveBrowserLibraries } from './browser-library-aliases.mjs';

function write(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

function packageAt(root, name) {
  const exports = Object.fromEntries(
    ['.', './extra', './future/door'].map((door, index) => [
      door,
      {
        import: { default: `./browser/${index}.mjs` },
        require: { default: `./native/${index}.cjs` },
      },
    ]),
  );
  exports['./package.json'] = './package.json';
  write(join(root, 'package.json'), { name, version: '1.0.0', exports });
  for (let index = 0; index < 3; index++) {
    write(join(root, `browser/${index}.mjs`), 'throw Error("fixture package must not execute");');
    write(join(root, `native/${index}.cjs`), 'throw Error("fixture package must not execute");');
  }
}

function fixture(t, topology = 'packed') {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'docs-alias-owner-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const source = join(base, 'source'),
    docs = join(source, 'docs-next');
  write(join(docs, 'package.json'), { name: 'docs-fixture', private: true });
  const agent = topology === 'linked' ? source : join(docs, 'node_modules/agentfootprint');
  const modules = topology === 'linked' ? join(source, 'node_modules') : join(docs, 'node_modules');
  packageAt(agent, 'agentfootprint');
  for (const name of ['footprintjs', 'foottrace']) packageAt(join(modules, name), name);
  if (topology === 'linked') {
    mkdirSync(join(docs, 'node_modules'), { recursive: true });
    symlinkSync(source, join(docs, 'node_modules/agentfootprint'), 'dir');
    // A symlink would give the site and AgentFootprint separate peer identities.
    for (const name of ['footprintjs', 'foottrace'])
      packageAt(join(docs, 'node_modules', name), name);
  } else {
    // A source checkout can coexist with packed docs inputs. It must not win resolution.
    for (const name of ['footprintjs', 'foottrace'])
      packageAt(join(source, 'node_modules', name), name);
  }
  return { source, docs, agent, modules };
}

test('the packed source owns every browser door without executing packages', (t) => {
  const f = fixture(t),
    result = resolveBrowserLibraries(f.docs);
  assert.equal(result.agentRoot, f.agent);
  assert.deepEqual(result.owners, {
    footprintjs: join(f.modules, 'footprintjs'),
    foottrace: join(f.modules, 'foottrace'),
  });
  assert.deepEqual(
    Object.keys(result.aliases).sort(),
    [
      'footprintjs',
      'footprintjs/extra',
      'footprintjs/future/door',
      'foottrace',
      'foottrace/extra',
      'foottrace/future/door',
    ].sort(),
  );
  for (const name of ['footprintjs', 'foottrace']) {
    assert.equal(result.aliases[name], join(f.modules, name, 'browser/0.mjs'));
    assert.equal(result.aliases[`${name}/future/door`], join(f.modules, name, 'browser/2.mjs'));
  }
});

test('refuses a symlinked source with its own peer install', (t) => {
  const f = fixture(t, 'linked');
  assert.throws(() => resolveBrowserLibraries(f.docs), /divergent footprintjs/);
});

for (const name of ['footprintjs', 'foottrace']) {
  test(`refuses a different ${name} image beneath AF instead of masking it with an alias`, (t) => {
    const f = fixture(t);
    packageAt(join(f.agent, 'node_modules', name), name);
    assert.throws(() => resolveBrowserLibraries(f.docs), /divergent/);
  });
}

test('refuses an engine-private reader even with identical version and bytes', (t) => {
  const f = fixture(t);
  packageAt(join(f.modules, 'footprintjs/node_modules/foottrace'), 'foottrace');
  assert.throws(() => resolveBrowserLibraries(f.docs), /divergent/);
});

test('requires actual AF resolution instead of falling back to its parent folder', (t) => {
  const f = fixture(t);
  rmSync(f.agent, { recursive: true });
  assert.throws(() => resolveBrowserLibraries(f.docs));
});

for (const [label, target] of [
  ['missing import condition', { require: { default: './native/1.cjs' } }],
  ['escaped import', { import: { default: '../outside.mjs' } }],
]) {
  test(`refuses ${label} rather than omitting or guessing a browser door`, (t) => {
    const f = fixture(t),
      file = join(f.modules, 'foottrace/package.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    manifest.exports['./extra'] = target;
    write(file, manifest);
    write(join(f.modules, 'outside.mjs'), 'throw Error("outside fixture");');
    assert.throws(() => resolveBrowserLibraries(f.docs));
  });
}

test('refuses a missing browser entry before the bundler starts', (t) => {
  const f = fixture(t);
  rmSync(join(f.modules, 'foottrace/browser/2.mjs'));
  assert.throws(() => resolveBrowserLibraries(f.docs));
});
