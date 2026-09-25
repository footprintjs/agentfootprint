/**
 * The fixture reducer — turns an archived field recording into the repo
 * fixture the answer-account tests read.
 *
 * What it keeps: every event, AT ITS INDEX (a token event keeps its slot with
 * its text blanked), so a pointer in a golden lands on the same event the
 * archived recording holds; the snapshot's `runId`; the `sharedState` keys the
 * account reads (`history`, `userMessage`, `turnNumber`, `pausedToolCallId`).
 *
 * What it drops or blanks — size, and no app prompt checked into the library:
 *   - the snapshot's commit log, execution tree, recorders, subflow results and
 *     every other `sharedState` key (skill bodies, resolved instructions, tool
 *     schemas, the ontology …);
 *   - `context.injected` bodies (`rawContent`, `contentSummary`, `reason`);
 *   - `stream.token` text; `stream.llm_start` tool descriptions (names kept);
 *   - `skill.graph_declared` node descriptions; `context.evaluated` detail;
 *   - `structure` (the chart — the account never reads it).
 *
 * Idempotent: reducing a reduced recording changes nothing (pinned).
 *
 * CLI: node reduce-recording.mjs <in.json> <out.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';

const KEEP_STATE = ['history', 'userMessage', 'turnNumber', 'pausedToolCallId'];
const P = 'agentfootprint.';

function reduceEvent(event) {
  const { type, payload, meta } = event;
  let p = payload;
  if (type === `${P}context.injected`) {
    p = { ...payload, contentSummary: '', reason: '', ...(payload.rawContent !== undefined && { rawContent: '' }) };
  } else if (type === `${P}stream.token`) {
    p = { ...payload, content: '' };
  } else if (type === `${P}stream.llm_start` && Array.isArray(payload.tools)) {
    p = { ...payload, tools: payload.tools.map((t) => ({ name: t.name })) };
  } else if (type === `${P}skill.graph_declared`) {
    p = { ...payload, nodes: payload.nodes.map(({ description, ...rest }) => rest) };
  } else if (type === `${P}context.evaluated`) {
    p = { iteration: payload.iteration };
  }
  return { type, payload: p, meta };
}

export function reduceRecording(recording) {
  const state = recording.snapshot?.sharedState ?? {};
  const sharedState = {};
  for (const key of KEEP_STATE) if (key in state) sharedState[key] = state[key];
  return {
    ...(recording.meta !== undefined && { meta: recording.meta }),
    snapshot: { runId: recording.snapshot?.runId, sharedState },
    events: recording.events.map(reduceEvent),
    structure: null,
  };
}

if (process.argv[1] && process.argv[1].endsWith('reduce-recording.mjs') && process.argv.length === 4) {
  const [, , input, output] = process.argv;
  const reduced = reduceRecording(JSON.parse(readFileSync(input, 'utf8')));
  writeFileSync(output, `${JSON.stringify(reduced, null, 1)}\n`);
}
