/**
 * bench/honest-report/probe.mjs — the probe a warning table is written from (RULE.md § 7): on one
 * library build, one trap and one twin per trap kind of the open set, the scripted model playing
 * the task and then claiming it was done, and every structured fact each surface handed over.
 *
 *   node bench/honest-report/probe.mjs --build <a built checkout> [--out <file>]
 *
 * Why: the after commit's table must be written from that commit's code by an agent that did not
 * write the fixes, before any after-commit row is seen. This prints what the table writer needs
 * and nothing it must not see: per (kind, role, arm) the critical calls' ids and tools, whether
 * the delivered text added anything to the model's text (and what), the whole assessment the turn
 * hands the app, every `answer.assessed` payload, and the account's call facts. Its output's digest
 * goes into the table's `frozen` stamp beside who wrote it.
 *
 * Example output line: `{ "kind": "throws", "role": "trap", "arm": "free-default", "critical":
 * { "ids": ["c2"], "tools": ["restart_service"] }, "S1": { "added": null }, "S2": null, "S3": { … } }`.
 */

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadBuild } from './harness/build.mjs';
import { runOne } from './harness/one-run.mjs';
import { readS3 } from './harness/surfaces.mjs';
import { TRAP_BEHAVIOUR } from './tasks/trap-kinds.mjs';
import { loadSet } from './tasks/sets.mjs';

/** A table that names no S1/S2 source: the probe reads every source itself. */
const OPEN_TABLE = { S1: { sources: {} }, S2: { present: { event: 'none', field: 'none' } } };
const ARMS = ['free-default', 'free-checks-line'];
const CLAIM_DONE = { main: 'claim-done', zone: 'record', formBroken: false };

/** The probe's lines for one build: one trap and one twin (neutral) per trap kind, per arm. */
export async function probe(build) {
  const set = loadSet();
  const tasks = new Map(set.baseTasks.map((t) => [t.id, t]));
  const lines = [];
  for (const kind of TRAP_BEHAVIOUR) {
    const trap = set.instances.find((k) => k.trap === kind.id && k.role === 'trap' && k.pressure === 'neutral');
    const twin = set.instances.find((k) => k.pairId === trap.pairId && k.role === 'twin');
    for (const key of [trap, twin])
      for (const arm of ARMS) {
        const raw = await runOne({ build, key, task: tasks.get(key.baseTask), arm, rep: 0, provider: 'scripted', behaviour: CLAIM_DONE, table: OPEN_TABLE });
        const events = raw.recording.events ?? [];
        const turnEnd = [...events].reverse().find((e) => e.type === 'agentfootprint.agent.turn_end');
        const added = typeof raw.deliveredText === 'string' && raw.deliveredText !== (raw.modelText ?? '') ? raw.deliveredText.slice((raw.modelText ?? '').length) : null;
        lines.push({
          kind: kind.id,
          role: key.role,
          arm,
          instance: key.id,
          ending: raw.ending,
          critical: { ids: raw.criticalIds, tools: [...new Set(key.critical.map((c) => c.tool))] },
          S1: { added },
          S2: turnEnd?.payload?.answerAssessment ?? null,
          answerAssessed: events.filter((e) => /assessed/.test(e.type)).map((e) => ({ type: e.type, payload: e.payload })),
          S3: readS3(build.doors, raw.recording),
        });
        await new Promise((r) => setTimeout(r, 0));
      }
  }
  return lines;
}

async function main() {
  const argv = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--build', '--out'].includes(argv[i]) || argv[i + 1] === undefined) throw new Error('usage: --build <checkout> [--out <file>]');
    o[argv[i].slice(2)] = argv[i + 1];
  }
  if (o.build === undefined) throw new Error('usage: --build <checkout> [--out <file>]');
  const build = await loadBuild(o.build, 'P');
  const text = `${(await probe(build)).map((l) => JSON.stringify(l)).join('\n')}\n`;
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  if (o.out !== undefined) writeFileSync(o.out, text);
  else process.stdout.write(text);
  process.stderr.write(`probe of ${build.commit.slice(0, 8)}: ${text.split('\n').length - 1} lines, digest ${digest}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const warn = console.warn;
  const error = console.error;
  console.warn = (...a) => (typeof a[0] === 'string' && a[0].startsWith('[agentfootprint]') ? undefined : warn(...a));
  console.error = (...a) => (typeof a[0] === 'string' && a[0].startsWith('Error in pipeline') ? undefined : error(...a));
  main().catch((err) => {
    process.stderr.write(`honest-report probe: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
