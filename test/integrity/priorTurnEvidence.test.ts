/**
 * prior-turn-evidence (9.83.0) — the answer is grounded, and nothing this
 * turn fetched grounds it.
 *
 * THE FIELD FAILURE this is built from: a consumer's agent answered a data
 * question with ZERO tool calls and the evidence gate approved it — "all 7
 * values in the answer were found in what the tools returned, the answer
 * stands". They were found: in an inventory result from four turns earlier,
 * fetched for a different question. The user had asked about array
 * performance; the answer recommended enabling a collector that had been
 * running for months. Two turns did it back to back.
 *
 * AND THE GATE SAID OTHERWISE — the half of this that is a bug rather than a
 * feature. Both of the gate's user-facing sentences claimed the flagged
 * values "appear in no tool result FROM THIS TURN", while the index behind
 * them walks every `role: 'tool'` turn in the history. The library asserted a
 * boundary it did not measure. This suite pins both halves: the sentences no
 * longer claim it, and the boundary is now measurable.
 *
 * The laws under test:
 *  (a) THE CLAIM — a finding needs BOTH halves: at least one grounded value,
 *      and NOT ONE of them served by the turn being answered;
 *  (b) THE FOLLOW-UP EXEMPTION — one grounded value from this turn's own
 *      results is enough to file nothing. This is the test that matters: an
 *      honest "and what about that disk?" must stay quiet, or the check gets
 *      switched off and protects nobody;
 *  (c) THE CEILING — referring back is not a defect, so the advisory is
 *      identical for the honest follow-up and the stale answer, and the
 *      ceiling sentence rides the record verbatim;
 *  (d) DEFAULT OFF — without `noticePriorTurnEvidence` the run is
 *      byte-identical, save the registered not-applicable row the family's
 *      law demands. Asserted as the ABSENCE of the finding kind, never as an
 *      undefined field;
 *  (e) THE SENTENCES — neither the model's correction nor the operator's
 *      warning claims a scope the index does not have;
 *  (f) THE CANARY — dev posture proves the pure function still fires.
 *
 * NEUTRALIZE-PROOFS, both halves, stated so a future edit that guts one goes
 * red here:
 *   • REMOVE THE TURN STAMP — make every form read as this turn's (the
 *     `neutralized` reading below, which is what `evidenceFromHistory` would
 *     produce if it stopped counting user turns) and the field case goes
 *     silent: `checked-pass`, no finding. `functional: the field case` and
 *     `unit: the claim` both red.
 *   • REMOVE THE FOLLOW-UP EXEMPTION — file whenever ANY value is older
 *     (drop the `fromThisTurn > 0` clause) and the honest follow-up starts
 *     filing: `functional: the honest follow-up` reds by name.
 *
 * Test types (Convention 3): unit (the pure claim + the index's stamps) /
 * functional (both multi-turn cases through the real loop) / contract (the
 * disposition rows, the advisory flag, the ceiling and the corrected
 * sentences) / negative (no boundary, no values, a truncated index) /
 * zero-delta (the dial absent).
 */

import { describe, expect, it } from 'vitest';
import {
  PRIOR_TURN_EVIDENCE_CEILING,
  priorTurnEvidenceOf,
  type AnswerGroundingReading,
} from '../../src/integrity/prior-turn-evidence/check.js';
import { beginIntegrityRun } from '../../src/integrity/disposition/lifecycle.js';
import { evidenceFromHistory } from '../../src/core/agent/evidence/evidenceIndex.js';
import {
  buildEvidenceCorrection,
  evidenceRefusalSentence,
} from '../../src/core/agent/evidence/gate.js';
import { Agent, allow, defineTool, deny } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMMessage } from '../../src/adapters/types.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';
import type { ContextError } from '../../src/integrity/finding/types.js';

// The anonymized field case, as fixture vocabulary. A storage agent asks an
// inventory tool what exists, then — turns later — is asked something else.
const ARRAY = 'SHPMAXDLVAP001';
const CAPACITY = 41200;
const IOPS = 98765;
const INVENTORY = JSON.stringify({
  arrays: [{ name: ARRAY, capacity_gb: CAPACITY, serial: '0x5f2a91' }],
});

/** A reading of the field case: three values, none of them this turn's. */
const fieldCase: AnswerGroundingReading = {
  fromThisTurn: 0,
  fromPriorTurns: 3,
  latestPriorTurn: 1,
  currentTurn: 3,
  toolResultsThisTurn: 0,
  indexTruncated: false,
};

// ---------------------------------------------------------------------------
// The claim, on its own
// ---------------------------------------------------------------------------

describe('unit: the claim — grounded, and not one value from the turn being answered', () => {
  it('the field case: one advisory naming the count, the source turn and the distance', () => {
    const { findings, disposition } = priorTurnEvidenceOf(fieldCase, 2);
    expect(disposition).toBe('checked-fail');
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.kind).toBe('prior-turn-evidence');
    expect(f.seam).toBe('claim');
    expect(f.advisory).toBe(true);
    expect(f.subjects).toEqual([{ kind: 'answer', id: 'final' }]);
    expect(f.predicate).toBe('grounding');
    expect(f.message).toContain('3 value(s)');
    expect(f.message).toContain('turn 1');
    expect(f.message).toContain('at least 2 turn(s)');
    // The strong tell rides as a clause, not as a second kind.
    expect(f.message).toContain('called no tool and served no result');
  });

  it('THE NEUTRALIZE-PROOF: with the turn stamp removed the field case goes silent', () => {
    // What `evidenceFromHistory` would produce if it stopped counting user
    // turns: every form reads as the current turn's. This is the shape of the
    // regression the whole feature is one number away from.
    const neutralized: AnswerGroundingReading = {
      ...fieldCase,
      fromThisTurn: fieldCase.fromPriorTurns,
      fromPriorTurns: 0,
      latestPriorTurn: undefined,
    };
    const { findings, disposition } = priorTurnEvidenceOf(neutralized, 2);
    expect(disposition).toBe('checked-pass');
    expect(findings).toEqual([]);
  });

  it('ONE value from this turn is enough to file nothing — the follow-up exemption', () => {
    // The claim is "EVERY value came from before this turn". One that did not
    // falsifies it, so this is not a threshold to tune.
    const { findings, disposition } = priorTurnEvidenceOf(
      { ...fieldCase, fromThisTurn: 1, fromPriorTurns: 2, toolResultsThisTurn: 1 },
      2,
    );
    expect(disposition).toBe('checked-pass');
    expect(findings).toEqual([]);
  });

  it('a turn that DID fetch says so — same kind, a different sentence', () => {
    const f = priorTurnEvidenceOf({ ...fieldCase, toolResultsThisTurn: 2 }, 2).findings[0]!;
    expect(f.kind).toBe('prior-turn-evidence');
    expect(f.message).toContain('served 2 tool result(s)');
    expect(f.message).not.toContain('called no tool');
  });

  it('THE CEILING rides every message verbatim', () => {
    for (const reading of [fieldCase, { ...fieldCase, toolResultsThisTurn: 4 }]) {
      expect(priorTurnEvidenceOf(reading, 1).findings[0]!.message).toContain(
        PRIOR_TURN_EVIDENCE_CEILING,
      );
    }
    // And it says the three things the check cannot know.
    expect(PRIOR_TURN_EVIDENCE_CEILING).toContain('indistinguishable');
    expect(PRIOR_TURN_EVIDENCE_CEILING).toContain('live window');
    expect(PRIOR_TURN_EVIDENCE_CEILING).toContain('exempt from grounding');
  });
});

describe('negative: what the check refuses to judge', () => {
  it('a TRUNCATED index files nothing — provenance from a half-read corpus is not evidence', () => {
    const out = priorTurnEvidenceOf({ ...fieldCase, indexTruncated: true }, 1);
    expect(out).toEqual({ findings: [], disposition: 'not-applicable' });
  });

  it('NO BOUNDARY in the conversation is unreachable, never a pass', () => {
    const out = priorTurnEvidenceOf({ ...fieldCase, currentTurn: 0 }, 1);
    expect(out).toEqual({ findings: [], disposition: 'unreachable' });
  });

  it('an answer with NO grounded value is unreachable — nothing to attribute', () => {
    const out = priorTurnEvidenceOf(
      { ...fieldCase, fromThisTurn: 0, fromPriorTurns: 0, latestPriorTurn: undefined },
      1,
    );
    expect(out).toEqual({ findings: [], disposition: 'unreachable' });
  });
});

// ---------------------------------------------------------------------------
// The index's stamps
// ---------------------------------------------------------------------------

describe('unit: the index stamps the turn that served each form', () => {
  const history: readonly LLMMessage[] = [
    { role: 'user', content: 'what arrays are there?' },
    { role: 'tool', content: INVENTORY },
    { role: 'assistant', content: 'one array.' },
    { role: 'user', content: 'how is performance?' },
    { role: 'tool', content: JSON.stringify({ iops: IOPS }) },
  ];

  it('turn 1 served the inventory, turn 2 served the perf reading', () => {
    const corpus = evidenceFromHistory(history);
    expect(corpus.currentTurn).toBe(2);
    expect(corpus.toolResultsThisTurn).toBe(1);
    expect(corpus.values.get(String(CAPACITY))).toBe(1);
    expect(corpus.values.get(String(IOPS))).toBe(2);
    expect(corpus.values.get(ARRAY.toLowerCase())).toBe(1);
  });

  it('a form served AGAIN is re-stamped with the newer turn — newest wins', () => {
    // The property that makes an ordinary follow-up quiet for free: a lookup
    // keyed on an earlier identifier echoes it back, and the echo is this
    // turn's.
    const echoed = evidenceFromHistory([
      ...history,
      { role: 'tool', content: JSON.stringify({ name: ARRAY }) },
    ]);
    expect(echoed.values.get(ARRAY.toLowerCase())).toBe(2);
  });

  it("the library's OWN correction is not a turn boundary", () => {
    // The evidence recheck appends a `role: 'user'` frame mid-run. Counting
    // it would push this turn's own results into the earlier bucket and file
    // against every revised answer.
    const [, correction] = buildEvidenceCorrection('bad answer', [
      { value: '9999', shape: 'number' },
    ]);
    const corpus = evidenceFromHistory([
      { role: 'user', content: 'what arrays are there?' },
      { role: 'tool', content: INVENTORY },
      { role: 'assistant', content: 'bad answer' },
      correction,
    ]);
    expect(corpus.currentTurn).toBe(1);
    expect(corpus.values.get(String(CAPACITY))).toBe(1);
  });

  it('a history with no user turn has no boundary — turn 0, and nothing can be earlier', () => {
    const corpus = evidenceFromHistory([{ role: 'tool', content: INVENTORY }]);
    expect(corpus.currentTurn).toBe(0);
    expect(corpus.values.get(String(CAPACITY))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The gate's sentences — the half of this change that is a bug fix
// ---------------------------------------------------------------------------

describe('contract: the gate no longer claims a scope its index does not have', () => {
  const values = [{ value: '0xef0101', shape: 'identifier' }];

  it('the correction sent to the MODEL says what the run read, not what this turn read', () => {
    const [, correction] = buildEvidenceCorrection('an answer', values);
    expect(correction.content).toContain('appear in NO tool result this run read');
    expect(correction.content).not.toContain('from this turn');
  });

  it('the warning printed to the OPERATOR says the same, and names the window', () => {
    for (const posture of ['assist', 'rails'] as const) {
      const sentence = evidenceRefusalSentence(values, posture, false);
      expect(sentence).toContain('appear in no tool result this run read');
      expect(sentence).not.toContain('from this turn');
      // And it points at the dial that DOES answer the recency question.
      expect(sentence).toContain('noticePriorTurnEvidence');
      expect(sentence).toContain('live window');
    }
  });
});

// ---------------------------------------------------------------------------
// Both multi-turn cases, through the real loop
// ---------------------------------------------------------------------------

const inventory = () =>
  defineTool({
    name: 'array_inventory',
    description: 'List the arrays.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => INVENTORY,
  });

const perf = () =>
  defineTool({
    name: 'perf_stats',
    description: 'Read performance counters.',
    inputSchema: { type: 'object', properties: {} },
    // Deliberately does NOT echo the array name: the follow-up must be
    // exempted by the value it fetched THIS turn, not by an accidental echo.
    execute: async () => JSON.stringify({ iops: IOPS }),
  });

const call = (id: string, name: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});
const answer = (content: string) => ({ content, toolCalls: [], stopReason: 'stop' as const });

const TURN_1_ANSWER = `Array ${ARRAY} holds ${CAPACITY} GB.`;
/** The field case: turn two states turn one's values and fetched nothing. */
const STALE_ANSWER = `${ARRAY} is at ${CAPACITY} GB — enable the perf collector.`;
/** The honest follow-up: turn one's capacity BESIDE a number it fetched now. */
const FOLLOW_UP_ANSWER = `${ARRAY} is running ${IOPS} IOPS against ${CAPACITY} GB.`;

interface TwoTurns {
  readonly findings: ContextError[];
  readonly rows: CheckReport[];
  readonly answer: string;
}

/**
 * Two real turns of one conversation: turn one fetches the inventory, turn
 * two is a DIFFERENT question. `followUp` is the public continuation door, so
 * turn two's history really carries turn one's tool result.
 */
async function twoTurns(opts: {
  readonly secondTurn: readonly ReturnType<typeof answer>[];
  readonly notice?: boolean;
  readonly tools?: readonly ReturnType<typeof inventory>[];
}): Promise<TwoTurns> {
  const findings: ContextError[] = [];
  let rows: CheckReport[] = [];
  const agent = Agent.create({
    provider: mock({
      replies: [call('c1', 'array_inventory'), answer(TURN_1_ANSWER), ...opts.secondTurn],
    }),
    model: 'mock',
    maxIterations: 6,
    ...(opts.notice === true && { noticePriorTurnEvidence: true }),
  })
    .system('You are a storage assistant.')
    .tool(inventory())
    .tool(perf())
    .namesAndNumbersFromEvidence()
    .build();
  agent.on('agentfootprint.integrity.context_error', (e) => {
    findings.push(e.payload as unknown as ContextError);
  });
  agent.on('agentfootprint.integrity.disposition', (e) => {
    rows = e.payload.rows as CheckReport[];
  });
  await agent.run('what arrays are there?');
  const second = await agent.followUp('how is array performance?');
  return { findings, rows, answer: String(second) };
}

const recencyRow = (rows: CheckReport[]): CheckReport =>
  rows.find((r) => r.check === 'prior-turn-evidence' && r.seam === 'claim')!;
const mine = (findings: ContextError[]): ContextError[] =>
  findings.filter((f) => f.kind === 'prior-turn-evidence');

describe('functional: the field case, through the real loop', () => {
  it('THE FIELD CASE — a second turn that fetched nothing, answering from turn one', async () => {
    const out = await twoTurns({ secondTurn: [answer(STALE_ANSWER)], notice: true });
    const found = mine(out.findings);
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.seam).toBe('claim');
    expect(f.advisory).toBe(true);
    expect(f.message).toContain('turn 1');
    expect(f.message).toContain('called no tool and served no result');
    expect(f.message).toContain(PRIOR_TURN_EVIDENCE_CEILING);
    // The answer is UNTOUCHED — this reports, it never intervenes.
    expect(out.answer).toBe(STALE_ANSWER);
    // And the evidence gate is still happy: every value IS grounded. That is
    // the whole point — the old rails all pass, which is why nothing noticed.
    expect(out.findings.some((x) => x.kind === 'unsupported-claim')).toBe(false);
    expect(recencyRow(out.rows)).toMatchObject({ checked: 1, findings: 1, unreachable: 0 });
    expect(recencyRow(out.rows).lastFiredAt).toBeDefined();
  });

  it('THE TEST THAT MATTERS — an honest follow-up that ALSO calls a tool files nothing', async () => {
    // Turn two asks a new question, calls `perf_stats`, and its answer leans
    // on turn one's capacity beside the IOPS it just fetched. The tool's
    // result does not echo the array name, so the ONLY thing keeping this
    // quiet is the rule that one value from this turn is enough. Remove that
    // rule and this test reds — which is the design's falsification.
    const out = await twoTurns({
      secondTurn: [call('c2', 'perf_stats'), answer(FOLLOW_UP_ANSWER)],
      notice: true,
    });
    expect(mine(out.findings)).toEqual([]);
    expect(out.answer).toBe(FOLLOW_UP_ANSWER);
    // The check RAN and passed — a real comparison, not a skip.
    expect(recencyRow(out.rows)).toMatchObject({ checked: 1, findings: 0, unreachable: 0 });
  });

  it('a turn grounded ENTIRELY in its own results files nothing', async () => {
    const findings: ContextError[] = [];
    let rows: CheckReport[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'array_inventory'), answer(TURN_1_ANSWER)] }),
      model: 'mock',
      maxIterations: 6,
      noticePriorTurnEvidence: true,
    })
      .system('s')
      .tool(inventory())
      .namesAndNumbersFromEvidence()
      .build();
    agent.on('agentfootprint.integrity.context_error', (e) => {
      findings.push(e.payload as unknown as ContextError);
    });
    agent.on('agentfootprint.integrity.disposition', (e) => {
      rows = e.payload.rows as CheckReport[];
    });
    const out = await agent.run('what arrays are there?');
    expect(String(out)).toBe(TURN_1_ANSWER);
    expect(mine(findings)).toEqual([]);
    expect(recencyRow(rows)).toMatchObject({ checked: 1, findings: 0 });
  });
});

describe('zero-delta: the dial absent', () => {
  it('the SAME two turns without the dial file NO finding of this kind — the key is absent', async () => {
    const on = await twoTurns({ secondTurn: [answer(STALE_ANSWER)], notice: true });
    const off = await twoTurns({ secondTurn: [answer(STALE_ANSWER)] });
    expect(mine(on.findings)).toHaveLength(1);
    // The ABSENCE of the kind, not an undefined field: nothing on the wire
    // carries it at all.
    expect(off.findings.map((f) => f.kind)).not.toContain('prior-turn-evidence');
    expect(off.answer).toBe(on.answer);
  });

  it('the dial off is a registered NOT-APPLICABLE row, never a missing one', async () => {
    const off = await twoTurns({ secondTurn: [answer(STALE_ANSWER)] });
    expect(recencyRow(off.rows)).toMatchObject({
      check: 'prior-turn-evidence',
      seam: 'claim',
      checked: 0,
      findings: 0,
      notApplicable: 1,
      unreachable: 0,
    });
  });

  it('the dial on with NO evidence gate stays unarmed — two halves, both required', async () => {
    // The gate owns the extractor that decides which tokens are values, so a
    // dial without it has nothing whose provenance it could read.
    let rows: CheckReport[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'array_inventory'), answer(TURN_1_ANSWER)] }),
      model: 'mock',
      maxIterations: 4,
      noticePriorTurnEvidence: true,
    })
      .system('s')
      .tool(inventory())
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      rows = e.payload.rows as CheckReport[];
    });
    await agent.run('go');
    expect(recencyRow(rows)).toMatchObject({ checked: 0, findings: 0, notApplicable: 1 });
  });
});

describe('contract: an armed row is never left untouched', () => {
  // `assertAlive` reads an armed row nobody noted as wiring rot, and in dev
  // posture that is a CheckerDeadError on a healthy run. Three terminal exits
  // hand a caller something without the gate ever producing a grounding
  // reading; each has to SAY so. Completing these runs at all is half the
  // assertion.
  const runDev = async (
    replies: readonly ReturnType<typeof answer>[],
    build?: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  ): Promise<{ rows: CheckReport[]; threw: boolean }> => {
    let rows: CheckReport[] = [];
    const base = Agent.create({
      provider: mock({ replies: [...replies] }),
      model: 'mock',
      maxIterations: 4,
      noticePriorTurnEvidence: true,
      integrityPosture: 'dev',
    })
      .system('s')
      .tool(inventory())
      .namesAndNumbersFromEvidence();
    const agent = (build ? build(base) : base).build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      rows = e.payload.rows as CheckReport[];
    });
    // A denial raises at the boundary (a `MessageDeniedError`, by design);
    // the disposition event still files on the finally path, which is the row
    // this suite is about. Whether it threw is itself an assertion below.
    let threw = false;
    await agent.run('go').catch(() => {
      threw = true;
    });
    return { rows, threw };
  };

  it('AN EMPTY ANSWER files unreachable — and the dev-posture run does NOT throw', async () => {
    // `assertAlive` throws CheckerDeadError when `workExisted && touched === 0`,
    // and an empty answer means `llmLatestContent` is `''` — work existed. So
    // completing this run at all is the first half of the assertion: without
    // the note, a healthy run is reported as wiring rot.
    const { rows, threw } = await runDev([call('c1', 'array_inventory'), answer('')]);
    expect(threw).toBe(false);
    expect(recencyRow(rows)).toMatchObject({ checked: 0, findings: 0, unreachable: 1 });
  });

  it('A DENIED ANSWER files not-applicable — nobody receives it, so there is no provenance to report', async () => {
    // (A denial raises `MessageDeniedError`, so `assertAlive` — success path
    // only — never sees this run. The row is filed anyway: the disposition
    // report is what a reader consults, and an armed check silent in it is
    // the ambiguity this family exists to remove.)
    const { rows } = await runDev([call('c1', 'array_inventory'), answer(TURN_1_ANSWER)], (b) =>
      b.messageMiddleware({
        name: 'withhold',
        onMessage: (msg) => (msg.phase === 'output' ? deny('policy') : allow()),
      }),
    );
    expect(recencyRow(rows)).toMatchObject({ checked: 0, findings: 0, notApplicable: 1 });
  });
});

describe('contract: registration and the canary', () => {
  it('registered whether or not it is armed — an unarmed check is a ROW, never silence', () => {
    const off = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: false },
      'observe',
    );
    const row = recencyRow(off.report() as CheckReport[]);
    expect(row).toMatchObject({ checked: 0, findings: 0, notApplicable: 1 });
  });

  it('dev posture proves the pure function still catches its own synthetic case', () => {
    const dev = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: false, priorTurnEvidence: true },
      'dev',
    );
    expect(recencyRow(dev.report() as CheckReport[]).synthetic).toBe(1);
  });
});

describe('negative: the dial refuses what it cannot honour', () => {
  it('a non-boolean is refused where it is configured, naming what it arms', () => {
    expect(() =>
      Agent.create({
        provider: mock({ replies: [answer('x')] }),
        model: 'mock',
        noticePriorTurnEvidence: 'yes' as unknown as boolean,
      }).build(),
    ).toThrow(/noticePriorTurnEvidence must be a boolean/);
  });
});
