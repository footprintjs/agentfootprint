/**
 * bench/honest-report/tasks/sets.mjs — the two kinds of instance set: the open set (this
 * repository's base tasks and seed) and a task pack from outside the repository (RULE.md § 9).
 *
 * A pack is a folder holding `pack.json` — data only, never code, so loading a closed set runs
 * nothing its author wrote:
 *   { "name": "closed-1",
 *     "baseTasks": [ …the shape of base-tasks.mjs… ],
 *     "trapKinds": [ …the shape of trap-kinds.mjs · TRAP_BEHAVIOUR… ],   (optional)
 *     "wordings": { "throws": ["…"], "failure": ["…"], … },              (optional: its own pools)
 *     "traps": { "<base task id>": ["<trap kind id>", …] } }
 * with at least `MIN_CLOSED_BASE_TASKS` base tasks (RULE.md § 2).
 * and its seed comes from a separate file, `{ "seed": <integer> }`, so the pack can be handed
 * over before the seed is chosen. Every instance is proved sound (`play.mjs` ·
 * `instanceProblems`) before a run may start.
 *
 * Example: `loadSet({ pack: '/elsewhere/closed', seedFile: '/elsewhere/seed.json' })` → the
 * pack's instances, its digest and `set: 'closed-1'`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_CLOSED_BASE_TASKS, TRAP_ASSIGNMENT } from '../rule-tables.mjs';
import { BASE_TASKS } from './base-tasks.mjs';
import { generateInstances } from './instances.mjs';
import { instanceProblems, pairProblems } from './play.mjs';
import { TRAP_BEHAVIOUR, trapKindProblems } from './trap-kinds.mjs';
import { POOLS } from './wordings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OPEN_SEED_FILE = join(HERE, '..', 'open-set', 'seed.json');
export const OPEN_KEYS_FILE = join(HERE, '..', 'open-set', 'keys.json');

/**
 * The generator's own files: their bytes go into every set's digest (RULE.md § 9), so a run
 * folder made with another generator is refused instead of scored against a moved ruler.
 */
export const GENERATOR_FILES = Object.freeze(['base-tasks.mjs', 'trap-kinds.mjs', 'wordings.mjs', 'instances.mjs', 'world.mjs', 'play.mjs'].map((f) => join(HERE, f)));

function digestOf(...parts) {
  const h = createHash('sha256');
  for (const f of GENERATOR_FILES) h.update(readFileSync(f));
  for (const p of parts) h.update(p);
  return h.digest('hex').slice(0, 16);
}

/** What is wrong with a pack's own failure-sentence pools (empty when sound). */
export function wordingProblems(wordings) {
  if (wordings === undefined) return [];
  if (wordings === null || typeof wordings !== 'object' || Array.isArray(wordings)) return ['wordings must be an object of pools'];
  return Object.entries(wordings).flatMap(([k, pool]) => {
    if (!(k in POOLS)) return [`wordings.${k}: not a pool (one of ${Object.keys(POOLS).join(', ')})`];
    if (!Array.isArray(pool) || pool.length === 0 || pool.some((t) => typeof t !== 'string' || t.trim() === '')) return [`wordings.${k}: a non-empty list of sentences`];
    return [];
  });
}

/** The open set's trap table, as `generateInstances` takes it. */
export function openTraps() {
  return Object.fromEntries(Object.entries(TRAP_ASSIGNMENT).map(([id, row]) => [id, [...row.loud, ...row.silent]]));
}

/** What is wrong with a pack's base task (empty when sound). */
export function baseTaskProblems(task) {
  const p = [];
  const need = (cond, what) => {
    if (!cond) p.push(`base task ${task?.id}: ${what}`);
  };
  need(typeof task?.id === 'string' && /^[a-z][a-z0-9-]*$/.test(task.id), 'id must be [a-z0-9-]');
  need(task?.kind === 'write' || task?.kind === 'read', 'kind must be write or read');
  need(Array.isArray(task?.names) && task.names.length >= 8 && new Set(task.names).size === task.names.length, 'names: at least 8 distinct');
  need(typeof task?.nearSuffix === 'string' && task.nearSuffix.length > 0, 'nearSuffix is required');
  need(typeof task?.find?.tool === 'string' && typeof task?.find?.description === 'string', 'find { tool, description }');
  need(typeof task?.request?.one === 'string' && typeof task?.request?.many === 'string', 'request { one, many }');
  if (task?.kind === 'write') {
    need(typeof task?.act?.tool === 'string' && typeof task?.act?.field === 'string', 'act { tool, field }');
    need(task?.act?.param !== undefined || ['increment', 'true'].includes(task?.act?.next) || typeof task?.act?.next === 'string', 'act.next or act.param');
    need(typeof task?.get?.tool === 'string', 'get { tool }');
  }
  if (task?.kind === 'read') need(typeof task?.read?.tool === 'string' && Array.isArray(task?.read?.values), 'read { tool, values }');
  return p;
}

/** The instances of a set, refused when any instance or any trap-and-twin pair is unsound. */
function proven(set, instances, baseTasks) {
  const byId = new Map(baseTasks.map((t) => [t.id, t]));
  const twinOf = new Map(instances.filter((k) => k.role === 'twin').map((k) => [k.pairId, k]));
  const problems = [
    ...instances.flatMap((k) => instanceProblems(k, byId.get(k.baseTask))),
    ...instances.filter((k) => k.role === 'trap').flatMap((k) => (twinOf.has(k.pairId) ? pairProblems(k, twinOf.get(k.pairId), byId.get(k.baseTask)) : [`${k.id}: no twin`])),
  ];
  if (problems.length > 0) throw new Error(`set ${set} is not sound:\n  ${problems.slice(0, 20).join('\n  ')}`);
  return instances;
}

/**
 * The set to run: the open set, or a pack with its seed file.
 * @returns {{ set: string, seed: number, digest: string, baseTasks: object[], kinds: object[], instances: object[] }}
 */
export function loadSet({ pack, seedFile } = {}) {
  if (pack === undefined) {
    const seedBytes = readFileSync(OPEN_SEED_FILE);
    const { seed } = JSON.parse(seedBytes.toString('utf8'));
    const instances = generateInstances({ set: 'open', seed, baseTasks: BASE_TASKS, traps: openTraps(), kinds: TRAP_BEHAVIOUR });
    const digest = digestOf(seedBytes);
    return { set: 'open', seed, digest, baseTasks: BASE_TASKS, kinds: TRAP_BEHAVIOUR, instances: proven('open', instances, BASE_TASKS) };
  }
  if (seedFile === undefined) throw new Error('--pack needs --seed-file: the pack and its seed travel apart');
  const packBytes = readFileSync(join(pack, 'pack.json'));
  const seedBytes = readFileSync(seedFile);
  const spec = JSON.parse(packBytes.toString('utf8'));
  const { seed } = JSON.parse(seedBytes.toString('utf8'));
  if (!Number.isInteger(seed)) throw new Error('the seed file must hold { "seed": <integer> }');
  const kinds = [...TRAP_BEHAVIOUR, ...(spec.trapKinds ?? [])];
  const problems = [
    ...(typeof spec.name === 'string' && /^[a-z][a-z0-9-]*$/.test(spec.name) && spec.name !== 'open' ? [] : ['pack name must be [a-z0-9-] and not "open"']),
    ...(spec.baseTasks ?? []).flatMap(baseTaskProblems),
    ...(spec.trapKinds ?? []).flatMap(trapKindProblems),
    ...(spec.trapKinds ?? []).filter((k) => TRAP_BEHAVIOUR.some((o) => o.id === k.id)).map((k) => `trap kind ${k.id} already exists`),
    ...wordingProblems(spec.wordings),
  ];
  if (!Array.isArray(spec.baseTasks) || spec.baseTasks.length < MIN_CLOSED_BASE_TASKS) problems.push(`a pack needs at least ${MIN_CLOSED_BASE_TASKS} base tasks (RULE.md § 2), saw ${Array.isArray(spec.baseTasks) ? spec.baseTasks.length : 0}`);
  if (problems.length > 0) throw new Error(`pack is not sound:\n  ${problems.join('\n  ')}`);
  const digest = digestOf(packBytes, seedBytes);
  const instances = generateInstances({ set: spec.name, seed, baseTasks: spec.baseTasks, traps: spec.traps ?? {}, kinds, pools: { ...POOLS, ...(spec.wordings ?? {}) } });
  return { set: spec.name, seed, digest, baseTasks: spec.baseTasks, kinds, instances: proven(spec.name, instances, spec.baseTasks) };
}
