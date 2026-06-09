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
import { Parallel, wrapBranchOutputMapper } from '../../../src/core-flow/Parallel.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import type { LLMProvider } from '../../../src/adapters/types.js';

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
function branchErrorsOf(par: Parallel): Map<string, string> {
  return (par as unknown as { branchErrors: Map<string, string> }).branchErrors;
}

// ── 1. Unit — wrapBranchOutputMapper + failFast stamping ────────────

describe('Parallel required — unit', () => {
  it('wrapBranchOutputMapper records a mapper throw against the branch id and rethrows', () => {
    const errs = new Map<string, string>();
    const wrapped = wrapBranchOutputMapper('legal', errs, () => {
      throw new Error('mapper boom');
    });

    expect(() => wrapped('whatever')).toThrow('mapper boom');
    expect(errs.get('legal')).toBe('mapper boom');
  });

  it('wrapBranchOutputMapper keeps the FIRST error per branch (mirrors the recorder)', () => {
    const errs = new Map<string, string>([['legal', 'earlier error']]);
    const wrapped = wrapBranchOutputMapper('legal', errs, () => {
      throw new Error('later error');
    });

    expect(() => wrapped('x')).toThrow('later error');
    expect(errs.get('legal')).toBe('earlier error');
  });

  it('wrapBranchOutputMapper passes success through untouched and records nothing', () => {
    const errs = new Map<string, string>();
    const wrapped = wrapBranchOutputMapper('legal', errs, (sfOutput) => ({
      branchResults: { legal: sfOutput },
    }));

    expect(wrapped('fine')).toEqual({ branchResults: { legal: 'fine' } });
    expect(errs.size).toBe(0);
  });

  it('wrapBranchOutputMapper coerces a non-Error throw to a string message', () => {
    const errs = new Map<string, string>();
    const wrapped = wrapBranchOutputMapper('rogue', errs, () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string-thrown';
    });

    expect(() => wrapped('x')).toThrow();
    expect(errs.get('rogue')).toBe('string-thrown');
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
