/** Fixed PR 6 cells. No case texts or paid replies belong in the repository. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const REGISTRATION = 'negative-full-path/1';
export const SEED = 'negative-full-path/2026-10-23/1';
export const MODELS = Object.freeze({
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
});
export const RATER_MODEL = 'claude-haiku-5-5';
export const digest = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export const rowId = (row) => digest([row.model, row.cell, row.arm, row.caseId, row.rep]);

export function privatePath(path) {
  const target = resolve(path);
  let parent = target;
  // Resolve existing ancestors too, so a symlink cannot send a private output into Git.
  for (;;) {
    try {
      parent = realpathSync(parent);
      break;
    } catch {
      const next = resolve(parent, '..');
      if (next === parent) throw new Error('Unresolvable output parent.');
      parent = next;
    }
  }
  const rel = relative(realpathSync(ROOT), parent);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)))
    throw new Error('Private benchmark data/output must be outside the repository.');
  return target;
}

export function buildPlan(cases) {
  if (cases.length !== 24 || new Set(cases.map((c) => c.id)).size !== 24)
    throw new Error('Exactly 24 distinct fresh cases are registered.');
  const sonnet = cases.filter((c) => c.sonnet);
  const long = cases.filter((c) => c.longContext);
  const near = cases.filter((c) => c.near);
  if (sonnet.length !== 12 || long.length !== 8 || near.length !== 6)
    throw new Error('The registered subsets are Sonnet 12, long-context 8, near-match 6.');
  const plan = [];
  const add = (subset, family, cell, arm, repeats) => {
    for (const c of subset)
      for (let rep = 0; rep < repeats; rep++)
        plan.push({ caseId: c.id, model: MODELS[family], family, cell, arm, rep });
  };
  for (const arm of ['observe', 'enforce']) {
    add(cases, 'haiku', 'main', arm, 10);
    add(sonnet, 'sonnet', 'main', arm, 6);
  }
  add(long, 'haiku', 'long', 'enforce', 5);
  for (const arm of ['near-count', 'near-list']) add(near, 'haiku', 'near', arm, 10);
  return plan
    .map((row) => ({ ...row, id: rowId(row) }))
    .sort((a, b) => digest([SEED, a.id]).localeCompare(digest([SEED, b.id])));
}

export function codeHashes() {
  const paths = ['bench/negative/full', 'src', 'dist/esm', 'node_modules/footprintjs/dist/esm'];
  const files = ['package.json', 'package-lock.json', 'node_modules/footprintjs/package.json'];
  const walk = (path) => {
    for (const ent of readdirSync(join(ROOT, path), { withFileTypes: true })) {
      const child = `${path}/${ent.name}`;
      if (ent.isDirectory()) walk(child);
      else if (/\.(mjs|js|ts|md)$/.test(ent.name)) files.push(child);
    }
  };
  paths.forEach(walk);
  return Object.fromEntries(
    files.sort().map((path) => [path, digest(readFileSync(join(ROOT, path), 'utf8'))]),
  );
}

/** A disclosed processing amendment cannot change evidence, prompts, models or scoring. */
export function validateFrozen(manifest, bankBytes, currentHashes, amendment) {
  if (manifest.bankSha256 !== digest(bankBytes)) throw new Error('Frozen bank changed.');
  if (!amendment && digest(manifest.codeHashes) === digest(currentHashes)) return 1_000_000;
  const permitted = new Set([
    'bench/negative/full/plan.mjs',
    'bench/negative/full/run.mjs',
    'bench/negative/full/rate.mjs',
  ]);
  const paths = new Set([...Object.keys(manifest.codeHashes), ...Object.keys(currentHashes)]);
  const changed = [...paths].filter((path) => manifest.codeHashes[path] !== currentHashes[path]);
  if (
    amendment?.kind !== 'unsent-attempts-and-reserve/1' ||
    amendment.originalRegistrationSha256 !== digest(manifest) ||
    digest(amendment.codeHashes) !== digest(currentHashes) ||
    amendment.agentReserveMicro !== 750_000 ||
    amendment.budgetUsd !== 4.3 ||
    typeof amendment.reason !== 'string' ||
    !amendment.reason.trim() ||
    !changed.length ||
    changed.some((path) => !permitted.has(path))
  )
    throw new Error('Frozen implementation changed without the exact processing amendment.');
  return amendment.agentReserveMicro;
}

export function registeredReserve(manifest, bankBytes, out) {
  const path = privatePath(join(out, 'processing-amendment.json'));
  const amendment = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  return validateFrozen(manifest, bankBytes, codeHashes(), amendment);
}

export function makeManifest(cases, provenance, bankBytes) {
  const plan = buildPlan(cases);
  return {
    registration: REGISTRATION,
    concurrency: 3,
    seed: SEED,
    budgetUsd: 4.3,
    models: MODELS,
    raterModel: RATER_MODEL,
    raterSessions: ['A', 'B'],
    raterLimitation:
      'Two isolated sessions of the same Anthropic model; not independent human truth.',
    bankSha256: digest(bankBytes),
    provenance,
    codeHashes: codeHashes(),
    schedule: plan,
    frozenAt: new Date().toISOString(),
  };
}
