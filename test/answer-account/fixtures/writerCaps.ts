/**
 * A real run on the mock (`code: 'match'` and the attachment), JSON-round-
 * tripped, then filled to the WRITER'S OWN caps with well-formed entries:
 * `MAX_CODE_REGIONS` shown-block verdicts, `MAX_ATTACHED_SCRIPTS` attached
 * scripts and `MAX_SCRIPT_ROWS` rows, each with every extra line its label
 * allows. The size tests of the account (README law 8) start from it.
 */

import { Agent, codeRunnerTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { recordRun } from '../../../src/observe.js';
import type { Recording } from '../../../src/recorders/observability/recordRun.js';

export const PROGRAM = 'print(41 + 1)';
export const FULL = 'print("the whole program, longer than what is shown")';
/** A provider's call id and a tool name at the length a hostile or careless provider might use. */
export const callId = (i: number) => `call-${i}-`.padEnd(200, 'x');
export const TOOL = 'run_code'.padEnd(64, '_');

export async function matchedRecording(): Promise<Recording> {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'run_code', args: { code: PROGRAM } }] },
        { content: `It printed 42.\n\n\`\`\`python\n${PROGRAM}\n\`\`\`` },
      ] as never,
    }),
    model: 'mock',
  })
    .namesAndNumbersFromEvidence({ posture: 'assist', code: 'match' })
    .tool(
      codeRunnerTool({
        runner: {
          id: 'answering',
          start: () =>
            Promise.resolve({
              id: 's1',
              execute: () => Promise.resolve({ ok: true, exitCode: 0, stdout: '42', stderr: '' }),
              stop: () => Promise.resolve(),
            }),
        },
      }),
    )
    .scriptTravelsWithTheAnswer({ which: 'all' })
    .build();
  const recorder = recordRun(agent);
  await agent.run({ message: 'compute' });
  const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  recorder.stop();
  return recording;
}

export type Doc = {
  events: Array<{ type: string; payload: Record<string, unknown> }>;
  snapshot: { sharedState: Record<string, unknown> };
};

export const lastOf = (doc: Doc, type: string) =>
  [...doc.events].reverse().find((e) => e.type === `agentfootprint.${type}`)!;

/** `recording` filled with `blocks` shown-block verdicts and `attached` attached scripts. */
export function filled(recording: Recording, blocks: number, attached: number): Recording {
  const doc = JSON.parse(JSON.stringify(recording)) as Doc;
  const state = doc.snapshot.sharedState;
  const turn = state.turnNumber as number;
  const ledger = (state.findingsLedger as Array<Record<string, unknown>>).filter(
    (r) => r.kind !== 'script',
  );
  // One row per dispatch, every extra line its label allows: a withheld result and a rewrite.
  for (let d = 1; d <= 16; d++) {
    ledger.push({
      kind: 'script',
      toolCallId: callId(d),
      dispatch: d,
      tool: TOOL,
      argument: 'code',
      language: 'python',
      bytes: PROGRAM.length,
      lines: 1,
      text: PROGRAM,
      outcome: 'completed-with-failure',
      exitCode: 1,
      resultWithheld: 'over-ceiling',
      rewritten: true,
      turn,
      iteration: 1,
    });
  }
  state.findingsLedger = ledger;
  const scripts = lastOf(doc, 'agent.evidence_checked').payload.scripts as Record<string, unknown>;
  scripts.blocks = Array.from({ length: blocks }, (_, i) => ({
    block: i + 1,
    label: 'completed-with-failure',
    exitCode: 1,
    toolCallId: callId((i % 16) + 1),
    tool: TOOL,
    dispatch: (i % 16) + 1,
  }));
  const end = lastOf(doc, 'agent.turn_end').payload;
  end.scripts = {
    shown: Array.from({ length: attached }, (_, i) => ({
      toolCallId: callId(i + 1),
      dispatch: i + 1,
      tool: TOOL,
      language: 'python',
      label: 'completed-with-failure',
      exitCode: 1,
      resultWithheld: 'over-ceiling',
      rewritten: true,
      bytes: FULL.length,
      lines: 1,
      truncated: { shownBytes: 10 },
      text: FULL.slice(0, 10),
    })),
    omitted: 3,
    withheldFromText: true,
  };
  return doc as unknown as Recording;
}

/**
 * `recording` with every identity a pointer, a line or a fact copies from it
 * written as `id`: each event's `runtimeStageId`, and the call id and the tool
 * name on every block verdict, attached script and script row. A record this
 * library never writes — the shape of a saved one anyone could have edited.
 */
export function withIdentities(recording: Recording, id: string): Recording {
  const doc = JSON.parse(JSON.stringify(recording)) as Doc & {
    events: Array<{
      type: string;
      payload: Record<string, unknown>;
      meta: Record<string, unknown>;
    }>;
  };
  for (const event of doc.events) event.meta.runtimeStageId = id;
  const named = (entries: unknown): void => {
    for (const entry of (Array.isArray(entries) ? entries : []) as Array<Record<string, unknown>>) {
      if (entry.toolCallId !== undefined) entry.toolCallId = id;
      if (entry.tool !== undefined) entry.tool = id;
    }
  };
  named((lastOf(doc, 'agent.evidence_checked').payload.scripts as { blocks: unknown }).blocks);
  named((lastOf(doc, 'agent.turn_end').payload.scripts as { shown: unknown }).shown);
  named(
    (doc.snapshot.sharedState.findingsLedger as Array<Record<string, unknown>>).filter(
      (row) => row.kind === 'script',
    ),
  );
  return doc as unknown as Recording;
}
