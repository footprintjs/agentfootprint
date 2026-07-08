/**
 * Compile-level regression test — 7.3.0 shipped `onResume` on
 * `ToolChoiceRecorderHandle` (src/recorders/observability/ToolChoiceRecorder.ts,
 * commit f0a87de) typed with a slice that broke assignability to
 * footprintjs's `CombinedRecorder` — the exact type `AgentBuilder.recorder()`
 * accepts (src/core/agent/AgentBuilder.ts:274). A consumer doing
 * `Agent.create(...).recorder(toolChoiceRecorder(...))` failed to typecheck,
 * even though the recorder worked fine at runtime.
 *
 * The existing 22 ToolChoiceRecorder tests (test/recorders/observability/
 * ToolChoiceRecorder.test.ts) never caught this — vitest transpiles test
 * files with esbuild, which strips types without checking them, and the
 * ordinary `test/**` tree isn't covered by the root `npx tsc --noEmit`
 * (tsconfig.json's `include` is `src/**\/*` only).
 *
 * This file lives under its own tsconfig (./tsconfig.json, run via
 * `npm run test:types`) so the REAL TypeScript compiler checks it, while
 * its name still matches `test/**\/*.test.ts` so `npm test` (vitest) also
 * exercises the same lines at runtime. Both must pass for a repeat of this
 * regression to be caught: `test:types` catches the type break, this
 * suite's assertions prove the fix didn't change runtime behavior.
 */
import { describe, expect, it } from 'vitest';
import type { CombinedRecorder } from 'footprintjs';
import { Agent } from '../../src/index';
import { mock } from '../../src/llm-providers';
import type { LLMProvider } from '../../src/llm-providers';
import { mockEmbedder } from '../../src/memory/embedding/mockEmbedder';
import {
  toolChoiceRecorder,
  type ToolChoiceRecorderHandle,
} from '../../src/recorders/observability/ToolChoiceRecorder';

describe('ToolChoiceRecorderHandle — stays assignable to CombinedRecorder (7.3.0 regression)', () => {
  it('assigns directly to a CombinedRecorder-typed binding', () => {
    const handle: ToolChoiceRecorderHandle = toolChoiceRecorder({ embedder: mockEmbedder() });

    // The assignment on the next line IS the assertion: it fails to
    // COMPILE (not merely fails a runtime check) if `ToolChoiceRecorderHandle`
    // ever drifts out of `CombinedRecorder`'s structural shape again.
    const asCombinedRecorder: CombinedRecorder = handle;

    expect(asCombinedRecorder.id).toBe('tool-choice');
  });

  it('passes to the real AgentBuilder.recorder() call site (the failing shape from the demo)', () => {
    const handle = toolChoiceRecorder({ embedder: mockEmbedder() });
    const provider: LLMProvider = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });

    // Mirrors `agentBuilder.recorder(choice)` from the downstream demo
    // (hcifootprint-demo/dress-shop/src/chatbot/assistant.ts) — the exact
    // line that failed TS2345 under the 7.3.0 regression.
    const agent = Agent.create({ provider, model: 'mock' })
      .system('regression probe')
      .recorder(handle)
      .build();

    expect(typeof agent.run).toBe('function');
  });
});
