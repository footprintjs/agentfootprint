/** Exercise the registry dependency through clean source and packed consumers. Run after build. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'agentfootprint-context-package-')));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const environment = { ...process.env, NODE_PATH: '' };
const execute = (command, args, cwd = root) =>
  execFileSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
const installOptions = [
  '--ignore-scripts',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-fund',
  '--registry',
  'https://registry.npmjs.org',
];

try {
  const packageText = await readFile(join(root, 'package.json'), 'utf8');
  const lockText = await readFile(join(root, 'package-lock.json'), 'utf8');
  const metadata = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  const bundled = metadata.bundleDependencies ?? metadata.bundledDependencies ?? [];
  assert.ok(
    bundled !== true && !bundled.includes('contextfootprint'),
    'ContextFootprint must be an ordinary registry dependency, not bundled.',
  );
  assert.match(
    metadata.dependencies?.contextfootprint ?? '',
    /^\d+\.\d+\.\d+$/,
    'The published manifest needs an exact version.',
  );
  assert.equal(
    lock.packages?.['']?.dependencies?.contextfootprint,
    metadata.dependencies.contextfootprint,
    'The source lock must match the manifest dependency.',
  );
  const lockedContext = lock.packages?.['node_modules/contextfootprint'];
  assert.equal(lockedContext?.version, metadata.dependencies.contextfootprint);
  assert.equal(
    lockedContext.resolved,
    `https://registry.npmjs.org/contextfootprint/-/contextfootprint-${metadata.dependencies.contextfootprint}.tgz`,
    'Source installs must resolve the published registry package.',
  );
  assert.match(
    lockedContext.integrity ?? '',
    /^sha512-[A-Za-z0-9+/]+={0,2}$/,
    'The tracked archive must retain its SHA-512 integrity.',
  );
  const checkInstalled = async (directory) => {
    const installedLock = JSON.parse(
      await readFile(join(directory, 'node_modules', '.package-lock.json'), 'utf8'),
    );
    const entries = Object.entries(installedLock.packages).filter(([path]) =>
      /(?:^|\/)node_modules\/contextfootprint$/.test(path),
    );
    assert.equal(
      entries.length,
      1,
      'The isolated install must resolve one ContextFootprint package.',
    );
    const [path, record] = entries[0];
    assert.equal(record.version, lockedContext.version);
    assert.equal(
      record.integrity,
      lockedContext.integrity,
      'Installed registry bytes must match the reviewed release.',
    );
    assert.equal(record.resolved, lockedContext.resolved);
    const installed = JSON.parse(await readFile(join(directory, path, 'package.json'), 'utf8'));
    assert.equal(installed.version, lockedContext.version);
  };

  // Source installs use their tracked integrity. Online starts with an empty
  // cache; offline reuses only that populated cache in a different clean tree.
  for (const offline of [false, true]) {
    const source = join(temporary, `source-${offline ? 'offline' : 'online'}`);
    await mkdir(source);
    await writeFile(join(source, 'package.json'), packageText);
    await writeFile(join(source, 'package-lock.json'), lockText);
    execute(
      npm,
      [
        'ci',
        '--omit=dev',
        ...installOptions,
        ...(offline ? ['--offline'] : []),
        '--cache',
        join(temporary, 'source-cache'),
      ],
      source,
    );
    await checkInstalled(source);
    execute(
      process.execPath,
      [
        '--input-type=commonjs',
        '-e',
        "const c=require('contextfootprint'); if(c.participates(0)!==true)throw Error('source dependency did not load');",
      ],
      source,
    );
  }

  const [packed] = JSON.parse(
    execute(npm, [
      'pack',
      '--offline',
      '--ignore-scripts',
      '--json',
      '--cache',
      join(temporary, 'pack-cache'),
      '--pack-destination',
      temporary,
    ]),
  );
  assert.ok(
    !packed.files.some((file) => /(?:^|\/)node_modules\/contextfootprint(?:\/|$)/.test(file.path)),
    'The Agent archive must not bundle the registry dependency.',
  );
  const archive = join(temporary, packed.filename);
  // Consumers generate their own locks from Agent's exact version dependency;
  // the Agent source lock is a verification oracle, not shipped consumer policy.
  for (const offline of [false, true]) {
    const consumer = join(temporary, `consumer-${offline ? 'offline' : 'online'}`);
    await mkdir(consumer);
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 'context-package-smoke', private: true, type: 'module' }),
    );
    execute(
      npm,
      [
        'install',
        ...installOptions,
        ...(offline ? ['--offline'] : []),
        '--cache',
        join(temporary, 'consumer-cache'),
        archive,
      ],
      consumer,
    );
    await checkInstalled(consumer);

    const agent = join(consumer, 'node_modules', 'agentfootprint');
    const installedAgent = JSON.parse(await readFile(join(agent, 'package.json'), 'utf8'));
    assert.equal(
      installedAgent.dependencies.contextfootprint,
      metadata.dependencies.contextfootprint,
    );
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
const own = assertion(JSON.parse('{"__proto__":{"observed":true},"total":4}'));
const omitted = assertion({total:4});
assert.equal(comparison.conflictsOf([own, omitted]).length, 1,
  'The packed dependency must preserve own JSON property names.');
`;
    await writeFile(
      join(agent, '.context-smoke.cjs'),
      `
const assert = require('node:assert/strict');
const comparison = require('./dist/integrity/assertion/conflicts.js');
const helpers = require('./dist/integrity/assertion/types.js');
const shared = require('contextfootprint');
const resolved = require.resolve('contextfootprint');
assert.ok(resolved.startsWith(${JSON.stringify(join(consumer, 'node_modules') + sep)}),
  'The consumer must use its installed dependency, not the author workspace.');
${verification}
`,
    );
    await writeFile(
      join(agent, '.context-smoke.mjs'),
      `
import assert from 'node:assert/strict';
import * as comparison from './dist/esm/integrity/assertion/conflicts.js';
import * as helpers from './dist/esm/integrity/assertion/types.js';
import * as shared from 'contextfootprint';
${verification}
`,
    );
    execute(process.execPath, [join(agent, '.context-smoke.cjs')], consumer);
    execute(process.execPath, [join(agent, '.context-smoke.mjs')], consumer);

    // Compile against installed declarations using both conditional-export modes.
    // The compiler is a development tool; all imported declarations resolve in the clean consumer.
    for (const [extension, declarationPath] of [
      ['mts', 'esm'],
      ['cts', 'types'],
    ]) {
      await writeFile(
        join(agent, `.context-types.${extension}`),
        `
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
`,
      );
    }
    execute(
      process.execPath,
      [
        join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '.context-types.mts',
        '.context-types.cts',
      ],
      agent,
    );
  }
  console.log(
    'Clean source and packed consumers install the exact registry dependency online and from cache offline; integrity, CJS, ESM, legacy keys, shared helpers, own JSON fields and both declaration modes pass.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
