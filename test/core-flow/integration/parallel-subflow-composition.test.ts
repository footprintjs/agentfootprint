/**
 * Integration — Parallel composition: native subflow mounting.
 *
 * These tests verify the post-v0.x architectural refactor: each branch is
 * mounted into the parent's FlowChart via `addSubFlowChart(branch.runner.getSpec(), ...)`,
 * NOT via a nested-executor wrapper. The guarantees this enables:
 *
 *   1. Single executor — no `new FlowChartExecutor(...)` inside a stage
 *   2. Single runtimeStageId address space — branch internals get globally-
 *      unique step ids in the parent executor's counter
 *   3. Single commitLog — branch commits show up in the parent's snapshot
 *   4. Spec free of `RunBranch` wrapper stages — `Parallel.getSpec()` mounts
 *      each branch's chart directly under the fork node
 *   5. Per-branch errors still surface (via FlowRecorder.onError correlation)
 *
 * Each invariant below would FAIL against the wrapper-based v0.x design.
 * Keep these tests as regression guards against architectural drift.
 */

import { describe, it, expect } from 'vitest';
import { Parallel } from '../../../src/core-flow/Parallel.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

const ok = (reply: string) =>
  LLMCall.create({ provider: new MockProvider({ reply }), model: 'm' }).system('').build();

const failing = (msg: string) => {
  const provider: LLMProvider = {
    name: 'boom',
    complete: async () => {
      throw new Error(msg);
    },
  };
  return LLMCall.create({ provider, model: 'm' }).system('').build();
};

describe('Parallel — native subflow mounting', () => {
  it('spec mounts branch charts directly — no RunBranch wrapper stage', () => {
    const par = Parallel.create()
      .branch('legal', ok('L'))
      .branch('ethics', ok('E'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const spec = par.getSpec();
    // Branch subflows are mounted at the TOP-LEVEL keys `legal` and
    // `ethics`. Inside each branch, the LLMCall runner introduces its
    // own nested subflows (sf-system-prompt / sf-messages / sf-tools),
    // path-prefixed by the mount id (e.g., `legal/sf-system-prompt`).
    // That nesting is the LLMCall's own internal structure — we don't
    // touch it here, only confirm that the top-level branch keys exist
    // and that their root stages are the runner's own (not `RunBranch`).
    const subflows = spec.subflows ?? {};
    const topLevelBranchKeys = Object.keys(subflows).filter((k) => !k.includes('/'));
    expect(topLevelBranchKeys.sort()).toEqual(['ethics', 'legal']);

    for (const id of ['legal', 'ethics']) {
      const branchChart = subflows[id]!;
      // Architectural assertion: the branch's root MUST be the runner's
      // own root, not a `RunBranch` / `run-branch` shim.
      expect(branchChart.root.name).not.toBe('RunBranch');
      expect(branchChart.root.id).not.toBe('run-branch');
    }
  });

  it('shares the parent executor\'s execution counter across branch internals', async () => {
    // Architectural guarantee: footprintjs's `SubflowExecutor` inherits
    // the parent's `executionCounter` when mounting a chart via
    // `addSubFlowChart`. Branch-internal stages consume counter slots
    // even though their commits live in the branch's nested runtime —
    // the COUNTER is shared, the COMMIT LOGS are per-runtime.
    //
    // Observable proof: the `merge` stage's `runtimeStageId` reports a
    // counter value that is much higher than `seed#0`, because the
    // branches' internal stages incremented it on the way. With a
    // wrapper-based / nested-executor design the merge would land at
    // `merge#3` or so (just past seed + two branch boundaries).
    const par = Parallel.create()
      .branch('legal', ok('L'))
      .branch('ethics', ok('E'))
      .mergeWithFn((r) => Object.values(r).sort().join(','))
      .build();

    await par.run({ message: 'go' });

    const snapshot = par.getLastSnapshot();
    expect(snapshot).toBeDefined();

    const mergeCommit = snapshot!.commitLog.find((c) => c.stageId === 'merge');
    expect(mergeCommit).toBeDefined();
    const mergeIdx = Number(mergeCommit!.runtimeStageId.split('#').pop());

    // Each LLMCall internally has several stages
    // (compose-sys, compose-msgs, call-llm, etc.). With direct mount
    // the parent counter ticks through all of them. A merge index
    // greater than ~5 demonstrates the shared counter is doing work.
    expect(mergeIdx).toBeGreaterThan(5);
  });

  it('parent snapshot exposes branch internals via subflowResults', async () => {
    // With direct mounting, branch internal stages still live in their
    // own nested ExecutionRuntime — but that runtime's snapshot
    // (including its commitLog) is merged into the parent snapshot's
    // `subflowResults` map. Domain consumers can reach branch trace
    // detail without crossing an executor boundary.
    const par = Parallel.create()
      .branch('legal', ok('L'))
      .branch('ethics', ok('E'))
      .mergeWithFn((r) => Object.values(r).join('|'))
      .build();

    await par.run({ message: 'go' });

    const snapshot = par.getLastSnapshot();
    expect(snapshot).toBeDefined();
    const subflowResults = (snapshot as { subflowResults?: Record<string, unknown> })
      .subflowResults ?? {};
    // Every branch produced a subflow result keyed by its mount id.
    expect(Object.keys(subflowResults)).toEqual(
      expect.arrayContaining(['legal', 'ethics']),
    );
  });

  it('forwards per-branch error messages to the merge stage (recorder-correlated)', async () => {
    // The wrapper try/catch is gone, but per-branch error messages are
    // preserved via an internal FlowRecorder.onError listener that
    // correlates each error to its originating branch via the
    // engine-prefixed stageId. The merge stage reads from that map.
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', failing('provider down'))
      .branch('c', ok('C'))
      .mergeOutcomesWithFn((outcomes) =>
        Object.entries(outcomes)
          .map(([id, o]) => (o.ok ? `${id}=ok` : `${id}=err:${o.error}`))
          .sort()
          .join('|'),
      )
      .build();

    const out = await par.run({ message: 'go' });
    expect(out).toContain('b=err:provider down');
    expect(out).toContain('a=ok');
    expect(out).toContain('c=ok');
  });

  it('branch typed events flow naturally through the parent executor (no $emit forwarding)', async () => {
    // The old wrapper subscribed branch.runner.on('*') and re-emitted
    // every event through scope.$emit. With direct subflow mounting,
    // the branch's recorders are attached to the SAME executor — so
    // events propagate through the existing dispatcher without manual
    // forwarding. Two branches × one llm_start each = exactly 2 events.
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    let starts = 0;
    par.on('agentfootprint.stream.llm_start', () => starts++);

    await par.run({ message: 'go' });
    expect(starts).toBe(2);
  });

  it('rejects branch ids containing "/" — they collide with subflow-path correlation', () => {
    // Per Decision 8 + 7-panel review: a branch id with `/` would
    // silently shadow the engine-prefixed stageId used to map errors
    // back to the originating branch. Reject at build time.
    expect(() =>
      Parallel.create().branch('legal/special', ok('X')),
    ).toThrow(/must not contain '\/'/);
  });
});

// ── merge_end event payload — typed-event-shape regression guards ───
describe('Parallel — merge_end event shape', () => {
  it('emits strategy="outcomes-fn" for tolerant-mode merges (not collapsed to "fn")', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeOutcomesWithFn((outcomes) =>
        Object.values(outcomes)
          .map((o) => (o.ok ? o.value : '!'))
          .join(','),
      )
      .build();

    const captured: Array<{ strategy: string; mergedBranchCount: number; totalBranchCount: number }> = [];
    par.on('agentfootprint.composition.merge_end', (e) => {
      captured.push({
        strategy: e.payload.strategy,
        mergedBranchCount: e.payload.mergedBranchCount,
        totalBranchCount: e.payload.totalBranchCount,
      });
    });

    await par.run({ message: 'go' });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.strategy).toBe('outcomes-fn');
    expect(captured[0]!.mergedBranchCount).toBe(2);
    expect(captured[0]!.totalBranchCount).toBe(2);
  });

  it('mergedBranchCount counts only succeeded branches; totalBranchCount is the declared total', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', failing('down'))
      .branch('c', ok('C'))
      .mergeOutcomesWithFn(() => 'merged')
      .build();

    let payload: { mergedBranchCount: number; totalBranchCount: number } | undefined;
    par.on('agentfootprint.composition.merge_end', (e) => {
      payload = {
        mergedBranchCount: e.payload.mergedBranchCount,
        totalBranchCount: e.payload.totalBranchCount,
      };
    });

    await par.run({ message: 'go' });
    expect(payload).toBeDefined();
    expect(payload!.mergedBranchCount).toBe(2);
    expect(payload!.totalBranchCount).toBe(3);
  });
});

// ── Paused branch propagation ───────────────────────────────────────
describe('Parallel — paused branch propagation', () => {
  it('a branch pausing inside its runner surfaces as RunnerPauseOutcome at the Parallel boundary', async () => {
    const scripted = (...responses: readonly LLMResponse[]): LLMProvider => {
      let i = 0;
      return {
        name: 'mock',
        complete: async () => responses[Math.min(i++, responses.length - 1)]!,
      };
    };
    const resp = (
      content: string,
      toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
    ): LLMResponse => ({
      content,
      toolCalls,
      usage: { input: 0, output: 1 },
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
    });

    // A pausable Agent — its tool calls pauseHere() on first invocation.
    const pausableAgent = Agent.create({
      provider: scripted(
        resp('', [{ id: 't1', name: 'approve', args: { item: 'X' } }]),
        resp('approved'),
      ),
      model: 'mock',
    })
      .system('')
      .tool({
        schema: { name: 'approve', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          pauseHere({ question: 'Approve?' });
          return '';
        },
      })
      .build();

    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('pause-me', pausableAgent)
      .mergeWithFn((r) => Object.values(r).join(','))
      .build();

    const result = await par.run({ message: 'go' });
    // The Parallel must surface the pause as a RunnerPauseOutcome — NOT
    // swallow it as an error nor complete with a partial merge.
    expect(isPaused(result)).toBe(true);
  });
});

// ── Merge-stage failure paths ───────────────────────────────────────
describe('Parallel — merge stage failure', () => {
  it('emits composition.exit status="err" when the merge stage itself throws', async () => {
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithFn(() => {
        throw new Error('merge-fn boom');
      })
      .build();

    const statuses: string[] = [];
    par.on('agentfootprint.composition.exit', (e) => statuses.push(e.payload.status));

    await expect(par.run({ message: 'go' })).rejects.toThrow(/merge-fn boom/);
    // Without the try/catch around the merge body this would be empty
    // — meaning the run had a `composition.enter` with no matching
    // `composition.exit`. Now: exactly one 'err' exit.
    expect(statuses).toEqual(['err']);
  });

  it('emits composition.exit status="err" when mergeWithLLM throws after branches succeed', async () => {
    const mergeProvider: LLMProvider = {
      name: 'merge-down',
      complete: async () => {
        throw new Error('merge-llm down');
      },
    };
    const par = Parallel.create()
      .branch('a', ok('A'))
      .branch('b', ok('B'))
      .mergeWithLLM({ provider: mergeProvider, model: 'm', prompt: 'sum:' })
      .build();

    const statuses: string[] = [];
    par.on('agentfootprint.composition.exit', (e) => statuses.push(e.payload.status));

    await expect(par.run({ message: 'go' })).rejects.toThrow(/merge-llm down/);
    expect(statuses).toEqual(['err']);
  });
});
