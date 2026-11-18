import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest, inventory, assertMembers, inspectPublishedGraph } from './publishedGraph.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'published-graph-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const selected = {};
  const archives = {};
  const packages = {};
  for (const [name, version] of [['footprintjs', '14.0.0-rc.0'], ['foottrace', '2.1.0'], ['contextfootprint', '0.1.1']]) {
    const folder = join(root, 'node_modules', name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version, main: './index.js' }));
    writeFileSync(join(folder, 'index.js'), 'throw Error("fixtures must never execute");\n');
    selected[name] = { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: 'sha512-fixture-' + name };
    packages['node_modules/' + name] = selected[name];
    archives[name] = { sha256: digest(name), files: inventory(folder).map((row) => ({ ...row, path: 'package/' + row.path })) };
  }
  const lock = { lockfileVersion: 3, packages };
  const save = () => {
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
    writeFileSync(join(root, 'node_modules/.package-lock.json'), JSON.stringify(lock));
  };
  save();
  writeFileSync(join(root, 'package.json'), '{"name":"neutral-graph-fixture"}');
  return { root, inputs: { selected }, archives, lock, save };
}

test('joins admitted members to one actual consumer/engine Foottrace owner without executing fixtures', (t) => {
  const f = fixture(t);
  const graph = inspectPublishedGraph(f.root, f.inputs, f.archives);
  assert.equal(graph.foottrace.realPath, join(f.root, 'node_modules/foottrace'));
  assert.equal(graph.footprintjs.members.count, 2);
});

for (const [name, mutate] of [
  ['missing engine', (f) => rmSync(join(f.root, 'node_modules/footprintjs'), { recursive: true })],
  ['same-length altered member', (f) => writeFileSync(join(f.root, 'node_modules/foottrace/index.js'), readFileSync(join(f.root, 'node_modules/foottrace/index.js'), 'utf8').replace('Error', 'error'))],
  ['extra unadmitted file', (f) => writeFileSync(join(f.root, 'node_modules/contextfootprint/extra.js'), '')],
  ['wrong locked registry input', (f) => { f.lock.packages['node_modules/foottrace'] = { ...f.inputs.selected.foottrace, integrity: 'sha512-other' }; f.save(); }],
  ['nested same-version physical copy', (f) => {
    const nested = join(f.root, 'node_modules/footprintjs/node_modules/foottrace');
    mkdirSync(nested, { recursive: true });
    for (const file of ['package.json', 'index.js']) writeFileSync(join(nested, file), readFileSync(join(f.root, 'node_modules/foottrace', file)));
  }],
  ['extra locked same-version copy', (f) => { f.lock.packages['node_modules/else/node_modules/foottrace'] = f.inputs.selected.foottrace; f.save(); }],
  ['linked member', (f) => {
    const file = join(f.root, 'node_modules/foottrace/index.js');
    const bytes = readFileSync(file);
    rmSync(file);
    writeFileSync(join(f.root, 'same.js'), bytes);
    symlinkSync(join(f.root, 'same.js'), file);
  }],
]) {
  test('refuses ' + name, (t) => {
    const f = fixture(t);
    mutate(f);
    assert.throws(() => inspectPublishedGraph(f.root, f.inputs, f.archives));
  });
}

test('admits only the exact present owned probe, then requires its restoration', (t) => {
  const f = fixture(t);
  const root = join(f.root, 'node_modules/foottrace');
  const body = 'owned inert probe';
  const probe = { relativePath: '.context-smoke.cjs', size: Buffer.byteLength(body), sha256: digest(body) };
  writeFileSync(join(root, probe.relativePath), body);
  assertMembers(root, f.archives.foottrace, [probe]);
  assert.throws(() => assertMembers(root, f.archives.foottrace));
  writeFileSync(join(root, probe.relativePath), body.replace('owned', 'other'));
  assert.throws(() => assertMembers(root, f.archives.foottrace, [probe]));
  rmSync(join(root, probe.relativePath));
  assertMembers(root, f.archives.foottrace);
  assert.throws(() => assertMembers(root, f.archives.foottrace, [probe]));
});
