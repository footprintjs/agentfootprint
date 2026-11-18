/** Original archive members and one physical published-cohort graph. No package execution. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, lstatSync, openSync, fstatSync, readFileSync, closeSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative, sep } from 'node:path';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function readRegular(file, limit = 16 * 1024 * 1024) {
  assert.equal(realpathSync(dirname(file)), resolve(dirname(file)), 'aliased file parent');
  const before = lstatSync(file);
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= limit, 'invalid regular file');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    assert(stat.dev === before.dev && stat.ino === before.ino && stat.nlink === 1 && stat.isFile());
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    assert(bytes.length <= limit && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs, 'file changed while reading');
    return bytes;
  } finally { closeSync(fd); }
}

export function inventory(root) {
  assert.equal(realpathSync(root), resolve(root), 'aliased inventory root');
  const rows = [];
  let total = 0;
  let entries = 0;
  function walk(directory, depth = 0) {
    assert(depth <= 64, 'inventory depth exceeded');
    for (const name of readdirSync(directory).sort()) {
      assert(++entries <= 20000, 'inventory entry bound exceeded');
      const file = join(directory, name);
      const stat = lstatSync(file);
      assert(!stat.isSymbolicLink(), 'linked inventory member');
      if (stat.isDirectory()) walk(file, depth + 1);
      else {
        const bytes = readRegular(file, 32 * 1024 * 1024);
        total += bytes.length;
        assert(total <= 128 * 1024 * 1024 && rows.length < 20000, 'inventory bound exceeded');
        rows.push({ path: relative(root, file).split(sep).join('/'), size: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  walk(root);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function assertMembers(root, admitted, probes = []) {
  const actual = inventory(root);
  for (const probe of probes) {
    assert(!admitted.files.some((row) => row.path === 'package/' + probe.relativePath), 'probe collides with admitted member');
    const index = actual.findIndex((row) => row.path === probe.relativePath);
    assert(index >= 0, 'missing owned probe');
    assert.deepEqual(actual[index], { path: probe.relativePath, size: probe.size, sha256: probe.sha256 });
    actual.splice(index, 1);
  }
  const expected = admitted.files.map((row) => ({ ...row, path: row.path.slice('package/'.length) })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(actual, expected, 'installed archive members changed');
  return { count: actual.length, sha256: digest(JSON.stringify(actual)) };
}

function census(modules, selected, result = {}) {
  assert.equal(realpathSync(modules), resolve(modules), 'aliased modules root');
  for (const name of readdirSync(modules)) {
    if (name.startsWith('.')) continue;
    const entry = join(modules, name);
    const stat = lstatSync(entry);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'linked or non-directory installed package');
    if (name.startsWith('@')) {
      census(entry, selected, result);
      continue;
    }
    const manifest = JSON.parse(readRegular(join(entry, 'package.json'), 1024 * 1024));
    if (selected.includes(manifest.name)) (result[manifest.name] ??= []).push(realpathSync(entry));
    const nested = join(entry, 'node_modules');
    if (lstatOptional(nested)) census(nested, selected, result);
  }
  return result;
}
function lstatOptional(file) {
  try { return lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function packageOwner(entry, name) {
  let cursor = dirname(realpathSync(entry));
  for (;;) {
    const manifest = join(cursor, 'package.json');
    if (lstatOptional(manifest) && JSON.parse(readRegular(manifest, 1024 * 1024)).name === name) return cursor;
    const parent = dirname(cursor);
    assert.notEqual(parent, cursor, 'package owner not found');
    cursor = parent;
  }
}

export function publicEntries(root, manifest, admitted) {
  const entries = { cjs: {}, esm: {} };
  const here = createRequire(join(root, 'package.json'));
  for (const [door, specifier] of [['.', 'agentfootprint'], ['./providers', 'agentfootprint/providers'], ['./observe', 'agentfootprint/observe']]) {
    const branches = manifest.exports?.[door];
    assert.deepEqual(Object.keys(branches).sort(), ['import', 'require']);
    for (const [condition, mode] of [['import', 'esm'], ['require', 'cjs']]) {
      const branch = branches[condition];
      assert.deepEqual(Object.keys(branch).sort(), ['default', 'types']);
      assert(typeof branch.default === 'string' && branch.default.startsWith('./dist/') && !branch.default.split('/').includes('..'));
      const member = 'package/' + branch.default.slice(2);
      assert(admitted.files.some((row) => row.path === member), 'public entry not admitted');
      const entry = join(root, 'node_modules/agentfootprint', branch.default);
      assert.equal(realpathSync(entry), resolve(entry), 'aliased public entry');
      if (mode === 'cjs') assert.equal(here.resolve(specifier), entry);
      entries[mode][specifier] = entry;
    }
  }
  return entries;
}

export function assertLockedInputs(lock, inputs, agent = null, production = false) {
  const names = [...Object.keys(inputs.selected), ...(agent ? ['agentfootprint'] : [])];
  for (const name of names) {
    const expected = name === 'agentfootprint' ? { version: inputs.source.version, integrity: agent.integrity } : inputs.selected[name];
    const matches = Object.entries(lock.packages).filter(([key]) => key === 'node_modules/' + name || key.endsWith('/node_modules/' + name));
    assert.equal(matches.length, 1, 'duplicate locked package: ' + name);
    const [key, record] = matches[0];
    assert.equal(key, 'node_modules/' + name);
    assert.equal(record.version, expected.version);
    assert.equal(record.integrity, expected.integrity);
    assert.equal(record.link, undefined, 'linked setup input');
    if (production) assert.notEqual(record.dev, true, 'required production input marked dev');
    if (name !== 'agentfootprint') assert.equal(record.resolved, expected.resolved);
  }
}

export function inspectPublishedGraph(root, inputs, archives, agent = null, probes = []) {
  root = realpathSync(root);
  const setupLock = JSON.parse(readRegular(join(root, 'package-lock.json')));
  const installedLock = JSON.parse(readRegular(join(root, 'node_modules/.package-lock.json')));
  const names = [...Object.keys(inputs.selected), ...(agent ? ['agentfootprint'] : [])];
  assertLockedInputs(setupLock, inputs, agent);
  assertLockedInputs(installedLock, inputs, agent);
  const physical = census(join(root, 'node_modules'), names);
  const result = {};
  for (const name of names) {
    const location = join(root, 'node_modules', name);
    assert.deepEqual(physical[name], [location], 'one physical package required: ' + name);
    const admitted = name === 'agentfootprint' ? agent : archives[name];
    const expected = name === 'agentfootprint' ? { version: inputs.source.version, integrity: agent.integrity } : inputs.selected[name];
    const manifest = JSON.parse(readRegular(join(location, 'package.json'), 1024 * 1024));
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, expected.version);
    const members = assertMembers(location, admitted, name === 'agentfootprint' ? probes : []);
    result[name] = { realPath: location, version: manifest.version, archiveSha256: admitted.sha256, members };
    if (name === 'agentfootprint') result[name].entries = publicEntries(root, manifest, admitted);
  }
  const here = createRequire(join(root, 'package.json'));
  const engine = here.resolve('footprintjs');
  const direct = packageOwner(here.resolve('foottrace'), 'foottrace');
  assert.equal(packageOwner(engine, 'footprintjs'), result.footprintjs.realPath);
  assert.equal(packageOwner(createRequire(engine).resolve('foottrace'), 'foottrace'), direct, 'engine Foottrace differs');
  if (agent) {
    const entry = here.resolve('agentfootprint');
    assert.equal(packageOwner(entry, 'agentfootprint'), result.agentfootprint.realPath);
    assert.equal(packageOwner(createRequire(entry).resolve('foottrace'), 'foottrace'), direct, 'agent Foottrace differs');
  }
  assert.equal(direct, result.foottrace.realPath);
  return result;
}
