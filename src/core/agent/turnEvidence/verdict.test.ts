import { describe, expect, it } from 'vitest';
import type { AgentfootprintEvent, AgentfootprintEventMap } from '../../../events/registry.js';
import { SERVED_PLACEHOLDER } from '../../../redaction/placeholder.js';
import { readTurnEvidenceVerdict } from './verdict.js';

const RUN = 'target-run';
const NEXT = 'next-run';

function event<T extends keyof AgentfootprintEventMap>(
  type: T,
  payload: AgentfootprintEventMap[T]['payload'],
  runId = RUN,
): AgentfootprintEventMap[T] {
  return {
    type,
    payload,
    meta: {
      runId,
      runtimeStageId: 'stage',
      subflowPath: [],
      compositionPath: [],
      wallClockMs: 0,
      runOffsetMs: 0,
    },
  } as AgentfootprintEventMap[T];
}

const configured = (gate?: 'assist' | 'guard' | 'rails', runId = RUN) =>
  event(
    'agentfootprint.agent.run_configured',
    {
      agentId: 'fixture',
      llm: { provider: 'mock', model: 'mock' },
      reactMode: 'dynamic',
      memories: [],
      ...(gate === undefined ? {} : { evidenceGate: gate }),
    },
    runId,
  );

const end = (iterationCount: number, runId = RUN) =>
  event(
    'agentfootprint.agent.turn_end',
    {
      turnIndex: 0,
      finalContent: 'A synthetic answer.',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      iterationCount,
      durationMs: 0,
    },
    runId,
  );

type Checked = AgentfootprintEventMap['agentfootprint.agent.evidence_checked']['payload'];

const check = (
  iteration: number,
  action: Checked['action'],
  unsupported: Checked['unsupported'],
  runId = RUN,
) =>
  event(
    'agentfootprint.agent.evidence_checked',
    {
      iteration,
      action,
      unsupported,
      candidates: unsupported.length,
      afterRevision: iteration > 1,
      posture: 'guard',
    },
    runId,
  );

const read = (events: AgentfootprintEvent[], runId = RUN) =>
  readTurnEvidenceVerdict({ snapshot: undefined, events }, runId);

const draft = [{ value: 'ARRAY-42', shape: 'array-serial' }];

/** The served wire can replace a payload field or the whole payload with a placeholder. */
const served = (recorded: AgentfootprintEvent, payload: unknown): AgentfootprintEvent =>
  ({ ...recorded, payload } as AgentfootprintEvent);

describe('readTurnEvidenceVerdict', () => {
  it('keeps the exact list and both item fields without the answer-account cuts', () => {
    const value = 'A'.repeat(210);
    const items = [
      { value, shape: 'array-serial' },
      { value, shape: 'identifier' },
      ...Array.from({ length: 11 }, (_, index) => ({ value: `ASSET-${index}`, shape: 'asset' })),
    ];
    const final = check(2, 'flagged', items);
    const events = [configured('guard'), check(1, 'revision-asked', draft), final, end(2)];
    const verdict = read(events);
    expect(verdict).toEqual({ status: 'unsupported', items });
    if (verdict.status !== 'unsupported') throw new Error('Expected an unsupported verdict');
    expect(verdict.items).not.toBe(items);
    expect(verdict.items?.[0]).not.toBe(items[0]);
    expect(read(JSON.parse(JSON.stringify(events)))).toEqual(verdict);
  });

  it('chooses the last final-iteration verdict before the exact run’s terminal', () => {
    const events = [
      configured('guard'),
      check(1, 'revision-asked', draft),
      check(2, 'flagged', draft),
      check(2, 'grounded', []),
      check(2, 'flagged', draft, NEXT),
      end(2),
      check(2, 'flagged', draft),
      end(2, NEXT),
    ];
    expect(read(events)).toEqual({ status: 'clean' });
    expect(read(events, NEXT)).toEqual({ status: 'unsupported', items: draft });
  });

  it('reads a terminal rails verdict as unsupported', () => {
    expect(read([configured('rails'), check(1, 'refused', draft), end(1)])).toEqual({
      status: 'unsupported',
      items: draft,
    });
  });

  it('requires a terminal for the requested run and a verdict for the answering iteration', () => {
    expect(read([configured('guard'), check(1, 'flagged', draft), end(1, NEXT)])).toEqual({
      status: 'not-checked',
    });
    expect(read([configured('guard'), check(1, 'flagged', draft), end(2)])).toEqual({
      status: 'not-checked',
    });
    expect(read([configured('guard'), check(1, 'revision-asked', draft), end(1)])).toEqual({
      status: 'not-checked',
    });
  });

  it('reports disabled only from an exact, readable configuration', () => {
    expect(read([configured(), end(1)])).toEqual({ status: 'disabled' });
    expect(read([configured(undefined, NEXT), end(1)])).toEqual({ status: 'not-checked' });
    expect(read([configured('assist'), end(1)])).toEqual({ status: 'not-checked' });
    expect(read([served(configured(), SERVED_PLACEHOLDER), end(1)])).toEqual({
      status: 'not-checked',
    });
    expect(read([served(configured(), {}), end(1)])).toEqual({ status: 'not-checked' });
    expect(
      read([
        served(configured(), { ...configured().payload, evidenceGate: SERVED_PLACEHOLDER }),
        end(1),
      ]),
    ).toEqual({ status: 'not-checked' });
  });

  it('preserves served item placeholders and keeps an unavailable list distinct from a clean verdict', () => {
    const items = [{ value: SERVED_PLACEHOLDER, shape: SERVED_PLACEHOLDER }];
    const final = check(1, 'flagged', items);
    expect(read([final, end(1)])).toEqual({ status: 'unsupported', items });
    for (const unsupported of [SERVED_PLACEHOLDER, [{ value: 'partial' }], []]) {
      expect(read([served(final, { ...final.payload, unsupported }), end(1)])).toEqual({
        status: 'unsupported',
        items: null,
      });
    }
    expect(read([check(1, 'grounded', []), served(final, SERVED_PLACEHOLDER), end(1)])).toEqual({
      status: 'not-checked',
    });
  });
});
