/**
 * `evidence_checked.lookedUp` — how many of the answer's values the gate
 * actually LOOKED UP.
 *
 * `candidates` counts every value the extractor found, including EXEMPT ones
 * — a value the person's message, the conversation or the app's own
 * instructions already held is skipped before any lookup. On the field
 * recording one of the two candidates (the array's name) was in the
 * question, so a report that said "looked up 2 values" would have claimed a
 * lookup that never happened. `lookedUp` = found + not found, before the
 * `unsupported` slice.
 *
 * Test types (Convention 3):
 *   - UNIT        — `checkAnswer`: exempt values are counted in `candidates`
 *                   and not in `lookedUp`; found + not found = `lookedUp`.
 *   - SCENARIO    — a real run on every emitter: `grounded`, `flagged`, and
 *                   the recheck branch's `revision-asked` row.
 *   - BYTE LAW    — an agent without the gate emits no `evidence_checked`
 *                   at all, so it gains no byte.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import {
  evidenceFromHistory,
  exemptFromRun,
} from '../../../src/core/agent/evidence/evidenceIndex.js';
import { checkAnswer, resolveEvidenceGate } from '../../../src/core/agent/evidence/gate.js';
import type { LLMMessage, LLMResponse } from '../../../src/adapters/types.js';

const QUESTION = 'what applications are running on powerstore SHPSTRPLPCL003';
const TOOL_RESULT = JSON.stringify({ volumes: [{ name: 'VOL-ORA-7731', app: 'oracle-erp' }] });

describe('UNIT — checkAnswer counts what it looked up', () => {
  const history: LLMMessage[] = [
    { role: 'user', content: QUESTION },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 't1', name: 'volumes_on', args: {} }],
    },
    { role: 'tool', content: TOOL_RESULT, toolCallId: 't1', toolName: 'volumes_on' },
  ];
  const check = (answer: string) =>
    checkAnswer(answer, {
      gate: resolveEvidenceGate(),
      evidence: evidenceFromHistory(history),
      exempt: exemptFromRun({ history, userMessage: QUESTION }),
    });

  it('an exempt value is a candidate, never a lookup', () => {
    const v = check('SHPSTRPLPCL003 hosts VOL-ORA-7731.');
    expect(v.candidates).toBe(2);
    expect(v.lookedUp).toBe(1);
    expect(v.unsupported).toEqual([]);
  });

  it('found + not found = lookedUp', () => {
    const v = check('SHPSTRPLPCL003 hosts VOL-ORA-7731 and VOL-XYZ-9999.');
    expect(v.candidates).toBe(3);
    expect(v.lookedUp).toBe(2);
    expect(v.lookedUp).toBe(v.grounded.length + v.unsupported.length);
  });

  it('every value exempt → 0 looked up', () => {
    const v = check('SHPSTRPLPCL003 was asked about.');
    expect(v.candidates).toBe(1);
    expect(v.lookedUp).toBe(0);
  });
});

function run(answers: readonly string[], posture?: 'assist' | 'guard') {
  const replies: Partial<LLMResponse>[] = [
    { toolCalls: [{ id: 't1', name: 'volumes_on', args: {} }] },
    ...answers.map((content) => ({ content })),
  ];
  const tool = defineTool({
    name: 'volumes_on',
    description: 'volumes on an array',
    inputSchema: { type: 'object', properties: {} },
    execute: () => JSON.parse(TOOL_RESULT) as unknown,
  });
  let builder = Agent.create({ provider: mock({ replies }), model: 'mock' }).tool(tool);
  if (posture !== undefined) builder = builder.namesAndNumbersFromEvidence({ posture });
  const agent = builder.build();
  const rows: Record<string, unknown>[] = [];
  agent.on('agentfootprint.agent.evidence_checked', (e) =>
    rows.push(e.payload as unknown as Record<string, unknown>),
  );
  return { agent, rows };
}

describe('SCENARIO — every emitter carries it', () => {
  it('grounded: one of two candidates was in the question', async () => {
    const { agent, rows } = run(['SHPSTRPLPCL003 hosts VOL-ORA-7731.'], 'assist');
    await agent.run({ message: QUESTION });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'grounded', candidates: 2, lookedUp: 1 });
  });

  it('flagged under assist', async () => {
    const { agent, rows } = run(['SHPSTRPLPCL003 hosts VOL-XYZ-9999.'], 'assist');
    await agent.run({ message: QUESTION });
    expect(rows[0]).toMatchObject({ action: 'flagged', candidates: 2, lookedUp: 1 });
  });

  it('revision-asked (the recheck branch) and the verdict after it', async () => {
    const { agent, rows } = run(
      ['SHPSTRPLPCL003 hosts VOL-XYZ-9999.', 'SHPSTRPLPCL003 hosts VOL-ORA-7731.'],
      'guard',
    );
    await agent.run({ message: QUESTION });
    expect(rows.map((r) => [r.action, r.lookedUp])).toEqual([
      ['revision-asked', 1],
      ['grounded', 1],
    ]);
  });

  it('BYTE LAW — no gate, no evidence_checked, no new byte', async () => {
    const { agent, rows } = run(['SHPSTRPLPCL003 hosts VOL-ORA-7731.']);
    await agent.run({ message: QUESTION });
    expect(rows).toEqual([]);
  });
});
