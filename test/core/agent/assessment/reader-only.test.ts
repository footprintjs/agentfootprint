/**
 * The fold is a READER — it never writes into a run, and nothing runs inside a
 * run for it (step 1 arms nothing).
 *
 * Test types:
 *   - BYTE-IDENTITY — a run whose agent is asked for its standing between turns
 *                     commits the same history, the same keys and the same
 *                     stage path as its twin that is never asked; asking adds no
 *                     commit and leaves the snapshot's bytes as they were. (The
 *                     21 byte references under `test/core/tools/reference/` pin
 *                     the unarmed chart itself; this release adds no run-time
 *                     code for them to see.)
 *   - SECURITY      — a deep-frozen record folds without a write attempt; no
 *                     network, no timer, no clock is touched;
 *   - COUNTED WORK  — history and coverage input reads grow linearly;
 *   - LOAD          — 500 large-record byte checks compare the same bytes, in bounded
 *                     correctness cases rather than one stopwatch-sized case.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';
import { Agent, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';

const lookup = defineTool({
  name: 'list_ports',
  description: 'list ports',
  inputSchema: { type: 'object', properties: {} },
  execute: () => [],
});

const script = () =>
  mock({
    replies: [
      { toolCalls: [{ id: 'c1', name: 'list_ports', args: {} }] },
      { content: 'none' },
      { toolCalls: [{ id: 'c2', name: 'list_ports', args: {} }] },
      { content: 'still none' },
    ] as never,
  });

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** What a run committed, minus the values a clock or a counter names. */
function committed(agent: Agent) {
  const snapshot = agent.getLastSnapshot()!;
  const state = snapshot.sharedState as Record<string, unknown>;
  return {
    keys: Object.keys(state).sort(),
    history: state.history,
    stages: (snapshot.commitLog as { stageId: string }[]).map((b) => b.stageId),
  };
}

describe('BYTE-IDENTITY — asking never changes a run', () => {
  it('the asked twin and the unasked twin commit the same turn 2', async () => {
    const asked = Agent.create({ provider: script(), model: 'mock' }).tool(lookup).build();
    const quiet = Agent.create({ provider: script(), model: 'mock' }).tool(lookup).build();
    await asked.run({ message: 'down ports?' });
    await quiet.run({ message: 'down ports?' });

    const before = JSON.stringify(asked.getLastSnapshot());
    const commits = asked.getCommitCount();
    const standing = await asked.assessment();
    expect(standing?.standing).toBe('not-sure');
    expect(asked.getCommitCount()).toBe(commits); // no commit
    expect(JSON.stringify(asked.getLastSnapshot())).toBe(before); // no write

    await asked.run({ message: 'and now?', continueFrom: asked.checkpoint()! } as never);
    await asked.assessment();
    await quiet.run({ message: 'and now?', continueFrom: quiet.checkpoint()! } as never);
    expect(committed(asked)).toEqual(committed(quiet));
  });
});

describe('SECURITY — pure: no write, no network, no timer, no clock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a deep-frozen record folds, and nothing outside the function is touched', async () => {
    const agent = Agent.create({ provider: script(), model: 'mock' }).tool(lookup).build();
    await agent.run({ message: 'down ports?' });
    const record = deepFreeze({ snapshot: JSON.parse(JSON.stringify(agent.getLastSnapshot())) });
    const trap = (name: string) =>
      vi.fn(() => {
        throw new Error(`${name} was called by the fold`);
      });
    const fetch = trap('fetch');
    vi.stubGlobal('fetch', fetch);
    const timers = [
      vi.spyOn(globalThis, 'setTimeout'),
      vi.spyOn(globalThis, 'setInterval'),
      vi.spyOn(globalThis, 'queueMicrotask'),
    ];
    const now = vi.spyOn(Date, 'now');
    const a = assessAnswer(record);
    expect(a.standing).toBe('not-sure');
    expect(fetch).not.toHaveBeenCalled();
    for (const t of timers) expect(t).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });
});

describe('PERFORMANCE / LOAD — linear, and the same bytes every time', () => {
  const big = (size = 2000) => {
    const history: unknown[] = [{ role: 'user', content: 'q' }];
    const coverageDeclared: unknown[] = [];
    for (let i = 0; i < size; i++) {
      history.push({
        role: 'tool',
        toolCallId: `c${i}`,
        toolName: 't',
        content: i % 3 ? '[1]' : '[]',
      });
      if (i % 2 === 0) {
        coverageDeclared.push({
          kind: 'ledger',
          toolName: 't',
          toolCallId: `c${i}`,
          iteration: 1,
          checked: [{ what: 'x' }],
          notChecked: [],
          cannotCover: [],
        });
      }
    }
    return { snapshot: { sharedState: { history, coverageDeclared } } };
  };

  it('input visits stay bounded by three history passes and one coverage pass', () => {
    for (const size of [20, 200, 2000]) {
      const record = big(size);
      const counts = { history: 0, coverage: 0 };
      const counted = <T>(rows: T[], key: keyof typeof counts): T[] => {
        return new Proxy(rows, {
          get(target, property, receiver) {
            if (typeof property === 'string' && /^(0|[1-9][0-9]*)$/.test(property)) {
              counts[key] += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        });
      };
      record.snapshot.sharedState.history = counted(record.snapshot.sharedState.history, 'history');
      record.snapshot.sharedState.coverageDeclared = counted(
        record.snapshot.sharedState.coverageDeclared,
        'coverage',
      );
      const a = assessAnswer(record);
      expect(a.checked.find((c) => c.check === 'result-shape')).toMatchObject({
        ran: size,
        of: size,
      });
      // The lower bounds make a blind counter fail, too. This counts reads of
      // the input arrays; it does not claim to count every internal allocation.
      expect(counts.history).toBeGreaterThanOrEqual(size);
      expect(counts.history).toBeLessThanOrEqual(3 * (size + 1));
      expect(counts.coverage).toBe(size / 2);
    }
  });

  it.each(Array.from({ length: 20 }, (_, batch) => batch))(
    'large-record byte consistency, batch %i of 20 (25 checks plus one reference fold)',
    () => {
      const record = big();
      const first = JSON.stringify(assessAnswer(record));
      for (let i = 0; i < 25; i++) expect(JSON.stringify(assessAnswer(record))).toBe(first);
    },
  );
});
