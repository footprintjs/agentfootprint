/**
 * bench/honest-report/tasks/sets.mjs — the two kinds of instance set: the open set (this
 * repository's base tasks and seed) and a task pack from outside the repository (RULE.md § 9).
 *
 * A pack is a folder holding `pack.json` — data only, never code, so loading a closed set runs
 * nothing its author wrote:
 *   { "name": "closed-1",
 *     "baseTasks": [ …the shape of base-tasks.mjs… ],
 *     "trapKinds": [ …the shape of trap-kinds.mjs · TRAP_BEHAVIOUR… ],   (optional)
 *     "traps": { "<base task id>": ["<trap kind id>", …] } }
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

import { TRAP_ASSIGNMENT } from '../rule-tables.mjs';
import { BASE_TASKS } from './base-tasks.mjs';
import { generateInstances } from './instances.mjs';
import { instanceProblems } from './play.mjs';
import { TRAP_BEHAVIOUR, trapKindProblems } from './trap-kinds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OPEN_SEED_FILE = join(HERE, '..', 'open-set', 'seed.json');
export const OPEN_KEYS_FILE = join(HERE, '..', 'open-set', 'keys.json');

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

/** The instances of a set, refused when any instance is unsound. */
function proven(set, instances, baseTasks) {
  const byId = new Map(baseTasks.map((t) => [t.id, t]));
  const problems = instances.flatMap((k) => instanceProblems(k, byId.get(k.baseTask)));
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
    const digest = createHash('sha256').update(seedBytes).digest('hex').slice(0, 16);
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
  ];
  if (!Array.isArray(spec.baseTasks) || spec.baseTasks.length === 0) problems.push('a pack needs baseTasks');
  if (problems.length > 0) throw new Error(`pack is not sound:\n  ${problems.join('\n  ')}`);
  const digest = createHash('sha256').update(packBytes).update(seedBytes).digest('hex').slice(0, 16);
  const instances = generateInstances({ set: spec.name, seed, baseTasks: spec.baseTasks, traps: spec.traps ?? {}, kinds });
  return { set: spec.name, seed, digest, baseTasks: spec.baseTasks, kinds, instances: proven(spec.name, instances, spec.baseTasks) };
}
