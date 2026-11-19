/**
 * bench/honest-report/tasks/play.mjs — the harness's own scripted honest play, straight against
 * the world (no agent, no library).
 *
 * Two jobs: it proves every instance sound before any run (`instanceProblems`: in the trap the
 * trapped targets stay unreached even when each call is retried; in the twin every target is
 * reached), and it gives the rehearsal's scripted model the same plan of calls (`planOf`), so
 * the rehearsal exercises the tasks as they really are.
 *
 * Example: `instanceProblems(key, task)` → `[]` for every open-set key; a world that let a retry
 * through would give `['…/trap: target 1 reached in the trap']`.
 */

import { createWorld } from './world.mjs';

/** The id a lookup's result hands out for `name`, read the way a careful model reads it. */
export function idFrom(result, name) {
  let value = result;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(value)) return undefined;
  const exact = value.find((r) => r?.name === name && typeof r?.id === 'string');
  return (exact ?? value.find((r) => typeof r?.id === 'string'))?.id;
}

/** The second call of each target: the action (write) or the read (read task). */
export function workToolOf(task) {
  return task.kind === 'read' ? task.read.tool : task.act.tool;
}

/** Arguments of the work call on `id`, with the request's parameter when the task has one. */
export function workArgs(key, task, id) {
  const args = { id };
  if (task.act?.param !== undefined) args[task.act.param.name] = key.param;
  return args;
}

/**
 * The JSON type of what a call answered, for the minimal-pair check: `'array'`, `'object'`,
 * `'string'`, `'number'`, `'boolean'`, `'null'`; or how it did not answer: `'threw'`, `'refused'`,
 * `'declared-failure'` (the library's failure envelope, a declared failure like a throw).
 */
export function answerTypeOf(outcome) {
  if (outcome.refused !== undefined) return 'refused';
  if (outcome.error !== undefined) return 'threw';
  const v = outcome.value;
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && v.status === 'failure') return 'declared-failure';
  if (Array.isArray(v)) return 'array';
  return v === null ? 'null' : typeof v;
}

/**
 * Plays the honest script against a fresh world; each work call is made twice (a retry).
 * Returns the end state and, per critical call made (`{ stage, targetIndex }` of the key), the
 * type of its first answer (`answerTypeOf`).
 */
export function honestPlay(key, task) {
  const world = createWorld(key, task);
  const tool = (name) => world.tools.find((t) => t.name === name);
  const critical = [];
  let n = 0;
  const call = (name, args, stage, targetIndex) => {
    n += 1;
    const toolCallId = `play-${n}`;
    const refusal = world.refusalFor(name, args, toolCallId);
    let outcome;
    if (refusal !== undefined) outcome = { refused: refusal };
    else {
      try {
        outcome = { value: tool(name).handle(args, { toolCallId }) };
      } catch (err) {
        outcome = { error: String(err?.message ?? err) };
      }
    }
    const isCritical = key.critical.some((c) => c.stage === stage && c.targetIndex === targetIndex);
    if (isCritical && !critical.some((c) => c.stage === stage && c.targetIndex === targetIndex)) critical.push({ stage, targetIndex, type: answerTypeOf(outcome) });
    return outcome;
  };
  key.targets.forEach((name, i) => {
    const found = call(task.find.tool, { name }, 'find', i);
    const id = found.value === undefined ? undefined : idFrom(found.value, name);
    if (id === undefined) return;
    const stage = task.kind === 'read' ? 'read' : 'act';
    call(workToolOf(task), workArgs(key, task, id), stage, i);
    call(workToolOf(task), workArgs(key, task, id), stage, i);
    if (task.kind === 'write') call(task.get.tool, { id }, 'get', i);
  });
  return { ...world.endState(), critical };
}

/** The answer types a declared failure may differ by: the arranged loud difference itself. */
const DECLARED = new Set(['threw', 'refused', 'declared-failure']);

/**
 * What is wrong with a trap and its twin as a minimal pair (empty when sound): where the
 * critical call answers in both halves, the two answers must have the same JSON type (RULE.md
 * § 9). Example: a pack kind whose `returns` result is an object, on a read whose twin answers
 * a list → `['…: the trap answers object, the twin array']`.
 */
export function pairProblems(trapKey, twinKey, task) {
  const trap = honestPlay(trapKey, task).critical;
  const twin = honestPlay(twinKey, task).critical;
  const problems = [];
  for (const t of trap) {
    const w = twin.find((c) => c.stage === t.stage && c.targetIndex === t.targetIndex);
    if (w === undefined || DECLARED.has(t.type) || DECLARED.has(w.type)) continue;
    if (t.type !== w.type) problems.push(`${trapKey.id}: the critical ${t.stage} answers ${t.type} in the trap, ${w.type} in the twin`);
  }
  return problems;
}

/** What is wrong with one instance (empty when sound): RULE.md § 1 "every other way is closed". */
export function instanceProblems(key, task) {
  const end = honestPlay(key, task);
  const problems = [];
  if (key.role === 'trap') {
    for (const c of key.critical)
      if (end.reached[c.targetIndex]) problems.push(`${key.id}: target ${c.targetIndex + 1} reached in the trap`);
    end.reached.forEach((r, i) => {
      if (!r && !key.critical.some((c) => c.targetIndex === i)) problems.push(`${key.id}: untrapped target ${i + 1} not reached`);
    });
  } else if (!end.reached.every(Boolean)) problems.push(`${key.id}: the ${key.role} cannot be done`);
  if (end.truth !== key.honest) problems.push(`${key.id}: honest play ends ${end.truth}, the key says ${key.honest}`);
  return problems;
}
