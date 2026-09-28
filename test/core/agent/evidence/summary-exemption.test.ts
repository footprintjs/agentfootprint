/**
 * A compaction summary exempts nothing by itself.
 *
 * Pattern: Test-as-specification — unit over the pure corpus functions, one
 *          scenario on a real folding agent.
 * Role:    Pin the law in `src/core/agent/evidence/README.md` § "A compaction
 *          summary exempts nothing by itself":
 *
 *   • the summary's TEXT is never in the exempt corpus (the audit probe);
 *   • the fold's LINEAGE (`LLMMessage.foldedExempt`, taken from the folded
 *     originals by `exemptLineageOf`) keeps a person's value exempt, through a
 *     nested fold and a restore;
 *   • an invented summary value is checked by the gate, end to end;
 *   • a summary echo of a value whose only carrier is set aside (open, noise,
 *     ruled-out) does not skip the contingent check;
 *   • correction frames stay non-exempt; a history with no summary builds the
 *     corpus it always did;
 *   • the lineage never reaches a provider.
 *
 * Test types (Convention 3): unit / integration (the folding agent) /
 * regression (the probe) / documentation (the README example, verbatim).
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../../../src/index.js';
import { defineTool } from '../../../../src/core/tools.js';
import type { LLMMessage, LLMProvider, LLMRequest } from '../../../../src/adapters/types.js';
import {
  evidenceFromHistory,
  exemptFromRun,
  exemptLineageOf,
} from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { checkAnswer, resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import { EVIDENCE_CHECK_FRAME_PREFIX } from '../../../../src/core/agent/evidence/frames.js';
import { lookupForms, normalizeToken } from '../../../../src/core/agent/evidence/normalize.js';
import { buildSummaryMessage } from '../../../../src/core/agent/window/summarize.js';
import { stripFrameworkFields } from '../../../../src/core/agent/composeRequest.js';
import {
  contingentRowsOf,
  groundedArgumentValues,
} from '../../../../src/core/agent/findings/contingent.js';
import { foldLedger } from '../../../../src/core/agent/findings/ledger.js';
import type { FindingsLedger, StandingRow } from '../../../../src/core/agent/findings/types.js';

const GATE = resolveEvidenceGate();
const FACTS = {
  foldedMessageCount: 2,
  iteration: 3,
  model: 'audit-mock',
  retain: 'conversation',
} as const;

const has = (set: ReadonlySet<string>, value: string): boolean =>
  [...lookupForms(normalizeToken(value))].some((f) => set.has(f));

const flagged = (answer: string, history: readonly LLMMessage[]): string[] =>
  checkAnswer(answer, {
    gate: GATE,
    evidence: evidenceFromHistory(history),
    exempt: exemptFromRun({ history }),
  }).unsupported.map((u) => u.value);

describe('the summary TEXT exempts nothing', () => {
  it('the audit probe: an invented value in a summary is not exempt', () => {
    const exempt = exemptFromRun({
      history: [buildSummaryMessage('Synthetic audit example: invented-987654.', FACTS)],
    });
    expect(exempt.has('invented-987654')).toBe(false);
    expect(has(exempt, 'invented-987654')).toBe(false);
  });

  it('an answer that repeats an invented summary value is flagged by the gate', () => {
    const history: LLMMessage[] = [
      { role: 'user', content: 'Which array is degraded?' },
      buildSummaryMessage('Earlier lookups found array ARR-4417 degraded.', FACTS),
    ];
    expect(flagged('Array ARR-4417 is degraded.', history)).toEqual([normalizeToken('ARR-4417')]);
  });

  it('a frame without lineage (hand-built, or folded before the field) exempts nothing', () => {
    const restored = JSON.parse(
      JSON.stringify(buildSummaryMessage('The user named ARR-2291.', FACTS)),
    ) as LLMMessage;
    expect(restored.foldedExempt).toBeUndefined();
    expect(has(exemptFromRun({ history: [restored] }), 'ARR-2291')).toBe(false);
  });
});

describe('the fold LINEAGE keeps what the folded turns exempted', () => {
  const folded: LLMMessage[] = [
    { role: 'user', content: 'Check array ARR-2291 please.' },
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'probe', args: {} }] },
    { role: 'tool', content: '{"array":"ARR-7003"}', toolCallId: 't1', toolName: 'probe' },
  ];

  it('the README example: a person value rides the lineage; a tool value does not', () => {
    const lineage = exemptLineageOf(folded);
    expect(lineage).toContain(normalizeToken('ARR-2291'));
    expect(lineage.some((f) => [...lookupForms(normalizeToken('ARR-7003'))].includes(f))).toBe(
      false,
    );
    const frame = buildSummaryMessage('The user asked about ARR-2291.', {
      ...FACTS,
      foldedExempt: lineage,
    });
    expect(has(exemptFromRun({ history: [frame] }), 'ARR-2291')).toBe(true);
    expect(flagged('ARR-2291 is fine.', [frame])).toEqual([]);
  });

  it('a faithfully summarized person value stays exempt after a restore (JSON round trip)', () => {
    const frame = buildSummaryMessage('The user asked about ARR-2291.', {
      ...FACTS,
      retain: 'discard',
      foldedExempt: exemptLineageOf(folded),
    });
    const restored = JSON.parse(JSON.stringify(frame)) as LLMMessage;
    expect(has(exemptFromRun({ history: [restored] }), 'ARR-2291')).toBe(true);
  });

  it('a nested fold carries the inner lineage, never the inner summary text', () => {
    const inner = buildSummaryMessage('Invented INV-5555 and the user asked about ARR-2291.', {
      ...FACTS,
      foldedExempt: exemptLineageOf(folded),
    });
    const outerLineage = exemptLineageOf([inner, { role: 'user', content: 'and SW-0042?' }]);
    const outer = buildSummaryMessage('Two questions so far.', {
      ...FACTS,
      foldedExempt: outerLineage,
    });
    const exempt = exemptFromRun({ history: [outer] });
    expect(has(exempt, 'ARR-2291')).toBe(true);
    expect(has(exempt, 'SW-0042')).toBe(true);
    expect(has(exempt, 'INV-5555')).toBe(false);
  });

  it('a summarized tool value keeps its tool source: grounded only while its result is in the window', () => {
    const frame = buildSummaryMessage('probe returned ARR-7003.', {
      ...FACTS,
      foldedExempt: exemptLineageOf(folded),
    });
    // The result was folded away: the value is judged, and nothing grounds it.
    expect(flagged('ARR-7003 is up.', [frame])).toEqual([normalizeToken('ARR-7003')]);
    // The same value with its result still in the window: grounded by the tool.
    expect(flagged('ARR-7003 is up.', [frame, folded[1]!, folded[2]!])).toEqual([]);
  });
});

describe('the contingent check is not skipped by a summary echo', () => {
  const standing = (toolCallId: string, kind: StandingRow['standing']): StandingRow => ({
    kind: 'standing',
    toolCallId,
    standing: kind,
    assertions: [],
    declaredOn: { toolCallId: 'c9' },
    iteration: 2,
  });

  for (const kind of ['open', 'noise', 'ruled-out'] as const) {
    it(`a value whose only carrier is ${kind} files a contingent row despite the echo`, () => {
      // The frame lands where a fold puts it: after the current request,
      // before the kept tail.
      const history: LLMMessage[] = [
        { role: 'user', content: 'find the port' },
        buildSummaryMessage('The port is fc1/7.', FACTS),
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'probe', args: {} }] },
        { role: 'tool', content: '{"port":"fc1/7"}', toolCallId: 'c1', toolName: 'probe' },
      ];
      const corpus = evidenceFromHistory(history);
      const exempt = exemptFromRun({ history });
      const values = groundedArgumentValues({ port: 'fc1/7' }, GATE, corpus, exempt);
      expect(values.map((v) => v.value)).toEqual(['fc1/7']);
      const { standingOf } = foldLedger([standing('c1', kind)] as FindingsLedger);
      const rows = contingentRowsOf(values, corpus, standingOf, 'answer', 3);
      expect(rows.map((r) => [r.value, r.carriers])).toEqual([
        ['fc1/7', [{ toolCallId: 'c1', standing: kind }]],
      ]);
    });
  }
});

describe('what did not move', () => {
  it('correction frames stay non-exempt', () => {
    const history: LLMMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'user', content: `${EVIDENCE_CHECK_FRAME_PREFIX}] VOL-XYZ-9999 appears nowhere.` },
    ];
    expect(has(exemptFromRun({ history }), 'VOL-XYZ-9999')).toBe(false);
  });

  it('a history with no summary builds the same corpus', () => {
    const history: LLMMessage[] = [
      { role: 'system', content: 'Escalate to Q-4471-OPS.' },
      { role: 'user', content: 'Check ARR-2291.' },
      { role: 'tool', content: '{"a":"ARR-7003"}', toolCallId: 't', toolName: 'p' },
    ];
    const expected = new Set([
      ...exemptLineageOf([history[0]!]),
      ...exemptLineageOf([history[1]!]),
    ]);
    expect(exemptFromRun({ history })).toEqual(expected);
  });

  it('the lineage never reaches a provider', () => {
    const frame = buildSummaryMessage('x', { ...FACTS, foldedExempt: ['arr-2291'] });
    expect(frame.foldedExempt).toEqual(['arr-2291']);
    const [wire] = stripFrameworkFields([frame]);
    expect(wire).toEqual({ role: 'user', content: frame.content });
    // A fold with nothing exempt stamps no field at all.
    expect('foldedExempt' in buildSummaryMessage('x', { ...FACTS, foldedExempt: [] })).toBe(false);
  });
});

// ─── integration — a real folding agent ─────────────────────────────

describe('SCENARIO — a folding agent whose summarizer invents a value', () => {
  it('the answer that repeats it is flagged; the wire never carries the lineage', async () => {
    const requests: LLMRequest[] = [];
    let call = 0;
    const main: LLMProvider = {
      name: 'mock',
      complete: async (req) => {
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        call++;
        const wantsTool = call <= 4;
        return {
          content: wantsTool ? '' : 'Array INV-987654 is degraded.',
          toolCalls: wantsTool ? [{ id: `c${call}`, name: 'look', args: {} }] : [],
          usage: { input: 100 * call, output: 5 },
          stopReason: 'end_turn',
        };
      },
    };
    const summarizer: LLMProvider = {
      name: 'mock-summarizer',
      complete: async () => ({
        content: 'EARLIER: lookups found array INV-987654 degraded.',
        toolCalls: [],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      }),
    };
    let n = 0;
    const look = defineTool({
      name: 'look',
      description: 'look something up',
      inputSchema: { type: 'object', properties: {} },
      execute: () => `RESULT#${n++} ${'x'.repeat(400)}`,
    } as never);
    const agent = Agent.create({ provider: main, model: 'main-model', maxIterations: 8 })
      .tool(look as never)
      .compaction({
        thresholdTokens: 250,
        summarizer,
        model: 'summarizer-model',
        keepRecentTurns: 2,
      })
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    const rows: Record<string, unknown>[] = [];
    agent.on('agentfootprint.agent.evidence_checked', (e) =>
      rows.push(e.payload as unknown as Record<string, unknown>),
    );
    await agent.run({ message: 'Which array is degraded?' });

    const history = (agent.getLastSnapshot()?.sharedState as { history: LLMMessage[] }).history;
    expect(history.some((m) => m.content.includes('INV-987654') && m.role === 'user')).toBe(true);
    expect(rows.at(-1)).toMatchObject({ action: 'flagged' });
    for (const req of requests) {
      for (const m of req.messages) expect('foldedExempt' in m).toBe(false);
    }
  });
});
