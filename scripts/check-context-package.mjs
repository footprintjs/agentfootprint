/** Exercise the packed Agent dependency from a clean, offline consumer. Run after build. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'agentfootprint-context-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const environment = { ...process.env, NODE_PATH: '' };
const execute = (command, args, cwd = root) => execFileSync(command, args, {
  cwd, env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});

try {
  const packageText = await readFile(join(root, 'package.json'), 'utf8');
  const lockText = await readFile(join(root, 'package-lock.json'), 'utf8');
  const metadata = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  const bundled = metadata.bundleDependencies ?? metadata.bundledDependencies ?? [];
  assert.ok(bundled.includes('contextfootprint'), 'Agent must bundle its private ContextFootprint dependency.');
  assert.equal(metadata.dependencies?.contextfootprint, '0.1.0', 'The published manifest needs an exact version.');
  assert.equal(lock.packages?.['']?.dependencies?.contextfootprint, metadata.dependencies.contextfootprint,
    'The source lock must match the manifest dependency.');
  const lockedContext = lock.packages?.['node_modules/contextfootprint'];
  assert.equal(lockedContext?.version, metadata.dependencies.contextfootprint);
  assert.match(lockedContext.resolved ?? '', /^file:vendor\/contextfootprint\/[^/]+\.tgz$/,
    'Source installs must resolve the reviewed local archive through the tracked lock.');
  assert.match(lockedContext.integrity ?? '', /^sha512-[A-Za-z0-9+/]+={0,2}$/,
    'The tracked archive must retain its SHA-512 integrity.');
  const vendored = await readFile(join(root, lockedContext.resolved.slice('file:'.length)));
  assert.equal(lockedContext.integrity, `sha512-${createHash('sha512').update(vendored).digest('base64')}`,
    'The checked-in archive must match the locked integrity.');

  // An exact version is valid package metadata; the source lock must still let
  // an isolated checkout install the private dependency without a registry.
  const source = join(temporary, 'source-checkout');
  await mkdir(source);
  await writeFile(join(source, 'package.json'), packageText);
  await writeFile(join(source, 'package-lock.json'), lockText);
  await cp(join(root, 'vendor'), join(source, 'vendor'), { recursive: true });
  execute(npm, ['ci', '--offline', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund',
    '--cache', join(temporary, 'source-empty-cache')], source);
  const installedSource = JSON.parse(await readFile(join(source, 'node_modules', 'contextfootprint', 'package.json'), 'utf8'));
  assert.equal(installedSource.version, metadata.dependencies.contextfootprint);
  execute(process.execPath, ['--input-type=commonjs', '-e',
    "const c=require('contextfootprint'); if(c.participates(0)!==true)throw Error('source dependency did not load');"], source);

  const [packed] = JSON.parse(execute(npm, ['pack', '--offline', '--ignore-scripts', '--json',
    '--cache', join(temporary, 'pack-cache'), '--pack-destination', temporary]));
  assert.ok(packed.files.some(file => file.path === 'node_modules/contextfootprint/package.json'),
    'The Agent archive must contain ContextFootprint; its private version cannot require a registry install.');
  const archive = join(temporary, packed.filename);
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'context-package-smoke', private: true, type: 'module' }));
  execute(npm, ['install', '--offline', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund',
    '--package-lock=false', '--cache', join(temporary, 'empty-cache'), archive], consumer);

  const agent = join(consumer, 'node_modules', 'agentfootprint');
  const verification = `
const assertion = (value, extra = {}) => ({ subject: { kind: 'entity', id: 'node/11' }, predicate: 'latency',
  value, epoch: 2, stratum: 'asserted', provenance: 'packed evidence', runtimeStageId: 'run/stage', ...extra });
const first = assertion({ kind: 'known', value: false }), second = assertion(true);
const facts = [assertion(9, { stratum: 'quoted' }), assertion({ kind: 'unknown', reason: 'not collected' }), first, second];
const legacyKey = 'entity\\u0000node/11\\u0000latency\\u00002';
const result = comparison.conflictsOf(facts);
assert.equal(result.length, 1);
assert.equal(result[0].key, legacyKey);
assert.equal(result[0].assertions[0], first);
assert.equal(result[0].assertions[1], second);
assert.equal(result[0].assertions[0].runtimeStageId, 'run/stage');
assert.equal(helpers.assertionKey(first), legacyKey);
assert.deepEqual(result, shared.conflictsOf(facts, undefined, helpers.assertionKey));
assert.equal(helpers.participates, shared.participates);
assert.equal(helpers.comparableValueOf, shared.comparableValueOf);
assert.equal(helpers.sameSubject, shared.sameSubject);
assert.notEqual(shared.assertionKey(first), legacyKey);
assert.deepEqual(comparison.conflictsOf(facts, new Set(['latency'])), []);
assert.equal('createEvidenceContext' in shared, false);
`;
  await writeFile(join(agent, '.context-smoke.cjs'), `
const assert = require('node:assert/strict');
const comparison = require('./dist/integrity/assertion/conflicts.js');
const helpers = require('./dist/integrity/assertion/types.js');
const shared = require('contextfootprint');
const resolved = require.resolve('contextfootprint');
assert.ok(resolved.startsWith(__dirname + require('node:path').sep + 'node_modules' + require('node:path').sep),
  'The consumer must use the bundled dependency, not the author workspace.');
${verification}
`);
  await writeFile(join(agent, '.context-smoke.mjs'), `
import assert from 'node:assert/strict';
import * as comparison from './dist/esm/integrity/assertion/conflicts.js';
import * as helpers from './dist/esm/integrity/assertion/types.js';
import * as shared from 'contextfootprint';
${verification}
`);
  execute(process.execPath, [join(agent, '.context-smoke.cjs')], consumer);
  execute(process.execPath, [join(agent, '.context-smoke.mjs')], consumer);

  // Compile against installed declarations using both conditional-export modes.
  // The compiler is a development tool; all imported declarations resolve in the clean consumer.
  for (const [extension, declarationPath] of [['mts', 'esm'], ['cts', 'types']]) {
    await writeFile(join(agent, `.context-types.${extension}`), `
import { conflictsOf } from './dist/${declarationPath}/integrity/assertion/conflicts.js';
import { assertionKey, participates, comparableValueOf } from './dist/${declarationPath}/integrity/assertion/types.js';
import type { Assertion, Conflict } from 'contextfootprint';
const row: Assertion = { subject: { kind: 'entity', id: 'one' }, predicate: 'status', value: false,
  stratum: 'asserted', provenance: 'type smoke' };
const conflicts: readonly Conflict[] = conflictsOf([row]);
const key: string = assertionKey(row);
const known: boolean = participates(row.value);
const value: unknown = comparableValueOf(row.value);
void [conflicts, key, known, value];
`);
  }
  execute(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '.context-types.mts', '.context-types.cts'], agent);
  console.log('Source checkout and packed Agent install ContextFootprint offline; locked integrity, CJS, ESM, legacy keys, shared helpers and both declaration modes pass.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
