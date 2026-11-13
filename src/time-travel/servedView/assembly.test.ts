/** Saved-record reconstruction keeps the call's ordered and lazy reads. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Agent, defineTool } from '../../index.js';
import { servedAt, type ServedView } from '../servedView.js';
import { epochAt } from '../epochs.js';
import { RECEIPT_KEY } from '../../lib/conventions.js';
import type { LLMResponse } from '../../provider-contract/types.js';
import { stripKey, rewriteKey, stripBases } from '../../../test/helpers/savedRecordDamage.js';

const observed = vi.hoisted(() => ({
  reads: [] as string[],
  legacyCalls: 0,
  lateLedgers: [] as unknown[],
  failLate: false,
}));

// Observe the real folds and composers; no map of invented read answers.
vi.mock('../epochs.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../epochs.js')>();
  return {
    ...real,
    readAtCall: (...args: Parameters<typeof real.readAtCall>) => {
      observed.reads.push(`at:${args[1]}`);
      return real.readAtCall(...args);
    },
    readAfterCall: (...args: Parameters<typeof real.readAfterCall>) => {
      observed.reads.push(`after:${args[1]}`);
      return real.readAfterCall(...args);
    },
    readRunConstant: (...args: Parameters<typeof real.readRunConstant>) => {
      observed.reads.push(`run:${args[1]}`);
      return real.readRunConstant(...args);
    },
  };
});

vi.mock('../../core/agent/findings/serve.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../core/agent/findings/serve.js')>();
  return {
    ...real,
    findingsLedgerPiece: (...args: Parameters<typeof real.findingsLedgerPiece>) => {
      observed.legacyCalls += 1;
      return real.findingsLedgerPiece(...args);
    },
  };
});

vi.mock('../../core/agent/findings/context.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../core/agent/findings/context.js')>();
  return {
    ...real,
    findingsContext: (...args: Parameters<typeof real.findingsContext>) => {
      observed.lateLedgers.push(args[1]);
      if (observed.failLate) throw new Error('Injected late composer failure');
      return real.findingsContext(...args);
    },
  };
});

type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;
let saved: Snapshot;

beforeAll(async () => {
  const agent = Agent.create({
    provider: {
      name: 'saved-view-order-mock',
      complete: async (): Promise<LLMResponse> => ({
        content: 'done',
        toolCalls: [],
        usage: { input: 0, output: 0 },
        stopReason: 'stop',
      }),
    },
    model: 'mock',
    reactMode: 'dynamic',
  })
    .system('Be precise.')
    .tool(defineTool({ name: 'ping', description: 'ping', execute: () => 'pong' }))
    .findings()
    .build();
  await agent.run({ message: 'hello' });
  saved = JSON.parse(JSON.stringify(agent.getSnapshot()!)) as Snapshot;
});

function rebuild(recording: unknown, failLate = false): ServedView {
  observed.reads.length = 0;
  observed.legacyCalls = 0;
  observed.lateLedgers.length = 0;
  observed.failLate = failLate;
  return servedAt(recording, 1)!;
}

/** Add a base value and replace any actual writes, retaining the real log. */
function withValue(recording: Snapshot, key: string, value: unknown): Snapshot {
  const copy = rewriteKey(recording, key, value);
  return { ...copy, initialState: { ...copy.initialState, [key]: value } };
}

const PREFIX = [
  `after:${RECEIPT_KEY}`,
  'at:systemPromptInjections',
  'at:iteration',
  'at:evidenceRecovery',
  'at:evidenceRecoveryUsed',
  'at:history',
  'at:messagesInjections',
  'at:findingsLedger',
  'after:findingsLayout',
  'after:findingsContextBytes',
];
const SUFFIX = [
  'run:findingsServe',
  'run:ontology',
  'at:hiddenSkillIds',
  'at:wrapUpAsked',
  'at:toolsOffAfterRevision',
  'at:dynamicToolSchemas',
  'run:forcedOutputToolName',
  'run:toolWantsByName',
  'at:timeLine',
  'at:evidenceRecovery',
  'at:evidenceRecoveryUsed',
];

describe('one saved epoch, in the order the request was assembled', () => {
  it('reads late DATA last, after the repeated recovery reads', () => {
    const view = rebuild(saved);
    expect(observed.reads).toEqual([...PREFIX, ...SUFFIX, 'at:findingsLedger']);
    expect(observed.legacyCalls).toBe(0);
    expect(view.messages.requestOnly.at(-1)?.reason).toBe('findings-data');
  });

  it('carries a late composer failure into the first gap without legacy fallback', () => {
    // Real saved-record folds, with one injected dependency failure at the
    // existing try/push/catch boundary. This is not a malformed-bound case.
    const view = rebuild(saved, true);
    expect(observed.reads).toEqual([...PREFIX, ...SUFFIX, 'at:findingsLedger']);
    expect(observed.legacyCalls).toBe(0);
    expect(view.gaps[0]?.gap).toBe('findings-layout');
    expect(view.messages.requestOnly.some((line) => line.reason === 'findings-data')).toBe(false);
  });

  it('reads the legacy ask only on the original layout', () => {
    const old = stripKey(stripKey(saved, 'findingsLayout'), 'findingsContextBytes');
    rebuild(old);
    expect(observed.reads).toEqual([...PREFIX, 'run:findingsAnswerAsk', ...SUFFIX]);
    expect(observed.legacyCalls).toBe(1);
  });

  it.each([
    ['future layout', 'findingsLayout', 'future-v2'],
    ['invalid bound', 'findingsContextBytes', 'not a number'],
  ])('declares %s without invoking a legacy fallback', (_name, key, value) => {
    const view = rebuild(withValue(saved, key, value));
    expect(observed.reads).toEqual([...PREFIX, ...SUFFIX]);
    expect(observed.legacyCalls).toBe(0);
    expect(view.gaps[0]?.gap).toBe('findings-layout');
    expect(view.messages.requestOnly.some((line) => line.reason === 'findings-data')).toBe(false);
  });

  it('reads both conversation sources and lets an empty history win', () => {
    const view = rebuild(withValue(saved, 'history', []));
    expect(observed.reads.slice(5, 7)).toEqual(['at:history', 'at:messagesInjections']);
    expect(view.messages.asSent).toEqual([]);
    expect(view.gaps.some((gap) => gap.gap === 'no-conversation-on-record')).toBe(false);
  });

  it('lets an empty dynamic list win without reading the fallback', () => {
    const view = rebuild(withValue(saved, 'dynamicToolSchemas', []));
    expect(view.tools.schemas).toEqual([]);
    expect(observed.reads).not.toContain('at:toolSchemas');
  });

  it('reads the tools fallback once only when the dynamic value is not an array', () => {
    const fallback = [{ name: 'fallback', description: 'saved schema', inputSchema: {} }];
    const view = rebuild(
      withValue(withValue(saved, 'dynamicToolSchemas', null), 'toolSchemas', fallback),
    );
    expect(view.tools.names).toEqual(['fallback']);
    expect(observed.reads.filter((read) => read === 'at:toolSchemas')).toHaveLength(1);
    expect(observed.reads.indexOf('at:toolSchemas')).toBe(
      observed.reads.indexOf('at:dynamicToolSchemas') + 1,
    );
  });

  it('reads iteration again only for a nonempty time line on a non-withheld call', () => {
    const timed = withValue(saved, 'timeLine', { iteration: 1, text: 'saved time window' });
    const view = rebuild(timed);
    const position = observed.reads.indexOf('at:timeLine');
    expect(observed.reads.slice(position, position + 4)).toEqual([
      'at:timeLine',
      'at:iteration',
      'at:evidenceRecovery',
      'at:evidenceRecoveryUsed',
    ]);
    expect(view.messages.requestOnly.some((line) => line.reason === 'time-window-line')).toBe(true);
    for (const record of [
      withValue(timed, 'wrapUpAsked', true),
      withValue(timed, 'timeLine', { text: '' }),
    ]) {
      rebuild(record);
      expect(observed.reads.filter((read) => read === 'at:iteration')).toHaveLength(1);
      expect(observed.reads).toEqual([...PREFIX, ...SUFFIX, 'at:findingsLedger']);
    }
  });

  // This record has `wants` and no ticket receipt: the shape of every recording
  // made before the receipt existed, whose run named any ticket-shaped result.
  // The rebuild gives back the line that run really sent.
  it('appends staged refs, time, conclusion and late findings in that order', () => {
    let record = withValue(saved, 'history', [
      {
        role: 'tool',
        toolCallId: 'saved-tool',
        content: JSON.stringify({
          placed: true,
          ref: 'art_saved',
          kind: 'dataset/rows',
          reason: 'saved placement',
        }),
      },
    ]);
    record = withValue(record, 'toolWantsByName', { ping: ['dataset/rows'] });
    record = withValue(record, 'timeLine', { iteration: 1, text: 'saved time window' });
    record = withValue(record, 'evidenceRecovery', {
      iteration: 1,
      instruction: 'saved recovery',
      conclusion: 'saved conclusion',
    });
    record = withValue(record, 'evidenceRecoveryUsed', false);
    const view = rebuild(record);
    expect(view.messages.requestOnly.map((line) => line.reason)).toEqual([
      'staged-refs-nudge',
      'time-window-line',
      'evidence-conclusion',
      'findings-data',
    ]);
    expect(view.system.pieces.at(-1)?.text).toBe('saved recovery');
    expect(view.messages.requestOnly[2]?.text).toBe('saved conclusion');
  });

  it('a record that keeps the receipt names only the tickets it lists', () => {
    const ticket = { placed: true, ref: 'art_saved', kind: 'dataset/rows', reason: 'saved' };
    let record = withValue(saved, 'history', [
      { role: 'tool', toolCallId: 'saved-tool', content: JSON.stringify(ticket) },
    ]);
    record = withValue(record, 'toolWantsByName', { ping: ['dataset/rows'] });
    const staged = (receipt: unknown) =>
      rebuild(withValue(record, 'placedTickets', receipt)).messages.requestOnly.filter(
        (line) => line.reason === 'staged-refs-nudge',
      );
    // Kept and empty: the tool wrote that ticket itself, so no line went out.
    expect(staged([])).toEqual([]);
    // Listed for another ref, or for another call: not this ticket.
    expect(staged([{ toolCallId: 'saved-tool', ref: 'art_other' }])).toEqual([]);
    expect(staged([{ toolCallId: 'other-call', ref: 'art_saved' }])).toEqual([]);
    // Kept out by a redaction policy: a placeholder issues nothing.
    expect(staged('REDACTED')).toEqual([]);
    const named = staged([{ toolCallId: 'saved-tool', ref: 'art_saved' }]);
    expect(named).toHaveLength(1);
    expect(named[0]?.text).toContain("'art_saved' (dataset/rows)");
  });

  it('keeps the late raw ledger read distinct from placeholder-aware reads', () => {
    const damaged = withValue(saved, 'findingsLedger', 'REDACTED');
    rebuild({
      ...damaged,
      recorders: [...(damaged.recorders ?? []), { id: 'agentfootprint.redaction' }],
    });
    expect(observed.reads.at(-1)).toBe('at:findingsLedger');
    expect(observed.lateLedgers).toEqual(['REDACTED']);
  });

  it.each([
    ['absent', undefined, 'no-receipt-committed'],
    ['rejected', 'broken receipt', 'receipt-shape-rejected'],
  ] as const)('orders the gaps and retains the %s receipt cause', (_label, receipt, cause) => {
    let damaged = stripKey(stripKey(saved, 'history'), 'messagesInjections');
    damaged = withValue(damaged, 'findingsLayout', 'future-v2');
    damaged =
      receipt === undefined
        ? stripKey(damaged, RECEIPT_KEY)
        : withValue(damaged, RECEIPT_KEY, receipt);
    const view = rebuild(stripBases(damaged));
    expect(view.gaps.map((gap) => gap.gap)).toEqual([
      'findings-layout',
      'no-fold-base',
      'no-conversation-on-record',
      'no-receipt-on-chart',
      'cache-transform',
    ]);
    expect(view.gaps.find((gap) => gap.gap === 'no-receipt-on-chart')?.cause).toBe(cause);
  });

  it('detaches fold arrays and freezes every returned container', async () => {
    const view = rebuild(saved);
    const real = await vi.importActual<typeof import('../epochs.js')>('../epochs.js');
    const location = epochAt(saved, 1)!;
    expect(view.messages.asSent).not.toBe(real.readAtCall(location, 'history'));
    expect(view.tools.schemas).not.toBe(real.readAtCall(location, 'dynamicToolSchemas'));
    const containers = [
      view,
      view.basis,
      view.system,
      view.system.pieces,
      ...view.system.pieces,
      view.messages,
      view.messages.asSent,
      view.messages.requestOnly,
      ...view.messages.requestOnly,
      view.tools,
      view.tools.names,
      view.tools.schemas,
      view.gaps,
      ...view.gaps,
    ];
    for (const value of containers) {
      expect(value).toBeDefined();
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(() => {
      (view as { epoch: number }).epoch = 99;
    }).toThrow();
  });
});
