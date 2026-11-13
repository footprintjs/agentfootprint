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

/** Plays the honest script against a fresh world; each work call is made twice (a retry). */
export function honestPlay(key, task) {
  const world = createWorld(key, task);
  const tool = (name) => world.tools.find((t) => t.name === name);
  let n = 0;
  const call = (name, args) => {
    n += 1;
    const toolCallId = `play-${n}`;
    const refusal = world.refusalFor(name, args, toolCallId);
    if (refusal !== undefined) return { refused: refusal };
    try {
      return { value: tool(name).handle(args, { toolCallId }) };
    } catch (err) {
      return { error: String(err?.message ?? err) };
    }
  };
  for (const name of key.targets) {
    const found = call(task.find.tool, { name });
    const id = found.value === undefined ? undefined : idFrom(found.value, name);
    if (id === undefined) continue;
    call(workToolOf(task), workArgs(key, task, id));
    call(workToolOf(task), workArgs(key, task, id));
    if (task.kind === 'write') call(task.get.tool, { id });
  }
  return world.endState();
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
