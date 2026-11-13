import type { RuntimeSnapshot } from 'footprintjs';
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../Agent.js';
import { LLMCall } from '../../../LLMCall.js';
import { RunnerBase } from '../../../RunnerBase.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';
import type { AgentfootprintEvent } from '../../../../events/registry.js';
import { assessLive } from '../../assessment/assess.js';

const projections = [
  'stoppedEarly',
  'outputContractUnmet',
  'unsupportedValues',
  'findings',
  'answerNegatives',
  'answerValidation',
  'answerCoverage',
] as const;
type Borrowed =
  | (typeof projections)[number]
  | 'getLastSnapshot'
  | 'getLastNarrativeEntries'
  | 'ownsEvent'
  | 'drainObservers'
  | 'assessment'
  | 'abandonPause';

function borrow(name: Borrowed, receiver: object, args: unknown[] = []): unknown {
  return Reflect.apply(Agent.prototype[name], receiver, args);
}

/** Exposes native test seams, without constructing an Agent or its private context. */
class NativeCall extends LLMCall {
  rawState?: Record<string, unknown>;

  executionForTest() {
    return this.runExecution();
  }

  protected override liveSnapshot(): RuntimeSnapshot | undefined {
    return this.rawState === undefined
      ? super.liveSnapshot()
      : ({ sharedState: this.rawState } as RuntimeSnapshot);
  }
}

const call = () => new NativeCall({ provider: mock({ reply: 'ok' }), model: 'mock' }, '');

class UninitializedRunner extends RunnerBase {
  async run(): Promise<unknown> {
    return undefined;
  }

  async resume(): Promise<unknown> {
    return undefined;
  }
}

describe('Agent native readers borrowed by another RunnerBase implementation', () => {
  for (const completed of [false, true]) {
    it(`reads the ${
      completed ? 'completed' : 'initialized, never-run'
    } LLMCall itself`, async () => {
      const runner = call();
      const events: AgentfootprintEvent[] = [];
      runner.on('*', (event) => events.push(event));
      try {
        if (completed) await expect(runner.run('hello')).resolves.toBe('ok');
        expect(borrow('getLastSnapshot', runner)).toEqual(runner.getLastSnapshot());
        expect(borrow('getLastNarrativeEntries', runner)).toEqual(
          runner.executionForTest().selected()?.view.getNarrativeEntries() ?? [],
        );
        for (const name of projections) expect(borrow(name, runner), name).toBeUndefined();
        await expect(borrow('drainObservers', runner)).resolves.toEqual({
          done: 0,
          failed: 0,
          pending: 0,
        });
        // A leaf run has no Agent answer settlement; it must not invent an assessment.
        // Invalid declarations are not read before a settled answer exists, either.
        await expect(borrow('assessment', runner, [null])).resolves.toBeUndefined();
        if (completed) {
          const own = events.find((event) => event.type === 'agentfootprint.stream.llm_end');
          expect(own).toBeDefined();
          expect(borrow('ownsEvent', runner, [own])).toBe(true);
          const other = call();
          const foreign: AgentfootprintEvent[] = [];
          other.on('*', (event) => foreign.push(event));
          try {
            await other.run('another run');
            expect(foreign.length).toBeGreaterThan(0);
            expect(borrow('ownsEvent', runner, [foreign[0]])).toBe(false);
          } finally {
            await other.shutdown({ stop: true });
          }
        } else {
          const event = {
            get meta() {
              throw new Error('an event without a selected run must not be inspected');
            },
          };
          expect(borrow('ownsEvent', runner, [event])).toBe(false);
        }
        await expect(borrow('abandonPause', runner)).resolves.toBeUndefined();
      } finally {
        await runner.shutdown({ stop: true });
      }
    });
  }

  it('keeps live projections live and detached projections detached on a native receiver', async () => {
    const runner = call();
    const fields = {
      stoppedEarly: 'stoppedEarly',
      outputContractUnmet: 'outputContractUnmet',
      unsupportedValues: 'unsupportedValues',
      findings: 'findingsLedger',
      answerNegatives: 'answerNegatives',
      answerValidation: 'answerValidation',
      answerCoverage: 'answerCoverage',
    } as const;
    // These accessors project native JSON; they do not reinterpret another runner's rows.
    runner.rawState = Object.fromEntries(
      Object.values(fields).map((field) => [field, { nested: ['original'] }]),
    );
    try {
      for (const name of projections) {
        const stored = runner.rawState[fields[name]];
        const result = borrow(name, runner) as { nested: string[] };
        expect(result, name).toEqual(stored);
        if (
          name === 'stoppedEarly' ||
          name === 'outputContractUnmet' ||
          name === 'unsupportedValues'
        ) {
          expect(result, name).toBe(stored);
        } else {
          expect(result, name).not.toBe(stored);
          result.nested.push('caller mutation');
          expect(runner.rawState[fields[name]], name).toEqual({ nested: ['original'] });
        }
      }
    } finally {
      await runner.shutdown({ stop: true });
    }
  });

  it('returns the native drain promise with the original options and synchronous errors', async () => {
    const runner = call();
    const expected = Promise.resolve({ done: 2, failed: 1, pending: 3 });
    const drain = vi.fn((_options?: { timeoutMs?: number }) => expected);
    const view = vi
      .spyOn(runner.executionForTest(), 'view')
      .mockReturnValue({ drainObservers: drain } as never);
    try {
      const options = { timeoutMs: 7 };
      expect(borrow('drainObservers', runner, [options])).toBe(expected);
      expect(drain.mock.calls[0]?.[0]).toBe(options);
      const failure = new Error('native drain failed synchronously');
      drain.mockImplementationOnce(() => {
        throw failure;
      });
      expect(() => borrow('drainObservers', runner)).toThrow(failure);
    } finally {
      view.mockRestore();
      await runner.shutdown({ stop: true });
    }
  });

  it('captures the assessed native run before awaiting, and retains declaration refusals', async () => {
    const runner = call();
    try {
      await runner.run('first');
      const execution = runner.executionForTest();
      const selected = execution.selected()!;
      Object.assign(selected.value, { answer: 'ok' });
      const first = {
        ...selected.view.snapshot()!,
        sharedState: {
          stoppedEarly: {
            reason: 'max-iterations',
            iteration: 1,
            pendingToolCalls: 1,
            answerWasEmpty: false,
          },
        },
      };
      const read = vi.fn(() => first);
      const selection = vi.spyOn(execution, 'selected').mockReturnValue({
        ...selected,
        view: { ...selected.view, snapshot: read },
      });
      let assessed: unknown;
      try {
        assessed = borrow('assessment', runner);
        expect(read).toHaveBeenCalledTimes(1);
      } finally {
        selection.mockRestore();
      }
      const later = runner.run('second');
      await expect(assessed).resolves.toEqual(assessLive(first));
      await later;
      Object.assign(runner.executionForTest().selected()!.value, { answer: 'ok' });
      await expect(borrow('assessment', runner, [null])).rejects.toThrow(
        'assessAnswer: declarations must be an object',
      );
    } finally {
      await runner.shutdown({ stop: true });
    }
  });

  it('keeps the original uninitialized-runner error timing instead of requiring Agent context', async () => {
    const runner = new UninitializedRunner();
    const error = new TypeError('The runner chart has not been initialized');
    expect(borrow('getLastSnapshot', runner)).toBeUndefined();
    expect(() => borrow('drainObservers', runner)).toThrow(error);
    for (const name of ['assessment', 'abandonPause'] as const) {
      let returned: unknown;
      expect(() => {
        returned = borrow(name, runner);
      }, name).not.toThrow();
      await expect(returned).rejects.toThrow(error);
    }
  });
});
