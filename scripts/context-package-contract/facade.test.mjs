/** Isolated Node imports/refusals only; never run the registry CLI's default route. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const facadeURL = new URL('../context-package-contract.mjs', import.meta.url).href;
const cliURL = new URL('../check-context-package.mjs', import.meta.url).href;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TMP|TEMP|TMPDIR)$/i.test(key),
  ),
);

const isolatedPrelude = `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const effects = [];
const stop = (name) => (...args) => { effects.push(name); throw new Error('Unexpected effect: ' + name); };
const mutationNames = ['appendFile', 'chmod', 'chown', 'copyFile', 'cp', 'link', 'mkdir', 'mkdtemp', 'rename', 'rm', 'rmdir', 'symlink', 'truncate', 'unlink', 'utimes', 'writeFile'];
for (const name of mutationNames) {
  if (typeof fs[name] === 'function') fs[name] = stop('fs.' + name);
  if (typeof fs[name + 'Sync'] === 'function') fs[name + 'Sync'] = stop('fs.' + name + 'Sync');
  if (typeof promises[name] === 'function') promises[name] = stop('promises.' + name);
}
// ESM's loader uses readFileSync -> openSync. Permit reads, but trap creation/write flags.
for (const [owner, name, label] of [[fs, 'open', 'fs.open'], [fs, 'openSync', 'fs.openSync'], [promises, 'open', 'promises.open']]) {
  const original = owner[name];
  owner[name] = (...args) => {
    const flags = args[1];
    const writing = typeof flags === 'number'
      ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0
      : flags !== undefined && !['r', 'rs', 'sr'].includes(flags);
    if (writing) return stop(label)(...args);
    return Reflect.apply(original, owner, args);
  };
}
for (const name of ['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync']) childProcess[name] = stop('child_process.' + name);
syncBuiltinESMExports();
`;

function isolated(body) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', isolatedPrelude + body],
    {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(result.error, undefined, 'isolated import/refusal process must finish');
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'isolated-check-ok');
}

test('fixed facade imports without setup or child execution and exposes only the four public entries', () => {
  isolated(`
const api = await import(${JSON.stringify(facadeURL)});
assert.deepEqual(Object.keys(api).sort(), ['CONTEXT_PACKAGE_CONTRACT_PROTOCOL', 'runPairedContextPackageContract', 'runRegistryContextPackageContract', 'runStrictContextPackageContract'].sort());
assert.equal(api.CONTEXT_PACKAGE_CONTRACT_PROTOCOL, 'agentfootprint.context-package-contract.v1');
assert.equal(typeof api.runPairedContextPackageContract, 'function');
assert.equal(typeof api.runRegistryContextPackageContract, 'function');
assert.equal(typeof api.runStrictContextPackageContract, 'function');
assert.deepEqual(effects, []);
console.log('isolated-check-ok');
`);
});

test('strict native entry refuses extra commands, invalid heads and source-local evidence before effects', () => {
  isolated(`
const api = await import(${JSON.stringify(facadeURL)});
for (const argv of [
  ['node', 'strict-cli'],
  ['node', 'strict-cli', '/unit-evidence', 'a'.repeat(40), '--mode=registry-control'],
  ['node', 'strict-cli', '/unit-evidence', '--command=install'],
  ['node', 'strict-cli', ${JSON.stringify(root)}, 'a'.repeat(40)],
]) await assert.rejects(api.runStrictContextPackageContract(argv));
assert.deepEqual(effects, []);
console.log('isolated-check-ok');
`);
});

test('public paired input refuses command, pack and mode injection before calling ports or doing setup', () => {
  isolated(`
const api = await import(${JSON.stringify(facadeURL)});
let calls = 0;
const refs = Object.fromEntries(['source', 'install', 'inputs', 'graph', 'build'].map(id => [id, {id, sha256: 'a'.repeat(64)}]));
const input = {
  sourceRoot: ${JSON.stringify(root)}, ownedWorkRoot: '/unit-refused-before-filesystem',
  source: {head: 'b'.repeat(40), tree: 'c'.repeat(40), manifestSha256: 'd'.repeat(64), lockSha256: 'e'.repeat(64)},
  producerProofRefs: refs,
  installSourceRoot: () => { calls++; throw new Error('must not call install'); },
  installPackedConsumer: () => { calls++; throw new Error('must not call install'); },
  verifySource: () => { calls++; throw new Error('must not call verify'); },
};
for (const extra of [{execute() {}}, {pack() {}}, {mode: 'registry-control'}]) {
  await assert.rejects(api.runPairedContextPackageContract({...input, ...extra}), TypeError);
}
await assert.rejects(api.runPairedContextPackageContract(null), TypeError);
assert.equal(calls, 0);
assert.deepEqual(effects, []);
console.log('isolated-check-ok');
`);
});

for (const argument of ['--paired', '--help', '--command=install']) {
  test(`registry wrapper refuses ${argument} before starting its default route`, () => {
    isolated(`
process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(cliURL))}, ${JSON.stringify(
      argument,
    )}];
await assert.rejects(import(${JSON.stringify(cliURL)}), /argument|usage|option/i);
assert.deepEqual(effects, []);
console.log('isolated-check-ok');
`);
  });
}
