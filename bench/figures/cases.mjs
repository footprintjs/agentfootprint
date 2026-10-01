/**
 * bench/figures/cases.mjs — the figures bench's sheet: the capacity question over the
 * recorded tool result, under the app as it was (`before`) and with both fixes (`after`).
 *
 * The tool result is never composed here. `fixtures.json` holds the tool message content
 * EXACTLY as the model received it, produced once from the app's real code (see its
 * `$comment`): the BE room's projection (rows and tables withheld, dataset tickets kept)
 * and the classic room's (rows inline). The arms differ in exactly two things, the two fixes:
 *
 *   before  the app's result shape at 6f40b36 (no cluster figure) · the evidence gate as
 *           agentfootprint main ships it: `guard`, no `figures`
 *   after   the app's result at 43f6c24 (`capacity_by_cluster`, `units`) · the gate with
 *           `figures: true` (this branch)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = JSON.parse(readFileSync(join(HERE, 'fixtures.json'), 'utf8'));

export const ARMS = Object.freeze(['before', 'after']);
export const TOOL_NAME = 'pscale_capacity';

/**
 * The app's own words that bear on the question, condensed: the BE room's rule against head
 * arithmetic and its Data panel. Nothing here names the field figures or the fix.
 */
export const SYSTEM_PROMPT = [
  'You are the storage operations assistant for an infrastructure team.',
  'Answer questions about the estate with the tools. Datasets a tool returns are shown to the',
  'person in a Data panel beside this chat; you receive their reference and schema.',
  'Numbers in your answer must come from tool results: never do arithmetic in your head.',
  'Answer in a few sentences.',
].join(' ');

/** The gate each arm runs. `before` is main's gate (no `figures` key at all). */
export function gateOptions(arm) {
  if (arm === 'before') return { posture: 'guard' };
  if (arm === 'after') return { posture: 'guard', figures: true };
  throw new Error(`unknown arm '${arm}' — before or after`);
}

/**
 * The cases. `room` picks the projection; `role` is what the rule reads: a PROVOKING case asks
 * a cluster figure the before shape does not state, a CONTROL asks one figure every view's
 * result states (the pool's usable TB is inline in the classic room in both arms).
 */
export const CASES = Object.freeze([
  {
    id: 'how-full',
    role: 'provoking',
    room: 'be',
    message: 'How full is CLUSTER-A01?',
    mock: [
      { label: 'invents', answers: ['CLUSTER-A01 is 53.2% used, with 6.3 TB free.', 'CLUSTER-A01 is 53.2% used.'] },
      { label: 'reads', answers: ['CLUSTER-A01 is 59.2% used: 3,200.1 of 5,402.9 TB, with 1,526.3 TB usable.'] },
    ],
  },
  {
    id: 'free-space',
    role: 'provoking',
    room: 'be',
    message: 'How much free space is left on CLUSTER-A01?',
    mock: [
      { label: 'invents', answers: ['About 24.8 TB is still usable on CLUSTER-A01 (64.5% used).', 'Roughly 24.8 TB.'] },
      { label: 'declines', answers: ['The usable space per pool is in the Data panel (usable_tb, after the hot spare).'] },
    ],
  },
  {
    id: 'pool-usable',
    role: 'control',
    room: 'classic',
    message: 'How much usable space does the h700_pool on CLUSTER-A01 have?',
    mock: [
      { label: 'reads', answers: ['h700_pool has 1,090.8 TB usable after the hot spare.'] },
      { label: 'rounds', answers: ['About 1,091 TB is usable on h700_pool (57.7% used).'] },
    ],
  },
]);

/** The tool message content the model receives for `caseDef` under `arm` — the fixture, verbatim. */
export function viewOf(caseDef, arm) {
  const view = FIXTURES.views[`${caseDef.room}-${arm}`];
  if (typeof view !== 'string') throw new Error(`no fixture view ${caseDef.room}-${arm}`);
  return view;
}

/** The tool's description under `arm` — the app's catalog at that commit. */
export function descriptionOf(arm) {
  return FIXTURES.descriptions[arm];
}

/** Problems with the sheet itself; the runner refuses to start on any. */
export function sheetProblems() {
  const problems = [];
  for (const arm of ARMS) {
    for (const room of ['be', 'classic']) {
      if (typeof FIXTURES.views[`${room}-${arm}`] !== 'string') problems.push(`missing view ${room}-${arm}`);
    }
    if (typeof FIXTURES.descriptions[arm] !== 'string') problems.push(`missing description ${arm}`);
  }
  // The before BE view must state no capacity figure at all — the shape the field ran on.
  if (/capacity_by_cluster|usable_tb"\s*:/.test(FIXTURES.views['be-before'] ?? ''))
    problems.push('be-before carries capacity figures; it is not the field shape');
  if (!/capacity_by_cluster/.test(FIXTURES.views['be-after'] ?? ''))
    problems.push('be-after lacks capacity_by_cluster');
  if (!/1090\.8/.test(FIXTURES.views['classic-before'] ?? ''))
    problems.push('the control figure is not in the classic before view');
  return problems;
}
