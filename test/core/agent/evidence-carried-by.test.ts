/**
 * `evidence_checked.carriedBy` — which of THIS turn's results the answer's
 * names and numbers were read from.
 *
 * The field case: a follow-up turn fetched a second result and then answered
 * from a computation over the FIRST — the host put both under the answer as
 * "its data", and the one the answer cited nothing from read as if the answer
 * stood on it. The host could not tell them apart: the extractor, the
 * spellings and the carriers are the library's. `carriedBy` says it, as
 * identities and counts.
 *
 * Test types (Convention 3):
 *   - UNIT        — `answerCarriersOf`: per-result counts, `only`, one count
 *                   per value across spellings, the whole list or none.
 *   - SCENARIO    — a real run: two results, the answer cites one; a result
 *                   not listed carried nothing the answer states.
 *   - BOUNDARY    — a value carried by more results than the index keeps →
 *                   the field is absent, never a prefix.
 *   - BYTE LAW    — no gate → no `evidence_checked`, no new byte; a draft
 *                   sent back (`revision-asked`) carries no `carriedBy`.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { answerCarriersOf } from '../../../src/core/agent/evidence/answerCarriers.js';
import {
  evidenceFromHistory,
  MAX_CARRIERS,
} from '../../../src/core/agent/evidence/evidenceIndex.js';
import type { LLMMessage, LLMResponse } from '../../../src/adapters/types.js';

const QUESTION = 'which hosts had slow creates in that window';

function corpusOf(results: readonly { id: string; content: string }[]) {
  const history: LLMMessage[] = [
    { role: 'user', content: QUESTION },
    {
      role: 'assistant',
      content: '',
      toolCalls: results.map((r) => ({ id: r.id, name: 'probe', args: {} })),
    },
    ...results.map(
      (r): LLMMessage => ({
        role: 'tool',
        content: r.content,
        toolCallId: r.id,
        toolName: 'probe',
      }),
    ),
  ];
  return evidenceFromHistory(history);
}

describe('UNIT — answerCarriersOf', () => {
  const corpus = corpusOf([
    { id: 'c1', content: JSON.stringify({ host: 'HOST-7731', worst_ms: 4417 }) },
    { id: 'c2', content: JSON.stringify({ host: 'HOST-7731', other: 'HOST-9902' }) },
  ]);

  it('counts per result, and how many only that result carried', () => {
    const out = answerCarriersOf(
      [
        { value: 'host-7731', forms: ['host-7731'] },
        { value: '4417', forms: ['4417'] },
      ],
      corpus,
    );
    expect(out).toEqual([
      { toolCallId: 'c1', values: 2, only: 1 },
      { toolCallId: 'c2', values: 1, only: 0 },
    ]);
  });

  it('a result that carried none of the values is not listed; nothing grounded → []', () => {
    expect(answerCarriersOf([{ value: '4417', forms: ['4417'] }], corpus)).toEqual([
      { toolCallId: 'c1', values: 1, only: 1 },
    ]);
    expect(answerCarriersOf([], corpus)).toEqual([]);
  });

  it('two spellings of one value count once', () => {
    const wwn = corpusOf([{ id: 'c1', content: JSON.stringify({ port: '0xef0101' }) }]);
    const out = answerCarriersOf(
      [
        { value: '0xef0101', forms: ['0xef0101', 'ef0101'] },
        { value: 'ef0101', forms: ['ef0101'] },
      ],
      wwn,
    );
    expect(out).toEqual([{ toolCallId: 'c1', values: 1, only: 1 }]);
  });

  it('a truncated corpus gives no list at all', () => {
    expect(
      answerCarriersOf([{ value: '4417', forms: ['4417'] }], { ...corpus, truncated: true }),
    ).toBeUndefined();
  });
});

describe('BOUNDARY — a carrier list the index cut', () => {
  it('more carriers than the index keeps → undefined, never a prefix', () => {
    const many = Array.from({ length: MAX_CARRIERS + 1 }, (_, i) => ({
      id: `c${i}`,
      content: JSON.stringify({ host: 'HOST-7731' }),
    }));
    const corpus = corpusOf(many);
    expect(
      answerCarriersOf([{ value: 'host-7731', forms: ['host-7731'] }], corpus),
    ).toBeUndefined();
  });
});

const ACTIVITY = JSON.stringify({ rows: [{ host: 'HOST-7731', worst_ms: 4417 }] });
const HEALTH = JSON.stringify({ rows: [{ host: 'HOST-5560', worst_s: 12.5, intervals: 6120 }] });

function run(answers: readonly string[], posture: 'assist' | 'guard' | undefined) {
  const replies: Partial<LLMResponse>[] = [
    {
      toolCalls: [
        { id: 'a1', name: 'activity', args: {} },
        { id: 'h1', name: 'health', args: {} },
      ],
    },
    ...answers.map((content) => ({ content })),
  ];
  const tool = (name: string, body: string) =>
    defineTool({
      name,
      description: name,
      inputSchema: { type: 'object', properties: {} },
      execute: () => JSON.parse(body) as unknown,
    });
  let builder = Agent.create({ provider: mock({ replies }), model: 'mock' })
    .tool(tool('activity', ACTIVITY))
    .tool(tool('health', HEALTH));
  if (posture !== undefined) builder = builder.namesAndNumbersFromEvidence({ posture });
  const agent = builder.build();
  const rows: Record<string, unknown>[] = [];
  agent.on('agentfootprint.agent.evidence_checked', (e) =>
    rows.push(e.payload as unknown as Record<string, unknown>),
  );
  return { agent, rows };
}

describe('SCENARIO — the answer cites one of two results', () => {
  it('grounded: only the result it cited is listed', async () => {
    const { agent, rows } = run(['HOST-7731 was slowest at 4417 ms.'], 'assist');
    await agent.run({ message: QUESTION });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'grounded',
      carriedBy: [{ toolCallId: 'a1', values: 2, only: 2 }],
    });
  });

  it('flagged: still says where the grounded values came from', async () => {
    const { agent, rows } = run(['HOST-7731 was slowest at 9999 ms.'], 'assist');
    await agent.run({ message: QUESTION });
    expect(rows[0]).toMatchObject({
      action: 'flagged',
      carriedBy: [{ toolCallId: 'a1', values: 1, only: 1 }],
    });
  });

  it('an answer that states no value: [] — a fact, not an absence', async () => {
    const { agent, rows } = run(['One host was slow.'], 'assist');
    await agent.run({ message: QUESTION });
    expect(rows[0]).toMatchObject({ action: 'grounded', lookedUp: 0, carriedBy: [] });
  });
});

describe('BYTE LAW', () => {
  it('a draft sent back for revision carries no carriedBy; the verdict after it does', async () => {
    const { agent, rows } = run(['HOST-7731 at 9999 ms.', 'HOST-7731 at 4417 ms.'], 'guard');
    await agent.run({ message: QUESTION });
    expect(rows.map((r) => r.action)).toEqual(['revision-asked', 'grounded']);
    expect('carriedBy' in rows[0]!).toBe(false);
    expect(rows[1]).toMatchObject({ carriedBy: [{ toolCallId: 'a1', values: 2, only: 2 }] });
  });

  it('no gate → no evidence_checked at all', async () => {
    const { agent, rows } = run(['HOST-7731 at 4417 ms.'], undefined);
    await agent.run({ message: QUESTION });
    expect(rows).toHaveLength(0);
  });
});
