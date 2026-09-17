/**
 * Unit tests — `findings/judge.ts` (9.104.0): the question a landed result
 * is judged under, and the row its answer becomes.
 *
 * Pattern: Test-as-specification (Convention 3):
 *   - unit:        `judgeQuestions` — the state, the two question ids, the criteria vocabulary
 *   - integration: `judgeResult` on a scope with a mock judge — the row through `recordFindings`
 *   - property:    the distribution on the row is the provider's, key for key
 *   - edge:        clip at JUDGE_RESULT_CHARS with the flag; `against: 'question'` with no basis
 *   - regression:  the PROBE — the model said ruled-out, the judge said noise 0.69 — is two rows
 *   - security:    the state text never reaches an event; a failure is a row, never a throw
 *   - documentation: the fold keeps `standingOf` the model's and `judgments` the judge's
 */

import { describe, expect, it } from 'vitest';
import { mockClassifier, ClassifierError } from '../../../../src/classify/index.js';
import type { ClassifyResult } from '../../../../src/classify/index.js';
import {
  JUDGE_QUESTION_IDS,
  STANDING_CRITERIA,
  judgeQuestions,
  judgeResult,
  type JudgeScope,
} from '../../../../src/core/agent/findings/judge.js';
import { foldLedger, recordFindings } from '../../../../src/core/agent/findings/ledger.js';
import {
  JUDGE_RESULT_CHARS,
  STANDING_VALUES,
  type BasisRow,
  type FindingsRow,
  type JudgmentErrorRow,
  type JudgmentRow,
  type StandingRow,
} from '../../../../src/core/agent/findings/types.js';

/** The 2026-09-17 probe, mapped as `typesafe()` maps it (latency measured by the adapter). */
const PROBE: ClassifyResult = {
  model: 'jev-1.13.0',
  answers: {
    standing: {
      type: 'choice',
      choice: 'noise',
      confidence: 0.59,
      probabilities: { fact: 0.0, noise: 0.69, open: 0.3, 'ruled-out': 0.01 },
    },
    tests_subject: { type: 'noul', noul: 0.19 },
  },
  usage: { inputTokens: 494, outputTokens: 68 },
  latencyMs: 212,
};

const BASIS: BasisRow = {
  kind: 'basis',
  toolCallId: 'c1',
  toolName: 'search_logs',
  iteration: 1,
  basis: 'exploratory',
  proposition: 'the optic was swapped during the maintenance window',
  predicts: 'a swap entry in the log',
};

function scopeWith(rows: readonly FindingsRow[] = [], userMessage = 'why is fc1/7 down?') {
  const events: { name: string; payload: unknown }[] = [];
  const scope: JudgeScope = {
    findingsLedger: rows,
    userMessage,
    $emit: (name, payload) => events.push({ name, payload }),
  };
  return { scope, events };
}

describe('judgeQuestions — the pure question', () => {
  it('asks two fixed questions: a choice over the four standings and a noul', () => {
    const q = judgeQuestions(BASIS, 'q', { toolName: 'search_logs', result: 'no entries' });
    expect(Object.keys(q.request.questions)).toEqual([
      JUDGE_QUESTION_IDS.standing,
      JUDGE_QUESTION_IDS.testsSubject,
    ]);
    const standing = q.request.questions.standing!;
    expect(standing.type).toBe('choice');
    if (standing.type === 'choice') {
      expect(Object.keys(standing.criteria)).toEqual([...STANDING_VALUES]);
      expect(standing.criteria).toEqual(STANDING_CRITERIA);
    }
    expect(q.request.questions.tests_subject!.type).toBe('noul');
  });

  it('the state carries the declared proposition and prediction, the question, the tool and the result', () => {
    const q = judgeQuestions(BASIS, 'why is fc1/7 down?', {
      toolName: 'search_logs',
      result: 'no entries',
    });
    expect(q.request.state).toEqual({
      proposition: BASIS.proposition,
      predicts: BASIS.predicts,
      question: 'why is fc1/7 down?',
      tool: 'search_logs',
      result: 'no entries',
    });
    expect(q.against).toBe('proposition');
    expect(q.clipped).toBe(false);
  });

  it("judges against the user's question when the call declared no proposition — and says so", () => {
    const bare: BasisRow = {
      kind: 'basis',
      toolCallId: 'c1',
      toolName: 't',
      iteration: 1,
      basis: 'direct',
    };
    for (const basis of [bare, undefined]) {
      const q = judgeQuestions(basis, 'the question', { toolName: 't', result: 'r' });
      expect(q.against).toBe('question');
      expect(q.request.state).toEqual({ question: 'the question', tool: 't', result: 'r' });
    }
  });

  it('cuts the result at JUDGE_RESULT_CHARS and reports the cut', () => {
    const long = 'x'.repeat(JUDGE_RESULT_CHARS + 1);
    const q = judgeQuestions(undefined, 'q', { toolName: 't', result: long });
    expect(q.clipped).toBe(true);
    expect((q.request.state as { result: string }).result).toHaveLength(JUDGE_RESULT_CHARS);
    const exact = judgeQuestions(undefined, 'q', {
      toolName: 't',
      result: 'x'.repeat(JUDGE_RESULT_CHARS),
    });
    expect(exact.clipped).toBe(false);
  });
});

describe('judgeResult — the row', () => {
  it('files a JudgmentRow field for field from the probe, through recordFindings', async () => {
    const judge = mockClassifier([PROBE]);
    const { scope, events } = scopeWith([BASIS]);
    await judgeResult(
      scope,
      judge,
      { toolName: 'search_logs', result: 'no entries', toolCallId: 'c1' },
      2,
    );
    const rows = scope.findingsLedger!;
    expect(rows.map((r) => r.kind)).toEqual(['basis', 'judgment']);
    expect(rows[1]).toEqual({
      kind: 'judgment',
      toolCallId: 'c1',
      toolName: 'search_logs',
      source: 'judge',
      judge: { name: 'mock', model: 'jev-1.13.0' },
      against: 'proposition',
      standing: 'noise',
      probabilities: { fact: 0, open: 0.3, noise: 0.69, 'ruled-out': 0.01 },
      confidence: 0.59,
      testsSubject: 0.19,
      usage: { inputTokens: 494, outputTokens: 68 },
      latencyMs: 212,
      iteration: 2,
    } satisfies JudgmentRow);
    // The judge was asked exactly the pure question.
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]).toEqual(
      judgeQuestions(BASIS, 'why is fc1/7 down?', { toolName: 'search_logs', result: 'no entries' })
        .request,
    );
    // One event, identities + numbers only — no state, no proposition, no probabilities.
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe('agentfootprint.findings.judged');
    expect(events[0]!.payload).toEqual({
      toolCallId: 'c1',
      toolName: 'search_logs',
      iteration: 2,
      against: 'proposition',
      standing: 'noise',
      confidence: 0.59,
      latencyMs: 212,
      inputTokens: 494,
      outputTokens: 68,
    });
  });

  it('THE PROBE DISAGREEMENT: the model said ruled-out, the judge said noise — two rows, no verdict', async () => {
    const own: StandingRow = {
      kind: 'standing',
      toolCallId: 'c1',
      toolName: 'search_logs',
      standing: 'ruled-out',
      line: 'the optic was not swapped this week',
      assertions: [],
      declaredOn: { toolCallId: 'c2' },
      iteration: 2,
    };
    const { scope, events } = scopeWith([BASIS, own]);
    await judgeResult(
      scope,
      mockClassifier([PROBE]),
      { toolName: 'search_logs', result: 'no entries', toolCallId: 'c1' },
      2,
    );
    const fold = foldLedger(scope.findingsLedger!);
    // The model's reading is untouched; the judge's sits beside it.
    expect(fold.standingOf.get('c1')?.standing).toBe('ruled-out');
    expect(fold.judgments.get('c1')?.standing).toBe('noise');
    expect(fold.judgments.get('c1')?.probabilities.noise).toBe(0.69);
    // The judged event carries NO `agrees`, ever — not even here, where a
    // standing happens to precede the judgment (a shape the loop never
    // produces: the judge files before the model call that declares).
    expect(events[0]!.payload).not.toHaveProperty('agrees');
    expect(scope.findingsLedger![2]).not.toHaveProperty('agrees');
  });

  it('`agrees` rides the STANDING event once a judgment exists: false on the probe disagreement, true on agreement, absent without a judgment', async () => {
    // The loop's order: the judgment lands, THEN the model declares.
    const { scope, events } = scopeWith([BASIS]);
    await judgeResult(
      scope,
      mockClassifier([PROBE]),
      { toolName: 't', result: 'r', toolCallId: 'c1' },
      2,
    );
    expect(events[0]!.name).toBe('agentfootprint.findings.judged');
    expect(events[0]!.payload).not.toHaveProperty('agrees');
    const disagreeing: StandingRow = {
      kind: 'standing',
      toolCallId: 'c1',
      toolName: 't',
      standing: 'ruled-out',
      assertions: [],
      declaredOn: { toolCallId: 'c2' },
      iteration: 2,
    };
    recordFindings(scope, [disagreeing]);
    expect(events[1]!.name).toBe('agentfootprint.findings.standing');
    expect((events[1]!.payload as { agrees?: boolean }).agrees).toBe(false);
    // A later standing that matches the judge's current judgment: true.
    recordFindings(scope, [
      { ...disagreeing, standing: 'noise', declaredOn: 'answer', iteration: 3 },
    ]);
    expect((events[2]!.payload as { agrees?: boolean }).agrees).toBe(true);
    // Never on a row: two sources, two rows, the comparison is the sink's.
    for (const row of scope.findingsLedger!) expect(row).not.toHaveProperty('agrees');
    // No judgment for the result (an unjudged id): no `agrees` at all.
    const bare = scopeWith([BASIS]);
    recordFindings(bare.scope, [disagreeing]);
    expect(bare.events[0]!.payload).not.toHaveProperty('agrees');
  });

  it('a second judgment on one result is a second row; the fold takes the last', async () => {
    const { scope } = scopeWith([BASIS]);
    const fact: ClassifyResult = {
      model: PROBE.model,
      latencyMs: 5,
      answers: {
        standing: {
          type: 'choice',
          choice: 'fact',
          confidence: 0.8,
          probabilities: { fact: 0.8, noise: 0.2 },
        },
      },
    };
    const judge = mockClassifier([PROBE, fact]);
    await judgeResult(scope, judge, { toolName: 't', result: 'r', toolCallId: 'c1' }, 2);
    await judgeResult(scope, judge, { toolName: 't', result: 'r', toolCallId: 'c1' }, 3);
    const rows = scope.findingsLedger!.filter((r) => r.kind === 'judgment') as JudgmentRow[];
    expect(rows.map((r) => r.standing)).toEqual(['noise', 'fact']);
    const last = foldLedger(scope.findingsLedger!).judgments.get('c1')!;
    expect(last.standing).toBe('fact');
    // A standing the provider did not score is ABSENT on the row, never zero.
    expect(last.probabilities).toEqual({ fact: 0.8, noise: 0.2 });
    expect(last).not.toHaveProperty('testsSubject');
    expect(last).not.toHaveProperty('usage');
  });

  it('marks the row `clipped` when the result was cut, and hands the judge the cut text', async () => {
    const judge = mockClassifier([PROBE]);
    const { scope } = scopeWith([]);
    const long = 'y'.repeat(JUDGE_RESULT_CHARS * 2);
    await judgeResult(scope, judge, { toolName: 't', result: long, toolCallId: 'c9' }, 1);
    const row = scope.findingsLedger![0] as JudgmentRow;
    expect(row.clipped).toBe(true);
    expect(row.against).toBe('question');
    expect((judge.calls[0]!.state as { result: string }).result).toHaveLength(JUDGE_RESULT_CHARS);
  });
});

describe('judgeResult — a failure is a row, never a throw and never a standing', () => {
  it('a ClassifierError files a JudgmentErrorRow with its status and message, and one event', async () => {
    const judge = mockClassifier(() => {
      throw new ClassifierError('typesafe: HTTP 529 — overloaded', {
        status: 529,
        retryable: true,
      });
    });
    const { scope, events } = scopeWith([BASIS]);
    await expect(
      judgeResult(scope, judge, { toolName: 'search_logs', result: 'r', toolCallId: 'c1' }, 2),
    ).resolves.toBeUndefined();
    const row = scope.findingsLedger![1] as JudgmentErrorRow;
    expect(row).toMatchObject({
      kind: 'judgment-error',
      toolCallId: 'c1',
      toolName: 'search_logs',
      source: 'judge',
      judge: { name: 'mock' },
      status: 529,
      message: 'typesafe: HTTP 529 — overloaded',
      iteration: 2,
    });
    expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    expect(row).not.toHaveProperty('standing');
    expect(foldLedger(scope.findingsLedger!).judgments.size).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe('agentfootprint.findings.judge_failed');
    expect(events[0]!.payload).toEqual({
      toolCallId: 'c1',
      toolName: 'search_logs',
      iteration: 2,
      status: 529,
      latencyMs: row.latencyMs,
    });
  });

  it('an answer outside the vocabulary, or without a choice under `standing`, is an error row', async () => {
    const outside: ClassifyResult = {
      ...PROBE,
      answers: { standing: { type: 'choice', choice: 'maybe', confidence: 1, probabilities: {} } },
    };
    const missing: ClassifyResult = {
      ...PROBE,
      answers: { tests_subject: { type: 'noul', noul: 1 } },
    };
    const { scope } = scopeWith([]);
    const judge = mockClassifier([outside, missing]);
    await judgeResult(scope, judge, { toolName: 't', result: 'r', toolCallId: 'a' }, 1);
    await judgeResult(scope, judge, { toolName: 't', result: 'r', toolCallId: 'b' }, 1);
    const rows = scope.findingsLedger as JudgmentErrorRow[];
    expect(rows.map((r) => r.kind)).toEqual(['judgment-error', 'judgment-error']);
    expect(rows[0]!.message).toContain('maybe');
    expect(rows[1]!.message).toContain("'standing'");
    expect(rows[0]).not.toHaveProperty('status');
  });

  it('an abort is an error row too — the run decides what an abort means, the judge only records it', async () => {
    const c = new AbortController();
    c.abort(new Error('run cancelled'));
    const { scope } = scopeWith([]);
    await judgeResult(
      scope,
      mockClassifier([PROBE]),
      { toolName: 't', result: 'r', toolCallId: 'a' },
      1,
      c.signal,
    );
    expect(scope.findingsLedger![0]).toMatchObject({
      kind: 'judgment-error',
      message: 'run cancelled',
    });
  });
});
