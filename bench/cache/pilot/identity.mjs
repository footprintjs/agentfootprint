/** Verify the complete installed fixture before importing either arm or the SDK. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { scenarios, systemText, observation } from './fixture.mjs';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const KIT_FILES = Object.freeze(
  [
    'arms.mjs',
    'budget.mjs',
    'usageEvidence.mjs',
    'fixture.mjs',
    'identity.mjs',
    'inspect.mjs',
    'journal.mjs',
    'live.mjs',
    'run.mjs',
  ]
    .map((f) => `bench/cache/pilot/${f}`)
    .concat([
      'bench/cache/verify-fixture.mjs',
      'dist/lib/boundedJson.js',
      'src/lib/boundedJson.ts',
    ]),
);
export function kitHashes(root) {
  return Object.fromEntries(KIT_FILES.map((f) => [f, sha256(readFileSync(resolve(root, f)))]));
}
export function payloadHash(order) {
  return sha256(
    JSON.stringify(
      order.map((entry) => {
        const scenario = scenarios.find((s) => s.id === entry.scenario);
        if (!scenario) throw new Error('pilot scenario refused');
        return {
          entry,
          scenario,
          system: systemText(entry.partition),
          observations: Array.from({ length: scenario.reads }, (_, i) =>
            observation(scenario, i + 1),
          ),
        };
      }),
    ),
  );
}
export function verifyKit(root, manifest) {
  if (
    !manifest.kit ||
    JSON.stringify(Object.keys(manifest.kit).sort()) !== JSON.stringify([...KIT_FILES].sort())
  )
    throw new Error('pilot kit was not frozen');
  for (const [file, expected] of Object.entries(manifest.kit)) {
    const path = realpathSync(resolve(root, file));
    if (!path.startsWith(realpathSync(root) + sep) || sha256(readFileSync(path)) !== expected)
      throw new Error('pilot kit differs from reviewed manifest');
  }
  if (payloadHash(manifest.order) !== manifest.payloadSha256)
    throw new Error('pilot payload differs');
}
export function closureHash(directory) {
  const root = realpathSync(directory),
    rows = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name),
        key = relative(root, path).split(sep).join('/');
      if (key === '.package-lock.json') continue; // npm's local install receipt is not executable package content.
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!target.startsWith(root + sep))
          throw new Error('pilot dependency symlink escapes fixture');
        rows.push([key, 'link', readlinkSync(path)]);
      } else if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && stat.size <= 16_777_216)
        rows.push([key, 'file', sha256(readFileSync(path))]);
      else throw new Error('pilot dependency entry refused');
      if (rows.length > 30_000) throw new Error('pilot dependency file cap');
    }
  }
  walk(root);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(JSON.stringify(rows));
}
export function verifyConsumer(directory, manifest) {
  const root = resolve(directory, 'node_modules');
  if (closureHash(root) !== manifest.consumerClosureSha256)
    throw new Error('pilot fixture closure differs from reviewed manifest');
  for (const [file, expected] of Object.entries(manifest.phaseAPolicy)) {
    for (const arm of ['af-baseline', 'af-candidate'])
      if (sha256(readFileSync(join(root, arm, file))) !== expected)
        throw new Error('pilot Phase A policy differs');
  }
  return root;
}
/** Run only after closure admission. Never resolve bare names from the unhashed
 * consumer root: its package name/exports can override even a sealed install. */
export function pinnedModule(directory, name, subpath = '.') {
  if (!['af-baseline', 'af-candidate', '@anthropic-ai/sdk'].includes(name))
    throw new Error('pilot module refused');
  const root = realpathSync(join(directory, 'node_modules'));
  const packageRoot = realpathSync(join(root, name));
  if (!packageRoot.startsWith(root + sep)) throw new Error('pilot module escapes fixture');
  const packageFile = join(packageRoot, 'package.json');
  const metadata = JSON.parse(readFileSync(packageFile, 'utf8'));
  const entry = metadata.exports?.[subpath]?.require?.default;
  if (typeof entry !== 'string' || !entry.startsWith('./'))
    throw new Error('pilot public require entry missing');
  const path = realpathSync(resolve(packageRoot, entry));
  if (!path.startsWith(packageRoot + sep)) throw new Error('pilot entry escapes package');
  return createRequire(packageFile)(path);
}
