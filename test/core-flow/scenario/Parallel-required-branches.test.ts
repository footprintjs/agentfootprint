/**
 * Parallel — required branches + outputMapper error attribution
 * (backlog #10).
 *
 * `.branch(id, runner, { required: true })` marks a branch whose failure
 * must reject the WHOLE run (named after the branch), instead of flowing
 * into the merge's failure handling:
 *   - ALL branches required → footprintjs fork-level `failFast`
 *     (`Promise.all`) — first failure aborts before the Merge join.
 *   - MIXED required/optional → fork stays best-effort; required
 *     failures are enforced at the Merge join (tolerant merges
 *     included), so an OPTIONAL sibling's throw stays tolerated.
 *
 * `wrapBranchOutputMapper` closes the outputMapper attribution gap:
 * footprintjs swallows mapper throws without firing
 * `FlowRecorder.onError`, so without the wrapper they'd surface as
 * `'unknown error'`.
 *
 * Tests cover: Unit · Scenario · Integration · Property · Security ·
 * Performance.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Parallel,
  wrapBranchOutputMapper,
  type BranchErrorRecord,
} from '../../../src/core-flow/Parallel.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Agent } from '../../../src/core/Agent.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function ok(reply: string) {
  return LLMCall.create({ provider: new MockProvider({ reply }), model: 'mock' })
    .system('')
    .build();
}

function failing(msg: string) {
  const provider: LLMProvider = {
    name: 'boom',
    complete: async () => {
      throw new Error(msg);
    },
  };
  return LLMCall.create({ provider, model: 'mock' }).system('').build();
}

/** Branch whose provider throws whatever `make()` builds — any error class. */
function failingWith(make: () => unknown) {
  const provider: LLMProvider = {
    name: 'boom',
    complete: async () => {
      throw make();
    },
  };
  return LLMCall.create({ provider, model: 'mock' }).system('').build();
}

/** Production-common shape: a named provider-SDK-style Error subclass. */
class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** Slow-succeeding branch — for asserting fail-fast aborts early. */
function slowOk(reply: string, delayMs: number) {
  const provider: LLMProvider = {
    name: 'slow',
    complete: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { content: reply, toolCalls: [], usage: { input: 0, output: 1 }, stopReason: 'stop' };
    },
  };
  return LLMCall.create({ provider, model: 'mock' }).system('').build();
}

/** Reach the instance's private branch-error map (test-only). */
function branchErrorsOf(par: Parallel): Map<string, BranchErrorRecord> {
  return (par as unknown as { branchErrors: Map<string, BranchErrorRecord> }).branchErrors;
}

// ── 1. Unit — wrapBranchOutputMapper + failFast stamping ────────────

describe('Parallel required — unit', () => {
  it('wrapBranchOutputMapper records a mapper throw against the branch id and rethrows', () => {
    const errs = new Map<string, BranchErrorRecord>();
    const boom = new Error('mapper boom');
    const wrapped = wrapBranchOutputMapper('legal', errs, () => {
      throw boom;
    });

    expect(() => wrapped('whatever')).toThrow('mapper boom');
    expect(errs.get('legal')?.message).toBe('mapper boom');
    // Identity preserved — the ORIGINAL error object is the raw record.
    expect(errs.get('legal')?.raw).toBe(boom);
  });

  it('wrapBranchOutputMapper keeps the FIRST error per branch (mirrors the recorder)', () => {
    const errs = new Map<string, BranchErrorRecord>([
      ['legal', { message: 'earlier error', raw: undefined }],
    ]);
    const wrapped = wrapBranchOutputMapper('legal', errs, () => {
      throw new Error('later error');
    });

    expect(() => wrapped('x')).toThrow('later error');
    expect(errs.get('legal')?.message).toBe('earlier error');
  });

  it('wrapBranchOutputMapper passes success through untouched and records nothing', () => {
    const errs = new Map<string, BranchErrorRecord>();
    const wrapped = wrapBranchOutputMapper('legal', errs, (sfOutput) => ({
      branchResults: { legal: sfOutput },
    }));

    expect(wrapped('fine')).toEqual({ branchResults: { legal: 'fine' } });
    expect(errs.size).toBe(0);
  });

  it('wrapBranchOutputMapper coerces a non-Error throw to a string message', () => {
    const errs = new Map<string, BranchErrorRecord>();
    const wrapped = wrapBranchOutputMapper('rogue', errs, () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string-thrown';
    });

    expect(() => wrapped('x')).toThrow();
    expect(errs.get('rogue')?.message).toBe('string-thrown');
  });

  it('fork-level failFast is stamped only when EVERY branch is required', () => {
    const allRequired = Parallel.create()
      .branch('a', ok('A'), { required: true })
      .branch('b', ok('B'), { required: true })
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    expect(allRequired.getSpec().root.failFast).toBe(true);

    const mixed = Parallel.create()
      .branch('a', ok('A'), { required: true })
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    expect(mixed.getSpec().root.failFast).toBeUndefined();

    const none = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    expect(none.getSpec().root.failFast).toBeUndefined();
  });
});

// ── 2. Scenario — (a) required branch throws → run rejects, named ───

describe('Parallel required — scenario: required failure rejects the run', () => {
  it('all-required: a throwing branch rejects the whole run with an error naming the branch', async () => {
    const mergeFn = vi.fn((r: Readonly<Record<string, string>>) => Object.values(r).join(','));
    const par = Parallel.create({ id: 'committee' })
      .branch('a', ok('A'), { required: true })
      .branch('bad', failing('kaboom'), { required: true })
      .mergeWithFn(mergeFn)
      .build();

    await expect(par.run({ message: 'go' })).rejects.toThrow(
      /Parallel 'committee': required branch 'bad' failed: kaboom/,
    );
    expect(mergeFn).not.toHaveBeenCalled();
  });

  it('all-required: the wrapped rejection preserves the original error as `cause`', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'), { required: true })
      .branch('bad', failing('kaboom'), { required: true })
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const err = await par.run({ message: 'go' }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err!.cause as Error).message).toBe('kaboom');
  });

  it('all-required: rejects EARLY — before a slow required sibling finishes', async () => {
    const par = Parallel.create()
      .branch('slow', slowOk('S', 1500), { required: true })
      .branch('bad', failing('instant failure'), { required: true })
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const t0 = performance.now();
    await expect(par.run({ message: 'go' })).rejects.toThrow(/instant failure/);
    // Best-effort mode would wait the full 1500ms for `slow` to settle
    // before the Merge join throws. Fail-fast must not.
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('all-required abort still emits composition.exit with status=err (enter/exit pairing)', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'), { required: true })
      .branch('bad', failing('kaboom'), { required: true })
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const exits: string[] = [];
    par.on('agentfootprint.composition.exit', (e) => exits.push(e.payload.status));
    await expect(par.run({ message: 'go' })).rejects.toThrow();
    expect(exits).toEqual(['err']);
  });

  it('mixed: a required branch failure rejects even under a tolerant merge', async () => {
    const mergeFn = vi.fn(() => 'merged');
    const par = Parallel.create({ id: 'p3' })
      .branch('vital', failing('core down'), { required: true })
      .branch('extra', ok('E'))
      .mergeOutcomesWithFn(mergeFn)
      .build();

    await expect(par.run({ message: 'go' })).rejects.toThrow(/required branch\(es\) failed/);
    await expect(par.run({ message: 'go' })).rejects.toThrow(/vital: core down/);
    expect(mergeFn).not.toHaveBeenCalled();
  });
});

// ── 2b. Scenario — identity-based attribution (named Error subclasses) ──
//
// The recorder stores the ORIGINAL error object (structuredError.raw);
// re-attribution matches by identity first, bare message second. This is
// what makes attribution work for TypeError / provider-SDK subclasses
// (RateLimitError etc.) — message-equality alone breaks against the
// name-prefixed `error.toString()` string.

describe('Parallel required — identity-based attribution (named Error subclasses)', () => {
  function attributionProbe(make: () => Error) {
    let thrown: Error | undefined;
    const branch = failingWith(() => (thrown = make()));
    return { branch, getThrown: () => thrown };
  }

  it.each([
    ['TypeError', () => new TypeError('bad type'), 'bad type'],
    [
      'RateLimitError (custom subclass)',
      () => new RateLimitError('429 slow down'),
      '429 slow down',
    ],
  ])(
    'all-required: a branch throwing a %s is attributed AND composition.exit pairs with enter',
    async (_name, make, bareMessage) => {
      const { branch, getThrown } = attributionProbe(make);
      const par = Parallel.create({ id: 'p-typed' })
        .branch('a', ok('A'), { required: true })
        .branch('bad', branch, { required: true })
        .mergeWithFn((r) => Object.values(r).join(','))
        .build();

      let enters = 0;
      const exits: string[] = [];
      par.on('agentfootprint.composition.enter', () => {
        enters += 1;
      });
      par.on('agentfootprint.composition.exit', (e) => exits.push(e.payload.status));

      const err = await par.run({ message: 'go' }).then(
        () => undefined,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(Error);
      // Attributed: names the branch, carries the BARE message (no
      // `TypeError:` / `RateLimitError:` prefix).
      expect(err!.message).toBe(`Parallel 'p-typed': required branch 'bad' failed: ${bareMessage}`);
      // The original error object survives as `cause` — identity intact.
      expect(err!.cause).toBe(getThrown());
      // The synthetic composition.exit FIRED and pairs with the enter.
      expect(enters).toBe(1);
      expect(exits).toEqual(['err']);
    },
  );

  it('tolerant merge: a TypeError lands in BranchOutcome.error as the bare message (no name prefix)', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch(
        'bad',
        failingWith(() => new TypeError('bad type')),
      )
      .mergeOutcomesWithFn((outcomes) => {
        const b = outcomes['bad']!;
        return b.ok ? 'unexpected-ok' : `bad-error=${b.error}`;
      })
      .build();

    expect(await par.run({ message: 'go' })).toBe('bad-error=bad type');
  });
});

// ── 2c. Scenario — synthetic exit meta carries the REAL run context ──

describe('Parallel required — synthetic exit meta (Convention 4 run-scoping)', () => {
  it('the synthetic composition.exit carries the SAME runId as the paired enter — not a placeholder', async () => {
    const par = Parallel.create({ id: 'p-meta' })
      .branch('a', ok('A'), { required: true })
      .branch(
        'bad',
        failingWith(() => new TypeError('bad type')),
        { required: true },
      )
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const metas: Array<{ phase: 'enter' | 'exit'; runId: string; runtimeStageId: string }> = [];
    par.on('agentfootprint.composition.enter', (e) =>
      metas.push({ phase: 'enter', runId: e.meta.runId, runtimeStageId: e.meta.runtimeStageId }),
    );
    par.on('agentfootprint.composition.exit', (e) =>
      metas.push({ phase: 'exit', runId: e.meta.runId, runtimeStageId: e.meta.runtimeStageId }),
    );

    await expect(par.run({ message: 'go' })).rejects.toThrow(/required branch 'bad'/);

    const enter = metas.find((m) => m.phase === 'enter');
    const exit = metas.find((m) => m.phase === 'exit');
    expect(enter).toBeDefined();
    expect(exit).toBeDefined();
    // Same REAL run id on both halves of the pair (Convention 4).
    expect(exit!.runId).toBe(enter!.runId);
    expect(exit!.runId).not.toBe('consumer-scope');
    expect(exit!.runtimeStageId).not.toBe('consumer-emit#0');
  });
});

// ── 3. Scenario — (d) mixed: optional failure stays tolerated ───────

describe('Parallel required — scenario: optional siblings stay tolerated', () => {
  it('mixed + tolerant merge: optional branch throws → run completes with its outcome', async () => {
    const par = Parallel.create()
      .branch('vital', ok('V'), { required: true })
      .branch('extra', failing('flaky'))
      .mergeOutcomesWithFn((outcomes) =>
        Object.entries(outcomes)
          .map(([id, o]) => (o.ok ? `${id}=${o.value}` : `${id}=ERR(${o.error})`))
          .sort()
          .join(' '),
      )
      .build();

    const out = await par.run({ message: 'go' });
    expect(out).toBe('extra=ERR(flaky) vital=V');
  });

  it('mixed + strict merge: optional branch throws → existing strict aggregate (unchanged wording)', async () => {
    const par = Parallel.create({ id: 'p-strict' })
      .branch('vital', ok('V'), { required: true })
      .branch('extra', failing('flaky'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    // Strict merges reject on ANY failure — required or not — with the
    // pre-existing aggregate message (no 'required' wording).
    await expect(par.run({ message: 'go' })).rejects.toThrow(/1 branch\(es\) failed/);
    await expect(par.run({ message: 'go' })).rejects.toThrow(/extra: flaky/);
  });
});

// ── 4. Integration — (b) default/tolerant behavior unchanged ────────

describe('Parallel required — integration: defaults unchanged', () => {
  it('no required flags: tolerant merge still aggregates outcomes and the merge runs', async () => {
    const mergeFn = vi.fn((outcomes: Readonly<Record<string, { ok: boolean }>>) => {
      const okCount = Object.values(outcomes).filter((o) => o.ok).length;
      return `ok=${okCount}`;
    });
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', failing('down'))
      .branch('c', ok('C'))
      .mergeOutcomesWithFn(mergeFn)
      .build();

    expect(await par.run({ message: 'go' })).toBe('ok=2');
    expect(mergeFn).toHaveBeenCalledTimes(1);
  });

  it('no required flags: strict merge keeps the aggregate message + tolerant-mode hint', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('bad', failing('kaboom'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    await expect(par.run({ message: 'go' })).rejects.toThrow(/1 branch\(es\) failed/);
    await expect(par.run({ message: 'go' })).rejects.toThrow(/use \.mergeOutcomesWithFn\(\)/);
  });

  it('all-required happy path: merged result + composition.exit ok', async () => {
    const par = Parallel.create()
      .branch('x', ok('X'), { required: true })
      .branch('y', ok('Y'), { required: true })
      .mergeWithFn((r) => `${r.x}+${r.y}`)
      .build();

    const exits: string[] = [];
    par.on('agentfootprint.composition.exit', (e) => exits.push(e.payload.status));
    expect(await par.run({ message: 'go' })).toBe('X+Y');
    expect(exits).toEqual(['ok']);
  });
});

// ── 5. Scenario — (c) outputMapper throw attribution ────────────────

describe('Parallel required — outputMapper error attribution', () => {
  /**
   * End-to-end through the REAL footprintjs swallow path: replace one
   * mounted outputMapper with a production-wrapped throwing mapper
   * (bound to the instance's own branch-error map), run, and assert the
   * Merge join prints the attributed message — NOT 'unknown error'.
   *
   * The inner mapper Parallel installs is total over its input, so the
   * throw is injected at the same seam `wrapBranchOutputMapper` guards.
   */
  function poisonMapper(par: Parallel, branchId: string, error: () => never): void {
    const node = par.getSpec().root.children!.find((c) => c.id === branchId)!;
    node.subflowMountOptions!.outputMapper = wrapBranchOutputMapper(
      branchId,
      branchErrorsOf(par),
      error,
    );
  }

  it('strict merge: a mapper throw rejects with the branch-attributed message, not unknown error', async () => {
    const par = Parallel.create({ id: 'p-mapper' })
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    poisonMapper(par, 'b', () => {
      throw new Error('mapper boom');
    });

    const err = await par.run({ message: 'go' }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/b: mapper boom/);
    expect(err!.message).not.toContain('unknown error');
  });

  it('tolerant merge: a mapper throw lands in BranchOutcome.error with the real message', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeOutcomesWithFn((outcomes) => {
        const b = outcomes['b']!;
        return b.ok ? 'unexpected-ok' : `b-error=${b.error}`;
      })
      .build();
    poisonMapper(par, 'b', () => {
      throw new Error('mapper boom');
    });

    expect(await par.run({ message: 'go' })).toBe('b-error=mapper boom');
  });

  it('mixed + tolerant: a REQUIRED branch mapper throw rejects with the attributed message', async () => {
    const par = Parallel.create({ id: 'p-req-mapper' })
      .branch('vital', ok('V'), { required: true })
      .branch('extra', ok('E'))
      .mergeOutcomesWithFn(() => 'merged')
      .build();
    poisonMapper(par, 'vital', () => {
      throw new Error('mapper boom');
    });

    await expect(par.run({ message: 'go' })).rejects.toThrow(/vital: mapper boom/);
  });
});

// ── 6. Property — required never changes the happy path ─────────────

describe('Parallel required — property', () => {
  it.each([
    [0, 3],
    [1, 3],
    [3, 3],
  ])(
    'with %d of %d branches required, all-success runs merge identically',
    async (nReq, nTotal) => {
      let b = Parallel.create();
      for (let i = 0; i < nTotal; i++) {
        b = b.branch(`branch${i}`, ok(`v${i}`), i < nReq ? { required: true } : {});
      }
      const par = b
        .mergeWithFn((r) =>
          Object.entries(r)
            .map(([id, v]) => `${id}=${v}`)
            .sort()
            .join(','),
        )
        .build();

      expect(await par.run({ message: 'go' })).toBe('branch0=v0,branch1=v1,branch2=v2');
    },
  );

  it('consecutive runs reset attribution — a failure in run 1 does not leak into run 2', async () => {
    let shouldFail = true;
    const provider: LLMProvider = {
      name: 'flappy',
      complete: async () => {
        if (shouldFail) throw new Error('transient');
        return {
          content: 'recovered',
          toolCalls: [],
          usage: { input: 0, output: 1 },
          stopReason: 'stop',
        };
      },
    };
    const par = Parallel.create()
      .branch('a', ok('A'), { required: true })
      .branch('flappy', LLMCall.create({ provider, model: 'mock' }).system('').build(), {
        required: true,
      })
      .mergeWithFn((r) => `${r.a}+${r.flappy}`)
      .build();

    await expect(par.run({ message: 'r1' })).rejects.toThrow(/required branch 'flappy'/);
    shouldFail = false;
    expect(await par.run({ message: 'r2' })).toBe('A+recovered');
  });

  it('a late failure from an abandoned run-1 sibling cannot contaminate run-2 attribution (epoch guard)', async () => {
    // Run 1: 'bad' throws instantly (fail-fast rejects); 'slow' is left
    // RUNNING, parked on a gate. Run 2 starts; THEN the abandoned run-1
    // sibling fails (late, during run 2), and finally run 2's own 'slow'
    // fails. Without the per-run epoch guard, the stale error would land
    // first in the instance-shared map (first-error-wins) and block run
    // 2's real error — attribution would go stale or fall back to the
    // raw unattributed rejection.
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((r) => (releaseStale = r));
    let releaseReal!: () => void;
    const realGate = new Promise<void>((r) => (releaseReal = r));

    let slowCalls = 0;
    const slowProvider: LLMProvider = {
      name: 'slow',
      complete: async () => {
        slowCalls += 1;
        if (slowCalls === 1) {
          await staleGate;
          throw new Error('stale straggler from run 1');
        }
        await realGate;
        throw new Error('run-2 real failure');
      },
    };
    let badCalls = 0;
    const flakyProvider: LLMProvider = {
      name: 'flaky',
      complete: async (): Promise<LLMResponse> => {
        badCalls += 1;
        if (badCalls === 1) throw new Error('run-1 boom');
        return { content: 'B', toolCalls: [], usage: { input: 0, output: 1 }, stopReason: 'stop' };
      },
    };
    const par = Parallel.create({ id: 'p-epoch' })
      .branch(
        'slow',
        LLMCall.create({ provider: slowProvider, model: 'mock' }).system('').build(),
        {
          required: true,
        },
      )
      .branch(
        'bad',
        LLMCall.create({ provider: flakyProvider, model: 'mock' }).system('').build(),
        {
          required: true,
        },
      )
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    // Run 1 rejects attributed to 'bad'; its 'slow' sibling stays parked.
    await expect(par.run({ message: 'r1' })).rejects.toThrow(
      /required branch 'bad' failed: run-1 boom/,
    );

    // Run 2: 'bad' succeeds, 'slow' parks on the real gate.
    const run2 = par.run({ message: 'r2' });
    await vi.waitFor(() => expect(slowCalls).toBe(2));

    // The abandoned run-1 sibling fails NOW — during run 2.
    releaseStale();
    await new Promise((r) => setTimeout(r, 20)); // let the stale error propagate fully

    // Run 2's own required failure must win the attribution.
    releaseReal();
    await expect(run2).rejects.toThrow(/required branch 'slow' failed: run-2 real failure/);
  });
});

// ── 6b. Scenario — resume() re-attribution ──────────────────────────

describe('Parallel required — resume() re-attribution', () => {
  it('a required branch failing AFTER resume is attributed to its branch', async () => {
    // Pausable agent branch: first LLM call requests a tool whose execute
    // pauses; after resume() delivers the human answer, the SECOND LLM
    // call throws a named subclass — the resume path must re-attribute it.
    let llmCalls = 0;
    const provider: LLMProvider = {
      name: 'pausable-then-broken',
      complete: async (): Promise<LLMResponse> => {
        llmCalls += 1;
        if (llmCalls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 't1', name: 'approve', args: {} }],
            usage: { input: 0, output: 1 },
            stopReason: 'tool_use',
          };
        }
        throw new RateLimitError('post-resume kaboom');
      },
    };
    const pausableAgent = Agent.create({ provider, model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'Approve?' });
          return '';
        },
      })
      .build();

    const par = Parallel.create({ id: 'p-resume' })
      .branch('a', ok('A'), { required: true })
      .branch('pause-me', pausableAgent, { required: true })
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const paused = await par.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) return;

    await expect(par.resume(paused.checkpoint, 'yes')).rejects.toThrow(
      /Parallel 'p-resume': required branch 'pause-me' failed: post-resume kaboom/,
    );
  });
});

// ── 6c. Integration — nested mounting limitation (pinned) ───────────

describe('Parallel required — nested mounting limitation (pinned)', () => {
  it('an all-required Parallel mounted in a Sequence rejects RAW — no attribution, unpaired enter', async () => {
    const par = Parallel.create({ id: 'inner-par' })
      .branch('a', ok('A'), { required: true })
      .branch('bad', failing('kaboom'), { required: true })
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();
    const seq = Sequence.create({ id: 'outer-seq' })
      .step('par', par)
      .step('after', ok('AFTER'))
      .build();

    const parallelEnters: string[] = [];
    const parallelExits: string[] = [];
    seq.on('agentfootprint.composition.enter', (e) => {
      if (e.payload.kind === 'Parallel') parallelEnters.push(e.payload.id);
    });
    seq.on('agentfootprint.composition.exit', (e) => {
      if (e.payload.kind === 'Parallel') parallelExits.push(e.payload.status);
    });

    const err = await seq.run({ message: 'go' }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    // PINNED limitation (documented in README Decision 8 +
    // `ParallelBranchOptions.required` JSDoc): when the Parallel chart is
    // MOUNTED into an outer composition, fail-fast still aborts the
    // fan-out but the rejection surfaces RAW — the run()/resume()
    // re-attribution layer never engages, and the nested Parallel's
    // composition.enter is left without a matching exit. If proper nested
    // support lands (mounted children contributing recorders/attribution
    // to the parent executor), update this test AND the docs together.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('kaboom');
    expect(err!.message).not.toMatch(/required branch/);
    expect(parallelEnters).toEqual(['inner-par']);
    expect(parallelExits).toEqual([]);
  });
});

// ── 7. Security — hostile required failures stay safe ───────────────

describe('Parallel required — security', () => {
  it('a required branch throwing a non-Error value still rejects without hanging', async () => {
    const rogue: LLMProvider = {
      name: 'rogue',
      complete: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { mysterious: 'object-thrown' };
      },
    };
    const par = Parallel.create()
      .branch('ok', ok('A'), { required: true })
      .branch('rogue', LLMCall.create({ provider: rogue, model: 'm' }).system('').build(), {
        required: true,
      })
      .mergeWithFn((r) => Object.keys(r).join(','))
      .build();

    await expect(
      Promise.race([
        par.run({ message: 'go' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 5000)),
      ]),
    ).rejects.toThrow();
  });
});

// ── 8. Performance — fail-fast wiring adds no happy-path cost ───────

describe('Parallel required — performance', () => {
  it('4-branch all-required all-success completes in under 500ms', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'), { required: true })
      .branch('b', ok('B'), { required: true })
      .branch('c', ok('C'), { required: true })
      .branch('d', ok('D'), { required: true })
      .mergeWithFn((r) => Object.values(r).sort().join(','))
      .build();

    const t0 = performance.now();
    await par.run({ message: 'go' });
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
