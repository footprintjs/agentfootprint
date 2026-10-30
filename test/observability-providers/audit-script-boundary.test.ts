/** The two H1 script records keep their declared structure while checking every child at runtime. */
import { describe, expect, it } from 'vitest';
import { auditExport, verifyAuditBundle } from '../../src/adapters/observability/audit';
import type { AgentfootprintEvent } from '../../src/events/registry';
import type { TurnEndScripts, ScriptsVerdict } from '../../src/lib/scriptRecord';

const CANARY = 'SCRIPT-PRIVATE-CHILD';
const MARKER = `[${CANARY.length} chars]`;
const shown = {
  toolCallId: 'c1',
  dispatch: 1,
  tool: 'run_code',
  language: 'python',
  label: 'completed-with-failure',
  exitCode: 3,
  resultWithheld: 'over-ceiling',
  rewritten: true,
  bytes: 100,
  lines: 2,
  truncated: { shownBytes: 40 },
  text: CANARY,
} as const;
const attachment: TurnEndScripts = {
  shown: [shown],
  omitted: 2,
  closedFence: { char: 'tilde', length: 4 },
  withheldFromText: true,
};
const verdict: ScriptsVerdict = {
  blocks: [
    {
      block: 1,
      label: 'completed-with-failure',
      exitCode: 3,
      toolCallId: 'c1',
      tool: 'run_code',
      dispatch: 1,
      alsoMatches: 2,
    },
    { block: 2, label: 'unmatched', reason: 'kept-out' },
  ],
  earlierTurnRows: 2,
  regionsDropped: 3,
  scriptsDropped: 4,
};
function bounded(type: string, scripts: unknown): unknown {
  const audit = auditExport();
  audit.exportEvent({
    type,
    payload: { scripts },
    meta: {
      runId: 'scripts-boundary',
      wallClockMs: 1,
      runOffsetMs: 0,
      runtimeStageId: 'final#1',
      subflowPath: [],
      compositionPath: [],
    },
  } as unknown as AgentfootprintEvent);
  const bundle = audit.bundle();
  expect(verifyAuditBundle(bundle).valid).toBe(true);
  expect(verifyAuditBundle(JSON.parse(JSON.stringify(bundle))).valid).toBe(true);
  expect(JSON.stringify(bundle)).not.toContain(CANARY);
  return (bundle.records.find((row) => row.eventType === type)?.payload as { scripts?: unknown })
    .scripts;
}
const turn = (scripts: unknown): unknown => bounded('agentfootprint.agent.turn_end', scripts);
const checked = (scripts: unknown): unknown =>
  bounded('agentfootprint.agent.evidence_checked', scripts);

describe('script audit shapes', () => {
  it('preserves all declared attachment fields and only marks the program', () => {
    expect(turn(attachment)).toEqual({ ...attachment, shown: [{ ...shown, text: MARKER }] });
  });
  it('preserves matched and unmatched verdict variants without conflating them', () => {
    expect(checked(verdict)).toEqual(verdict);
  });
  it('marks undeclared children at every attachment depth and retains reserved own keys', () => {
    const extra = { ...Object.fromEntries([['__proto__', CANARY]]), extra: CANARY };
    expect(
      turn({
        ...attachment,
        ...extra,
        shown: [{ ...shown, ...extra, truncated: { shownBytes: 40, ...extra } }],
        closedFence: { char: 'tilde', length: 4, ...extra },
      }),
    ).toEqual({
      ...attachment,
      extra: MARKER,
      ...Object.fromEntries([['__proto__', MARKER]]),
      shown: [
        {
          ...shown,
          text: MARKER,
          extra: MARKER,
          ...Object.fromEntries([['__proto__', MARKER]]),
          truncated: {
            shownBytes: 40,
            extra: MARKER,
            ...Object.fromEntries([['__proto__', MARKER]]),
          },
        },
      ],
      closedFence: {
        char: 'tilde',
        length: 4,
        extra: MARKER,
        ...Object.fromEntries([['__proto__', MARKER]]),
      },
    });
  });
  it('marks undeclared children at both verdict depths', () => {
    expect(
      checked({
        ...verdict,
        extra: CANARY,
        blocks: verdict.blocks.map((block) => ({ ...block, extra: CANARY })),
      }),
    ).toEqual({
      ...verdict,
      extra: MARKER,
      blocks: verdict.blocks.map((block) => ({ ...block, extra: MARKER })),
    });
  });
  it('checks attachment scalars, enum words and containers rather than trusting their type', () => {
    expect(
      turn({
        shown: [
          {
            ...shown,
            bytes: CANARY,
            tool: { private: CANARY },
            label: CANARY,
            rewritten: CANARY,
            resultWithheld: CANARY,
            truncated: CANARY,
          },
        ],
        omitted: CANARY,
        closedFence: { char: CANARY, length: CANARY },
        withheldFromText: CANARY,
      }),
    ).toEqual({
      shown: [
        {
          ...shown,
          text: MARKER,
          bytes: MARKER,
          tool: '[type: object]',
          label: MARKER,
          rewritten: MARKER,
          resultWithheld: MARKER,
          truncated: MARKER,
        },
      ],
      omitted: MARKER,
      closedFence: { char: MARKER, length: MARKER },
      withheldFromText: MARKER,
    });
  });
  it('checks verdict kinds, enum words and nested values', () => {
    expect(
      checked({
        blocks: [
          {
            block: CANARY,
            label: CANARY,
            reason: CANARY,
            toolCallId: { private: CANARY },
            alsoMatches: CANARY,
          },
        ],
        earlierTurnRows: CANARY,
        regionsDropped: CANARY,
        scriptsDropped: CANARY,
      }),
    ).toEqual({
      blocks: [
        {
          block: MARKER,
          label: MARKER,
          reason: MARKER,
          toolCallId: '[type: object]',
          alsoMatches: MARKER,
        },
      ],
      earlierTurnRows: MARKER,
      regionsDropped: MARKER,
      scriptsDropped: MARKER,
    });
  });
  it('marks wrong root and list shapes without losing the event', () => {
    expect(turn(CANARY)).toBe(MARKER);
    expect(turn({ shown: { private: CANARY } })).toEqual({ shown: '[type: object]' });
    expect(checked(CANARY)).toBe(MARKER);
    expect(checked({ blocks: { private: CANARY } })).toEqual({ blocks: '[type: object]' });
  });
});
