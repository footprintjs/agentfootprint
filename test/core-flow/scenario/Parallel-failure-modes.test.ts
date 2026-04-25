/**
 * Parallel — branch-failure modes (7-pattern matrix).
 *
 * Until v2 Phase-5, a failing branch inside Parallel was silently
 * swallowed: merge ran over the surviving branches and Parallel resolved
 * successfully. Fixed by routing each branch through a wrapper chart that
 * captures success/error as a typed `BranchOutcome`, then:
 *   - Default (strict): Merge throws if ANY outcome is `{ ok: false }`
 *   - Tolerant: `.mergeOutcomesWithFn((outcomes) => ...)` receives the
 *     full outcomes map and decides how to handle partial failure
 *
 * Tests cover: Unit · Scenario · Integration · Property · Security ·
 * Performance · ROI.
 */

import { describe, it, expect, vi } from 'vitest';
import { Parallel } from '../../../src/core-flow/Parallel.js';
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

// ── 1. Unit — BranchOutcome type guard + strict default ─────────────

describe('Parallel failure — unit', () => {
  it('strict default throws with aggregated message when any branch fails', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('bad', failing('kaboom'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    await expect(par.run({ message: 'go' })).rejects.toThrow(/kaboom/);
    await expect(par.run({ message: 'go' })).rejects.toThrow(/1 branch\(es\) failed/);
  });
});

// ── 2. Scenario — tolerant mode + fn-merge + llm-merge ──────────────

describe('Parallel failure — scenario', () => {
  it('tolerant mergeOutcomesWithFn sees a BranchOutcome map', async () => {
    const par = Parallel.create()
      .branch('a', ok('answer-A'))
      .branch('b', failing('provider down'))
      .branch('c', ok('answer-C'))
      .mergeOutcomesWithFn((outcomes) => {
        const lines = Object.entries(outcomes).map(([id, o]) =>
          o.ok ? `${id}=${o.value}` : `${id}=ERR(${o.error})`,
        );
        return lines.sort().join('\n');
      })
      .build();

    const out = await par.run({ message: 'go' });
    expect(out).toContain('a=answer-A');
    expect(out).toContain('b=ERR(provider down)');
    expect(out).toContain('c=answer-C');
  });

  it('strict mergeWithFn rejects even if majority of branches succeed', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .branch('bad', failing('one bad apple'))
      .mergeWithFn((r) => Object.keys(r).sort().join(','))
      .build();

    await expect(par.run({ message: 'go' })).rejects.toThrow(/one bad apple/);
  });

  it('strict mergeWithLLM never invokes the merge LLM on branch failure', async () => {
    const mergeCalled = vi.fn();
    const mergeProvider: LLMProvider = {
      name: 'merge-mock',
      complete: async (req) => {
        mergeCalled(req);
        return { content: 'merged', toolCalls: [], usage: { input: 0, output: 1 }, stopReason: 'stop' };
      },
    };
    const par = Parallel.create()
      .branch('ok', ok('A'))
      .branch('bad', failing('down'))
      .mergeWithLLM({ provider: mergeProvider, model: 'm', prompt: 'Sum:' })
      .build();

    await expect(par.run({ message: 'go' })).rejects.toThrow(/down/);
    expect(mergeCalled).not.toHaveBeenCalled();
  });
});

// ── 3. Integration — no regressions in the happy path ───────────────

describe('Parallel failure — integration (happy path unchanged)', () => {
  it('all-success run still returns the merged string', async () => {
    const par = Parallel.create()
      .branch('x', ok('X'))
      .branch('y', ok('Y'))
      .mergeWithFn((r) => `${r.x}+${r.y}`)
      .build();

    const out = await par.run({ message: 'go' });
    expect(out).toBe('X+Y');
  });

  it('all-success emits composition.exit with status=ok', async () => {
    const par = Parallel.create()
      .branch('x', ok('X'))
      .branch('y', ok('Y'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const exits: string[] = [];
    par.on('agentfootprint.composition.exit', (e) => exits.push(e.payload.status));
    await par.run({ message: 'go' });
    expect(exits).toEqual(['ok']);
  });

  it('failure emits composition.exit with status=err', async () => {
    const par = Parallel.create()
      .branch('ok', ok('A'))
      .branch('bad', failing('oh no'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const exits: string[] = [];
    par.on('agentfootprint.composition.exit', (e) => exits.push(e.payload.status));
    await expect(par.run({ message: 'go' })).rejects.toThrow();
    expect(exits).toEqual(['err']);
  });
});

// ── 4. Property — outcomes invariants ───────────────────────────────

describe('Parallel failure — property', () => {
  it.each([
    [0, 2],
    [1, 2],
    [2, 3],
    [3, 4],
  ])('with %d failures in %d branches, tolerant mode sees exactly N outcomes', async (nFail, nTotal) => {
    let b = Parallel.create();
    for (let i = 0; i < nTotal; i++) {
      const runner = i < nFail ? failing(`fail-${i}`) : ok(`ok-${i}`);
      b = b.branch(`branch${i}`, runner);
    }
    const par = b
      .mergeOutcomesWithFn((outcomes) => {
        const okCount = Object.values(outcomes).filter((o) => o.ok).length;
        const errCount = Object.values(outcomes).filter((o) => !o.ok).length;
        return `ok=${okCount} err=${errCount}`;
      })
      .build();

    const out = await par.run({ message: 'go' });
    expect(out).toBe(`ok=${nTotal - nFail} err=${nFail}`);
  });

  it('BranchOutcome is a strict discriminated union — ok implies value, !ok implies error', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('bad', failing('x'))
      .mergeOutcomesWithFn((outcomes) => {
        for (const [id, o] of Object.entries(outcomes)) {
          if (o.ok) {
            expect(typeof o.value).toBe('string');
            expect('error' in o).toBe(false);
          } else {
            expect(typeof o.error).toBe('string');
            expect('value' in o).toBe(false);
          }
          void id;
        }
        return 'verified';
      })
      .build();
    expect(await par.run({ message: 'go' })).toBe('verified');
  });
});

// ── 5. Security — hostile failures ──────────────────────────────────

describe('Parallel failure — security', () => {
  it('a branch throwing a non-Error value is coerced to a safe string in the outcome', async () => {
    const rogue: LLMProvider = {
      name: 'rogue',
      complete: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { mysterious: 'object-thrown' };
      },
    };
    const par = Parallel.create()
      .branch('ok', ok('A'))
      .branch('rogue', LLMCall.create({ provider: rogue, model: 'm' }).system('').build())
      .mergeOutcomesWithFn((outcomes) => {
        const r = outcomes['rogue'] as { ok: false; error: string };
        expect(r.ok).toBe(false);
        expect(typeof r.error).toBe('string');
        return 'handled';
      })
      .build();

    expect(await par.run({ message: 'go' })).toBe('handled');
  });

  it('every branch failing still surfaces as a useful error (not a hang)', async () => {
    const par = Parallel.create()
      .branch('a', failing('down-a'))
      .branch('b', failing('down-b'))
      .mergeWithFn((r) => Object.keys(r).join(','))
      .build();

    await expect(
      Promise.race([
        par.run({ message: 'go' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 5000)),
      ]),
    ).rejects.toThrow(/2 branch\(es\) failed/);
  });
});

// ── 6. Performance — no regression on happy path ────────────────────

describe('Parallel failure — performance', () => {
  it('4-branch all-success completes in under 500ms', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .branch('c', ok('C'))
      .branch('d', ok('D'))
      .mergeWithFn((r) => Object.values(r).sort().join(','))
      .build();

    const t0 = performance.now();
    await par.run({ message: 'go' });
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

// ── 7. ROI — reusable across many runs ──────────────────────────────

describe('Parallel failure — ROI', () => {
  it('10 sequential runs alternating success/failure behave consistently', async () => {
    const par = Parallel.create()
      .branch('ok', ok('A'))
      .branch('maybe', failing('sometimes'))
      .mergeOutcomesWithFn((outcomes) => {
        const okC = Object.values(outcomes).filter((o) => o.ok).length;
        return `ok=${okC}`;
      })
      .build();

    for (let i = 0; i < 10; i++) {
      const out = await par.run({ message: `r${i}` });
      // Every run: 1 ok, 1 fail → "ok=1" via tolerant merge
      expect(out).toBe('ok=1');
    }
  });

  it('consumer-attached recorders see branch events forwarded from each run', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    let llmStarts = 0;
    par.on('agentfootprint.stream.llm_start', () => llmStarts++);

    for (let i = 0; i < 3; i++) await par.run({ message: `r${i}` });
    // 2 branches * 3 runs = 6 llm_start events
    expect(llmStarts).toBe(6);
  });
});
