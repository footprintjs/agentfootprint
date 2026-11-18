/** Check the installed docs consumer after its normal npm ci, without loading package code. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readAfTar } from '../publish-archive/tarReader.cjs';
import { integrity, sha256 } from './zipMember.mjs';

const sources = ['agentfootprint', 'agentfootprint-lens', 'footprint-explainable-ui'];
const native = ['footprintjs', 'foottrace'];
// Registry SRI and the installed member census of those same original release archives.
// Member encoding matches the native context graph from AF's 37985a9c source.
const published = {
  footprintjs: { version: '14.0.0-rc.0',
    integrity: 'sha512-oBaE4kZFgLso4DzntWDgTJ03WVdcjMxBmyMa0mqt6XzcIEkBMuOe2P9TKTJSL4L5ZyxjHPutUbPRpYu+APcfDA==',
    membersSha256: '5a063e9e8e7c0548873a693cdcf26b5e3ead6e8ff13caeade2a2d5bddba37a96' },
  foottrace: { version: '2.1.0',
    integrity: 'sha512-FaFqEPRvawnfy1AA9mNQ8DqKBlAXNAcM9tLnz7ZDTyYHebQRCawIHI6z4hFl0GOaMokWbIwp8E2jp0naUXNfgQ==',
    membersSha256: '6965f09c2b7cd9818642bfea20c176fc38294cec0365f37b9a16febd9a4689cd' },
};

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const byPath = (a, b) => a.path.localeCompare(b.path);
const vendor = (name) => 'vendor/native-candidate/' + name + '.tgz';

function sourceIdentity(docs, name, pin) {
  const path = join(docs, vendor(name));
  assert.equal(realpathSync(path), path, 'original archive location: ' + name);
  assert(lstatSync(path).isFile(), 'original archive file: ' + name);
  const bytes = readFileSync(path);
  assert.equal(sha256(bytes), pin.sha256, 'original archive SHA256: ' + name);
  assert.equal(integrity(bytes), pin.integrity, 'original archive integrity: ' + name);
  const { files, identityBytes } = readAfTar(bytes, {
    maxArchiveBytes: 32 * 1024 * 1024, maxExpandedBytes: 128 * 1024 * 1024, maxFiles: 20000,
  });
  const manifest = JSON.parse(identityBytes);
  assert.equal(manifest.name, name, 'archive name');
  assert.equal(manifest.version, pin.version, 'archive version');
  const rows = files.map(({ path, size, sha256 }) => ({ path: path.slice('package/'.length), size, sha256 }));
  return { version: pin.version, integrity: pin.integrity, resolved: 'file:' + vendor(name),
    membersSha256: sha256(JSON.stringify(rows.sort(byPath))) };
}

function verifyLock(lock, expected) {
  for (const [name, selected] of Object.entries(expected)) {
    const key = 'node_modules/' + name;
    const records = Object.entries(lock.packages).filter(([path, record]) =>
      path === key || path.endsWith('/' + key) || record.name === name);
    assert.deepEqual(records.map(([path]) => path), [key], 'locked owner: ' + name);
    const record = records[0][1];
    assert.equal(record.link, undefined, 'linked owner: ' + name);
    assert.equal(record.version, selected.version, 'locked version: ' + name);
    assert.equal(record.resolved, selected.resolved, 'locked locator: ' + name);
    assert.equal(record.integrity, selected.integrity, 'locked integrity: ' + name);
  }
}

function assertPhysicalOwners(docs, names) {
  const modules = join(docs, 'node_modules');
  const found = Object.fromEntries(names.map((name) => [name, []]));
  // Inspect every package lookup directory, including nested, scoped and npm alias slots.
  // Other package.json files can be examples or module-format scopes inside a distribution.
  for (const item of readdirSync(modules, { recursive: true, withFileTypes: true })) {
    if (!(item.isDirectory() || item.isSymbolicLink())) continue;
    const path = join(item.parentPath, item.name);
    const slot = relative(docs, path).split(sep).join('/');
    if (!/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/.test(slot)) continue;
    const manifest = join(path, 'package.json');
    if (!existsSync(manifest)) continue;
    const { name } = json(manifest);
    if (Object.hasOwn(found, name)) found[name].push(path);
  }
  for (const name of names) {
    const path = join(modules, name);
    assert.deepEqual(found[name], [path], 'physical owner: ' + name);
    assert.equal(realpathSync(path), path, 'aliased physical owner: ' + name);
  }
}

function installedMembers(root) {
  const rows = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // npm can place unrelated transitive dependencies here. Their owners are checked separately.
      if (directory === root && entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        assert(entry.isFile() && lstatSync(path).nlink === 1, 'linked installed member: ' + path);
        const bytes = readFileSync(path);
        rows.push({ path: relative(root, path).split(sep).join('/'), size: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  walk(root);
  return { count: rows.length, sha256: sha256(JSON.stringify(rows.sort(byPath))) };
}

// Resolve each public entry under Node's actual condition. Each entry itself then issues
// both dependency resolutions; rooting every lookup at the docs manifest would hide private copies.
function resolutionGraph(docs, resolve) {
  const modules = join(docs, 'node_modules');
  const manifest = join(docs, 'package.json');
  function publicEntry(name) {
    const entry = realpathSync(resolve(name, manifest));
    const local = relative(join(modules, name), entry);
    assert(!isAbsolute(local) && local.split(sep)[0] !== '..' && !local.split(sep).includes('node_modules'),
      'external public entry: ' + name);
    assert(lstatSync(entry).isFile(), 'missing public entry file: ' + name);
    return entry;
  }
  const direct = Object.fromEntries(native.map((name) => [name, publicEntry(name)]));
  const result = { docs: direct };
  for (const name of [...sources, 'footprintjs']) {
    const issuer = publicEntry(name);
    result[name] = Object.fromEntries(native.map((dependency) => {
      const entry = realpathSync(resolve(dependency, issuer));
      assert.equal(entry, direct[dependency], name + ': divergent ' + dependency + ' entry');
      return [dependency, entry];
    }));
  }
  return result;
}

export function verifyResolutions(docs) {
  const require = resolutionGraph(docs, (name, issuer) => createRequire(issuer).resolve(name));
  // Node 22 and 24 require this switch for import.meta.resolve(specifier, parentURL).
  const output = execFileSync(process.execPath, ['--experimental-import-meta-resolve', fileURLToPath(import.meta.url),
    '--esm', docs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { require, import: JSON.parse(output) };
}

export function verifyDocsInstall(directory, sourcePins, publishedPins = published) {
  const docs = realpathSync(directory);
  const expected = Object.fromEntries(sources.map((name) => [name, sourceIdentity(docs, name, sourcePins[name])]));
  for (const name of native) {
    const selected = publishedPins[name];
    expected[name] = { ...selected, resolved: 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + selected.version + '.tgz' };
  }
  const ordinary = json(join(docs, 'package-lock.json'));
  const manifest = json(join(docs, 'package.json'));
  for (const [name, selected] of Object.entries(expected)) {
    const locator = sources.includes(name) ? selected.resolved : selected.version;
    assert.equal(manifest.dependencies[name], locator, 'docs dependency: ' + name);
    assert.equal(ordinary.packages[''].dependencies[name], locator, 'docs locked dependency: ' + name);
  }
  verifyLock(ordinary, expected);
  verifyLock(json(join(docs, 'node_modules/.package-lock.json')), expected);
  assertPhysicalOwners(docs, Object.keys(expected));
  const packages = {};
  for (const [name, selected] of Object.entries(expected)) {
    const root = join(docs, 'node_modules', name);
    const members = installedMembers(root);
    assert.equal(members.sha256, selected.membersSha256, 'installed members: ' + name);
    packages[name] = { root, version: selected.version, integrity: selected.integrity, members };
  }
  return { packages, resolutions: verifyResolutions(docs) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--esm') {
    const result = resolutionGraph(process.argv[3], (name, issuer) => fileURLToPath(import.meta.resolve(name, pathToFileURL(issuer))));
    console.log(JSON.stringify(result));
  } else {
    const { DOCS_INPUTS } = await import('./inputs.mjs');
    const source = Object.fromEntries(DOCS_INPUTS.map(({ name, version, tar }) => [name, { version, ...tar }]));
    console.log(JSON.stringify(verifyDocsInstall(join(process.cwd(), 'docs-next'), source), null, 2));
  }
}
