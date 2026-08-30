/**
 * find_context_errors — the Context Integrity findings of one completed run,
 * served as a bounded, drillable list.
 *
 * The tool READS. It never re-runs a check and never re-judges one: the
 * findings were deduplicated at filing time, and what this adds is the JOIN —
 * which step each finding was filed at, which steps its witnesses came from,
 * and the exact next call (`trace_node` / `trace_slice` / `who_wrote` /
 * `backtrack` / `find_in_trace`) that opens the state behind it.
 *
 * Test types (Convention 3): unit (enumeration, filters, the kind pin) /
 * functional (the causal join — every id handed back is really accepted by
 * the tool it is handed to) / honesty (the four absence states, which is the
 * whole reason this family exists: "no findings" and "no finding evidence"
 * are different sentences) / bounded (limit, caps, long messages) /
 * integration (a REAL agent run whose live loop files a real finding) /
 * regression (the pack + the reserved-name list carry it).
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, slidingWindow } from '../../../src/index.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';
import type { AgentfootprintEvent } from '../../../src/events.js';
import type { EventMeta } from '../../../src/events/types.js';
import type { CheckReport } from '../../../src/integrity/disposition/types.js';
import type { ContextError } from '../../../src/integrity/finding/types.js';
import {
  callTraceTool,
  openRecording,
  recordRun,
  TOOLPACK_HARD_CAPS,
  TRACE_TOOL_NAMES,
  traceToolpack,
  type TraceToolpackArtifacts,
} from '../../../src/observe.js';
import type { RuntimeSnapshot, StageSnapshot } from 'footprintjs/advanced';

/* ── hand-built artifacts: two committed steps + a typed event tail ────── */

const meta = (runtimeStageId: string, iterIndex?: number): EventMeta => ({
  wallClockMs: 1_700_000_000_000,
  runOffsetMs: 12,
  runtimeStageId,
  subflowPath: [],
  compositionPath: [],
  runId: 'run-1',
  ...(iterIndex !== undefined && { iterIndex }),
});

const finding = (
  error: ContextError & { readonly iteration?: number },
  runtimeStageId: string,
): AgentfootprintEvent =>
  ({
    type: 'agentfootprint.integrity.context_error',
    payload: error,
    meta: meta(runtimeStageId, error.iteration),
  } as AgentfootprintEvent);

const disposition = (
  rows: readonly CheckReport[],
  posture: 'observe' | 'dev' = 'observe',
): AgentfootprintEvent =>
  ({
    type: 'agentfootprint.integrity.disposition',
    payload: { posture, workExisted: true, rows },
    meta: meta('integrity-disposition#0'),
  } as AgentfootprintEvent);

const row = (over: Partial<CheckReport> & Pick<CheckReport, 'check' | 'seam'>): CheckReport => ({
  checked: 0,
  findings: 0,
  notApplicable: 0,
  unreachable: 0,
  synthetic: 0,
  ...over,
});

/** Two committed steps, so a filed-at id is a REAL id the drills accept. */
function twoStepSnapshot(): RuntimeSnapshot {
  const build: StageSnapshot = {
    id: 'build-tools',
    runtimeStageId: 'build-tools#0',
    name: 'Build tools',
    logs: {},
    errors: {},
    metrics: {},
    evals: {},
  };
  const call: StageSnapshot = {
    id: 'call-llm',
    runtimeStageId: 'call-llm#1',
    name: 'Call the model',
    logs: {},
    errors: {},
    metrics: {},
    evals: {},
  };
  build.next = call;
  return {
    sharedState: { toolNames: ['whats_here'], answer: 'yes' },
    executionTree: build,
    commitValues: 'full',
    commitLog: [
      {
        idx: 0,
        stage: 'Build tools',
        stageId: 'build-tools',
        runtimeStageId: 'build-tools#0',
        trace: [{ path: 'toolNames', verb: 'set' as const }],
        redactedPaths: [],
        overwrite: { toolNames: ['whats_here'] },
        updates: {},
      },
      {
        idx: 1,
        stage: 'Call the model',
        stageId: 'call-llm',
        runtimeStageId: 'call-llm#1',
        trace: [{ path: 'answer', verb: 'set' as const }],
        redactedPaths: [],
        overwrite: { answer: 'yes' },
        updates: {},
      },
    ],
  } as unknown as RuntimeSnapshot;
}

const WIRE_ERROR: ContextError = {
  kind: 'invariant-violation',
  seam: 'wire',
  subjects: [{ kind: 'tool', id: 'ghost_tool' }],
  witnesses: [
    {
      subject: { kind: 'tool', id: 'ghost_tool' },
      predicate: 'offered',
      value: false,
      stratum: 'asserted',
      provenance: 'the composed frame',
      runtimeStageId: 'build-tools#0',
    },
    {
      subject: { kind: 'tool', id: 'ghost_tool' },
      predicate: 'offered',
      value: true,
      stratum: 'asserted',
      provenance: 'the tools sent on the wire',
      runtimeStageId: 'call-llm#1',
    },
  ],
  epoch: 3,
  message: 'ghost_tool was on the wire but the composed frame did not serve it',
};

const DANGLING_ERROR: ContextError & { readonly iteration: number } = {
  kind: 'dangling-reference',
  seam: 'compose',
  subjects: [
    { kind: 'tool', id: 'screen_fire' },
    { kind: 'tool', id: 'toolNames' },
  ],
  witnesses: [
    {
      subject: { kind: 'tool', id: 'screen_fire' },
      predicate: 'offered',
      value: true,
      stratum: 'asserted',
      provenance: 'the tools slot',
    },
  ],
  iteration: 4,
  message: 'screen_fire is offered but the results grounding its arguments left the window',
};

function artifactsWith(events?: readonly AgentfootprintEvent[]): TraceToolpackArtifacts {
  return { snapshot: twoStepSnapshot(), ...(events !== undefined && { events }) };
}

const ask = (
  artifacts: TraceToolpackArtifacts,
  args: Record<string, unknown> = {},
): Promise<string> => callTraceTool(traceToolpack(artifacts), 'find_context_errors', args);

/* ── unit: enumeration ─────────────────────────────────────────────────── */

describe('find_context_errors — enumeration', () => {
  const two = artifactsWith([
    finding(WIRE_ERROR, 'call-llm#1'),
    finding(DANGLING_ERROR, 'call-llm#1'),
    disposition([
      row({ check: 'invariant-violation', seam: 'wire', checked: 6, findings: 1 }),
      row({ check: 'dangling-reference', seam: 'compose', checked: 4, findings: 1 }),
    ]),
  ]);

  it('lists every finding with its kind, seam, subjects and message', async () => {
    const out = await ask(two);
    expect(out).toContain('CONTEXT ERRORS');
    expect(out).toContain('2 finding(s)');
    expect(out).toContain('invariant-violation @wire');
    expect(out).toContain('dangling-reference @compose');
    expect(out).toContain('ghost_tool was on the wire');
    expect(out).toContain('screen_fire is offered but the results grounding');
    expect(out).toContain('tool:ghost_tool');
    expect(out).toContain('tool:screen_fire');
  });

  it('names the STEP each finding was filed at, and the iteration when known', async () => {
    const out = await ask(two);
    expect(out).toContain('call-llm#1');
    expect(out).toContain('iteration 4');
  });

  it('shows the epoch a conflict was judged at when the witnesses carry one', async () => {
    const out = await ask(two);
    expect(out).toContain('epoch 3');
  });

  it('filters by kind, and an empty filter says which kinds this run DID file', async () => {
    const only = await ask(two, { kind: 'dangling-reference' });
    expect(only).toContain('dangling-reference');
    expect(only).not.toContain('ghost_tool was on the wire');

    const none = await ask(two, { kind: 'unsupported-claim' });
    expect(none).toContain("no 'unsupported-claim'");
    expect(none).toContain('invariant-violation');
    expect(none).toContain('dangling-reference');
  });

  it('rejects a kind outside the closed vocabulary at the #9 boundary', async () => {
    const out = await ask(two, { kind: 'not-a-kind' });
    expect(out).toMatch(/find_context_errors/);
    expect(out).toMatch(/kind/);
  });

  it('shows an ADVISORY but never counts it as a context error', async () => {
    // 9.61.0: an advisory reports doubt (an answer declining to claim a
    // verified fact), not a contradiction. Counting it as a defect would
    // report a run as broken because it was careful.
    const out = await ask(
      artifactsWith([
        finding(DANGLING_ERROR, 'call-llm#1'),
        finding({ ...WIRE_ERROR, advisory: true }, 'call-llm#1'),
        disposition([
          row({ check: 'dangling-reference', seam: 'compose', checked: 2, findings: 1 }),
        ]),
      ]),
    );
    expect(out).toContain('1 finding(s)');
    expect(out).toContain('1 advisory');
    expect(out).toContain('ADVISORY — counted apart from real defects');
    // It is still listed: quarantined from the count, not from the answer.
    expect(out).toContain('ghost_tool was on the wire');
  });

  it('quarantines synthetic canary findings from the real count', async () => {
    const canary: ContextError = { ...WIRE_ERROR, synthetic: true };
    const out = await ask(
      artifactsWith([
        finding(DANGLING_ERROR, 'call-llm#1'),
        finding(canary, 'call-llm#1'),
        disposition([
          row({ check: 'dangling-reference', seam: 'compose', checked: 2, findings: 1 }),
        ]),
      ]),
    );
    expect(out).toContain('1 finding(s)');
    expect(out).toContain('synthetic');
  });
});

/* ── functional: the causal join ───────────────────────────────────────── */

describe('find_context_errors — the causal join', () => {
  const two = artifactsWith([
    finding(WIRE_ERROR, 'call-llm#1'),
    finding(DANGLING_ERROR, 'call-llm#1'),
    disposition([row({ check: 'invariant-violation', seam: 'wire', checked: 6, findings: 1 })]),
  ]);

  it("hands back pointers the pack's own tools accept — no id assembly by hand", async () => {
    const out = await ask(two);
    expect(out).toContain("trace_node('call-llm#1')");
    expect(out).toContain("runtimeStageId: 'call-llm#1'");
    expect(out).toContain("find_in_trace('ghost_tool')");
  });

  it('the filed-at id really opens in trace_node and trace_slice', async () => {
    const tools = traceToolpack(two);
    const node = await callTraceTool(tools, 'trace_node', { runtimeStageId: 'call-llm#1' });
    expect(node).not.toContain('unknown runtimeStageId');
    expect(node).toContain('STEP call-llm#1');
    const slice = await callTraceTool(tools, 'trace_slice', { runtimeStageId: 'call-llm#1' });
    expect(slice).not.toContain('unknown runtimeStageId');
  });

  it('names the witness steps, so "which two facts disagreed" is drillable', async () => {
    const out = await ask(two);
    expect(out).toContain('witness');
    expect(out).toContain('build-tools#0');
  });

  it('resolves a subject that IS a tracked state key to its writer, ready for who_wrote', async () => {
    const out = await ask(two);
    // DANGLING_ERROR names `toolNames`, which the commit log really wrote.
    expect(out).toContain("who_wrote('toolNames')");
    expect(out).toContain('build-tools#0');
    const answer = await callTraceTool(traceToolpack(two), 'who_wrote', { key: 'toolNames' });
    expect(answer).toContain('build-tools#0');
  });

  it('says so when a finding was filed at a step this run never executed', async () => {
    const out = await ask(
      artifactsWith([
        finding(WIRE_ERROR, 'nowhere#9'),
        disposition([row({ check: 'invariant-violation', seam: 'wire', checked: 1, findings: 1 })]),
      ]),
    );
    expect(out).toContain('nowhere#9');
    expect(out).toContain('⚠');
    expect(out).not.toContain("trace_node('nowhere#9')");
  });
});

/* ── honesty: the absence states, which are the point ──────────────────── */

describe('find_context_errors — honest absence', () => {
  it('artifacts with NO event tail say the evidence channel is absent, never "none found"', async () => {
    const out = await ask(artifactsWith(undefined));
    expect(out).toContain('⚠');
    expect(out).toMatch(/no event tail|carry no events/i);
    expect(out).toContain('agentfootprint.integrity.context_error');
    expect(out).toContain('selfExplain');
    expect(out).not.toMatch(/no (context )?errors found/i);
    expect(out).not.toContain('the checkers below');
  });

  it('an event tail with no integrity events at all is a DIFFERENT sentence', async () => {
    const out = await ask(
      artifactsWith([
        {
          type: 'agentfootprint.stream.tool_start',
          payload: { toolCallId: 'c1', toolName: 'x' },
          meta: meta('call-llm#1'),
        } as AgentfootprintEvent,
      ]),
    );
    expect(out).toContain('⚠');
    expect(out).toMatch(/no Context Integrity events/i);
    expect(out).not.toMatch(/no event tail/i);
    // It must REFUSE the clean-bill reading in words, not merely avoid it.
    expect(out).toMatch(/never as a clean bill of health/i);
    expect(out).not.toMatch(/none filed|found nothing/i);
  });

  it('"the checkers ran and found nothing" is stated with the rows that prove it', async () => {
    const out = await ask(
      artifactsWith([
        disposition([
          row({ check: 'invariant-violation', seam: 'wire', checked: 12 }),
          row({ check: 'dangling-reference', seam: 'compose', checked: 3, notApplicable: 2 }),
        ]),
      ]),
    );
    expect(out).toContain('none filed');
    expect(out).toContain('CHECKERS');
    expect(out).toContain('invariant-violation @wire');
    expect(out).toContain('12');
    expect(out).toMatch(/ran and found nothing|0 finding/);
    // The standing bound travels with every green answer.
    expect(out).toMatch(/does not mean no context error exists/i);
  });

  it('a green HEADLINE never claims coverage a silent check did not give it', async () => {
    // One busy check and one that checked nothing (every encounter out of
    // scope). Summing `checked` across the rows makes the run look covered;
    // the rows say otherwise, and the headline is what a reader stops at.
    const out = await ask(
      artifactsWith([
        disposition([
          row({ check: 'invariant-violation', seam: 'wire', checked: 2 }),
          row({ check: 'dangling-reference', seam: 'compose', notApplicable: 2 }),
        ]),
      ]),
    );
    const headline = out.split('\n')[0];
    expect(headline).toContain('⚠');
    expect(headline).toMatch(/COVERAGE IS PARTIAL/);
    // It NAMES the silent check in the headline, not only in the rows below.
    expect(headline).toContain('dangling-reference @compose');
    // And it must not read as blanket green.
    expect(headline).not.toMatch(/All \d+ registered check\(s\) below RAN/);
    expect(out).toMatch(/⚠ ran 0×/); // the row still says it too
  });

  it('the unqualified green headline is reserved for rows that ALL checked', async () => {
    const out = await ask(
      artifactsWith([
        disposition([
          row({ check: 'invariant-violation', seam: 'wire', checked: 2 }),
          row({ check: 'dangling-reference', seam: 'compose', checked: 1, notApplicable: 2 }),
        ]),
      ]),
    );
    const headline = out.split('\n')[0];
    expect(headline).toMatch(/All 2 registered check\(s\) below RAN/);
    expect(headline).not.toMatch(/COVERAGE IS PARTIAL/);
  });

  it('"no checker was registered" is not "the checkers found nothing"', async () => {
    const out = await ask(artifactsWith([disposition([])]));
    expect(out).toContain('⚠');
    expect(out).toMatch(/no .*check.* was registered|none registered/i);
    expect(out).not.toMatch(/ran and found nothing/);
    // The HEADLINE says it too, not only the rows underneath it.
    expect(out).toMatch(/NO CHECK WAS REGISTERED/);
    expect(out).not.toMatch(/nothing they cover was violated/i);
  });

  it('a registered check that never encountered a subject is named as wiring rot', async () => {
    const out = await ask(
      artifactsWith([
        disposition([
          row({ check: 'invariant-violation', seam: 'wire', checked: 4 }),
          row({ check: 'dangling-reference', seam: 'compose' }),
        ]),
      ]),
    );
    expect(out).toContain('dangling-reference @compose');
    expect(out).toMatch(/never (ran|encountered)/i);
  });

  it('unreachable encounters are reported as silence, not as health', async () => {
    const out = await ask(
      artifactsWith([
        disposition([
          row({ check: 'invariant-violation', seam: 'wire', checked: 4, unreachable: 7 }),
        ]),
      ]),
    );
    expect(out).toContain('unreachable 7');
    expect(out).toMatch(/identity/i);
  });

  it('reconciles encounter counts with the deduplicated list instead of looking short', async () => {
    // The rows count every encounter that filed; the event stream files one
    // event per DISTINCT defect. Six-in-the-row, one-in-the-list is correct.
    const out = await ask(
      artifactsWith([
        finding(DANGLING_ERROR, 'call-llm#1'),
        disposition([
          row({ check: 'dangling-reference', seam: 'compose', checked: 6, findings: 6 }),
        ]),
      ]),
    );
    expect(out).toContain('1 finding(s)');
    expect(out).toMatch(/ENCOUNTER that filed \(6\)/);
    expect(out).toMatch(/deduplicated by identity \(1 distinct/);
  });

  it('registered checks that never actually checked anything is silence, not a clean bill', async () => {
    // THE DEFECT this guards: the green headline used to be printed without
    // ever reading the rows it claims to summarise. A run where every
    // encounter was `unreachable` (the check could not see the evidence) had
    // nothing checked at all — calling that "nothing they cover was violated"
    // is the exact sentence this family exists to refuse.
    const out = await ask(
      artifactsWith([
        disposition([
          row({ check: 'invariant-violation', seam: 'wire', unreachable: 9 }),
          row({ check: 'dangling-reference', seam: 'compose' }),
        ]),
      ]),
    );
    expect(out).toContain('⚠');
    expect(out).toMatch(/NOTHING WAS CHECKED/);
    expect(out).toMatch(/unreachable/i);
    expect(out).not.toMatch(/nothing they cover was violated/i);
    expect(out).not.toMatch(/checkers below ran/i);
    expect(out).not.toMatch(/none filed\./);
  });

  it('checks that only ever ruled themselves out of scope did not pass anything either', async () => {
    const out = await ask(
      artifactsWith([
        disposition([row({ check: 'dangling-reference', seam: 'compose', notApplicable: 5 })]),
      ]),
    );
    expect(out).toMatch(/NOTHING WAS CHECKED/);
    expect(out).toMatch(/out of scope by rule/);
    expect(out).not.toMatch(/nothing they cover was violated/i);
  });

  it('the green headline names the checked encounters that earned it', async () => {
    const out = await ask(
      artifactsWith([
        disposition([
          row({ check: 'invariant-violation', seam: 'wire', checked: 12 }),
          row({ check: 'dangling-reference', seam: 'compose', checked: 3, unreachable: 4 }),
        ]),
      ]),
    );
    expect(out).toMatch(/15 checked encounter/);
    expect(out).toContain('nothing they cover was violated');
  });

  it('a tail whose only findings are canaries, with no rows, is not reported as green', async () => {
    // No disposition event at all: nothing records which checks ran, so the
    // absence of a real finding is unmeasured rather than clean.
    const out = await ask(
      artifactsWith([finding({ ...WIRE_ERROR, synthetic: true }, 'call-llm#1')]),
    );
    expect(out).toContain('⚠');
    expect(out).toMatch(/no disposition/i);
    expect(out).not.toMatch(/nothing they cover was violated/i);
    expect(out).not.toMatch(/checkers below ran/i);
  });

  it('rows reporting findings the tail does not carry is EVIDENCE MISSING, not a clean run', async () => {
    const out = await ask(
      artifactsWith([
        disposition([
          row({ check: 'dangling-reference', seam: 'compose', checked: 6, findings: 2 }),
        ]),
      ]),
    );
    expect(out).toContain('EVIDENCE MISSING');
    expect(out).toContain('2 finding(s) filed');
    expect(out).not.toContain('none filed');
    expect(out).toMatch(/opposite of a clean run/i);
  });

  it('findings WITHOUT disposition rows admit that nothing says which checkers ran', async () => {
    const out = await ask(artifactsWith([finding(WIRE_ERROR, 'call-llm#1')]));
    expect(out).toContain('1 finding(s)');
    expect(out).toContain('CHECKERS');
    expect(out).toMatch(/no disposition/i);
  });
});

/* ── honesty: the tool only offers defect classes a check can file ─────── */

describe('find_context_errors — the kind vocabulary it can answer for', () => {
  const findTool = () =>
    traceToolpack(artifactsWith(undefined)).find((t) => t.schema.name === 'find_context_errors')!;

  const kindEnum = (): readonly string[] => {
    const properties = (
      findTool().schema.inputSchema as {
        properties?: Record<string, { enum?: readonly string[] }>;
      }
    ).properties;
    return properties?.kind?.enum ?? [];
  };

  it('offers only the classes a check in this build can actually file', () => {
    // `ContextErrorKind` names six classes; `src/integrity/` ships five
    // checks. Offering the sixth invites a query whose only possible answer
    // is a negative verdict about a class nothing could have filed.
    expect([...kindEnum()].sort()).toEqual([
      'dangling-reference',
      'empty-lookup',
      'invariant-violation',
      'unsupported-argument',
      'unsupported-claim',
    ]);
    expect(kindEnum()).not.toContain('duplicate-execution');
  });

  it('the description does not advertise a defect class the pack cannot report', () => {
    const description = findTool().schema.description ?? '';
    expect(description).not.toMatch(/settled work done twice/i);
    // The choice seam ships now, so the tool DOES advertise it.
    expect(description).toMatch(/an argument nothing served/i);
    // It still says out loud that the one remaining class has no checker here.
    expect(description).toMatch(/duplicate-execution/);
    expect(description).toMatch(/no check .*files it|cannot report/i);
  });

  it('answers honestly when a caller asks for a class no check can file', async () => {
    // Args validation is a DIAL (`toolArgValidation: 'off' | 'warn'`), so the
    // enum is a menu, not a wall: `execute` really is reachable with a kind
    // it never offered. A negative verdict here would be a lie about a class
    // nothing on earth could have filed.
    const out = String(await findTool().execute({ kind: 'duplicate-execution' }, {} as never));
    expect(out).toContain('⚠');
    expect(out).toMatch(/no check in this build .*file/i);
    expect(out).toMatch(/duplicate-execution/);
    expect(out).not.toMatch(/no 'duplicate-execution' findings in this run/);
    expect(out).not.toMatch(/none filed/);
  });

  it('lists findings a tail really carries under an unfilable kind rather than refusing them', async () => {
    // The refusal claims nothing ever looked. If the tail carries findings
    // under that kind anyway — a foreign filer, or a recording from a build
    // that shipped the check — refusing would be the lie in the other
    // direction, and would drop real evidence on the floor.
    const foreign = {
      ...WIRE_ERROR,
      kind: 'duplicate-execution' as const,
      message: 'the four-step sequence ran twice',
    };
    const out = String(
      await traceToolpack(
        artifactsWith([
          finding(foreign, 'call-llm#1'),
          disposition([row({ check: 'duplicate-execution', seam: 'choice', checked: 2 })]),
        ]),
      )
        .find((t) => t.schema.name === 'find_context_errors')!
        .execute({ kind: 'duplicate-execution' }, {} as never),
    );
    expect(out).toContain('the four-step sequence ran twice');
    expect(out).not.toMatch(/UNANSWERABLE/);
  });

  it('a kind outside the finding type at all is refused as an unknown class', async () => {
    const out = String(await findTool().execute({ kind: 'not-a-kind' }, {} as never));
    expect(out).toContain('⚠');
    expect(out).toMatch(/not a defect class|not a Context Integrity/i);
    expect(out).not.toMatch(/none filed/);
  });
});

/* ── bounded ───────────────────────────────────────────────────────────── */

describe('find_context_errors — bounded output', () => {
  const many = (count: number): TraceToolpackArtifacts =>
    artifactsWith([
      ...Array.from({ length: count }, (_, i) =>
        finding(
          {
            ...WIRE_ERROR,
            subjects: [{ kind: 'tool', id: `ghost_${i}` }],
            message: `finding number ${i}`,
          },
          'call-llm#1',
        ),
      ),
      disposition([
        row({ check: 'invariant-violation', seam: 'wire', checked: count, findings: count }),
      ]),
    ]);

  it('caps at the default limit and says more exist', async () => {
    const out = await ask(many(30));
    expect(out).toContain('finding number 0');
    expect(out).not.toContain('finding number 20');
    expect(out).toMatch(/showing 10 of 30|more/);
  });

  it('clamps limit to the hard cap however much the model asks for', async () => {
    const out = await ask(many(40), { limit: 9999 });
    expect(out).toContain(`finding number ${TOOLPACK_HARD_CAPS.contextErrorsMax - 1}`);
    expect(out).not.toContain(`finding number ${TOOLPACK_HARD_CAPS.contextErrorsMax}`);
  });

  it('truncates a long message explicitly rather than serving it whole', async () => {
    const out = await ask(
      artifactsWith([
        finding({ ...WIRE_ERROR, message: `START-${'y'.repeat(2000)}-END` }, 'call-llm#1'),
      ]),
    );
    expect(out).toContain('START-');
    expect(out).not.toContain('-END');
    expect(out.length).toBeLessThan(3000);
  });

  it('caps the subjects it names on one finding', async () => {
    const out = await ask(
      artifactsWith([
        finding(
          {
            ...WIRE_ERROR,
            subjects: Array.from({ length: 30 }, (_, i) => ({ kind: 'tool', id: `s${i}` })),
          },
          'call-llm#1',
        ),
      ]),
    );
    expect(out).toContain('tool:s0');
    expect(out).not.toContain('tool:s29');
    expect(out).toContain('…');
  });

  it('a malformed payload degrades to a marked row instead of throwing', async () => {
    const out = await ask(
      artifactsWith([
        {
          type: 'agentfootprint.integrity.context_error',
          payload: { message: 'half a finding' },
          meta: meta('call-llm#1'),
        } as AgentfootprintEvent,
      ]),
    );
    expect(out).toContain('half a finding');
    expect(out).toContain('⚠');
  });
});

/* ── integration: a REAL run whose live loop files a real finding ──────── */

const TASK = 'Walk the whole floor and tell me which rack is hottest.';

function bigGround() {
  return defineTool({
    name: 'whats_here',
    description: 'lists the valid ids on this screen',
    inputSchema: { type: 'object', properties: {} },
    execute: () => `IDS ${'x'.repeat(600)}`,
  });
}

function firesAtIds() {
  return defineTool({
    name: 'screen_fire',
    description: 'fires one of the ids whats_here listed',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'fired',
    argumentsFrom: ['whats_here'],
  });
}

function scriptedProvider(rounds: number): LLMProvider {
  let call = 0;
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => {
      call++;
      if (call > rounds) {
        return {
          content: 'done',
          toolCalls: [],
          usage: { input: 10, output: 5 },
          stopReason: 'end_turn',
        };
      }
      return {
        content: '',
        toolCalls: [
          call === 1
            ? { id: `h${call}`, name: 'whats_here', args: {} }
            : { id: `f${call}`, name: 'screen_fire', args: {} },
        ],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      };
    },
  };
}

describe('find_context_errors — over a real completed run', () => {
  it('reads the finding the live loop really filed, and its step really opens', async () => {
    const agent = Agent.create({
      provider: scriptedProvider(8),
      model: 'm',
      maxIterations: 12,
      keepLastToolResults: false,
    })
      .tool(bigGround())
      .tool(firesAtIds())
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .build();

    const recorder = recordRun(agent);
    await agent.run({ message: TASK });
    const recording = recorder.toRecording();
    recorder.stop();

    const artifacts: TraceToolpackArtifacts = {
      snapshot: agent.getLastSnapshot()!,
      events: recording.events,
    };
    const tools = traceToolpack(artifacts);
    const out = await callTraceTool(tools, 'find_context_errors');

    expect(out).toContain('dangling-reference @compose');
    expect(out).toContain('whats_here');
    expect(out).toContain('screen_fire');
    expect(out).toContain('CHECKERS');

    // The DOCUMENTED door (docs: monitor/context-integrity) is the recording
    // itself, not hand-assembled artifacts: recordRun → openRecording →
    // traceToolpack must reach the same finding, or the page teaches a path
    // that does not work.
    const documented = await callTraceTool(
      traceToolpack(openRecording(recording)),
      'find_context_errors',
    );
    expect(documented).toContain('dangling-reference @compose');

    // The join is real: the step id the answer hands back opens in trace_node.
    const filedAt = /trace_node\('([^']+)'\)/.exec(out)?.[1];
    expect(filedAt).toBeDefined();
    const node = await callTraceTool(tools, 'trace_node', { runtimeStageId: filedAt! });
    expect(node).not.toContain('unknown runtimeStageId');
  });
});

/* ── regression: the pack and the reservation list carry it ────────────── */

describe('find_context_errors — pack membership', () => {
  it('mounts on every pack, evidence or not (a tool that vanishes cannot say why)', () => {
    const names = traceToolpack(artifactsWith(undefined)).map((t) => t.schema.name);
    expect(names).toContain('find_context_errors');
  });

  it('is reserved by name, like every other tool the pack can mount', () => {
    expect(TRACE_TOOL_NAMES).toContain('find_context_errors');
  });
});
