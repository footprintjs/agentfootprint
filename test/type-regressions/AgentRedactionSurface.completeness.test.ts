/**
 * Compile-level completeness — every PUBLIC member of `Agent` is classified
 * against the redaction law, so a member added later cannot reach a caller
 * without someone deciding which side of the law it is on.
 *
 * The law (`src/redaction/README.md`): an agent's `redact` covers everything
 * the library RETAINS OR SERVES about its runs, and never what the agent
 * computes on or hands back to its caller. Each member is one of:
 *
 *   - `'record'`      — served under the run's policy; the property test
 *                       (`test/redaction/agent-redaction.public-surface.property.test.ts`)
 *                       exercises every one and finds no selected value;
 *   - `'structure'`   — configuration, ids, counts, templates: no conversation
 *                       content to keep out (exercised by the same test);
 *   - `'callers-own'` — a value handed back to the CALLER in-process — the
 *                       run's answer or rejection, its continuation, its
 *                       verdicts — which the law never covers (the security
 *                       guide, "What it covers, and what it never covers");
 *   - `'control'`     — returns nothing a record could hold.
 *
 * `{ [K in keyof Agent]-?: … }` is exhaustive by type: a new public member is
 * a compile error here (`npm run test:types`) until it is classified.
 */
import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/index';

export type SurfaceKind = 'record' | 'structure' | 'callers-own' | 'control';

export const AGENT_PUBLIC_SURFACE: { readonly [K in keyof Agent]-?: SurfaceKind } = {
  // ── Records: served under the run's policy ─────────────────────────────
  getLastSnapshot: 'record',
  getSnapshot: 'record',
  getLastNarrativeEntries: 'record',
  on: 'record',
  once: 'record',
  attach: 'record',
  enable: 'record',
  emit: 'record',
  emitAttributed: 'record',
  getArtifactStore: 'record',
  bindSelfExplain: 'record',
  // ── Structure: no conversation content ─────────────────────────────────
  id: 'structure',
  name: 'structure',
  appName: 'structure',
  getCommitCount: 'structure',
  getSpec: 'structure',
  getUIGroup: 'structure',
  getUIGroupWith: 'structure',
  getSystemPromptCachePolicy: 'structure',
  commentaryTemplates: 'structure',
  thinkingTemplates: 'structure',
  ownsEvent: 'structure',
  listenerCount: 'structure',
  canExplain: 'structure',
  // ── The caller's own, in-process: never served ─────────────────────────
  run: 'callers-own',
  runTyped: 'callers-own',
  followUp: 'callers-own',
  resume: 'callers-own',
  resumeOnError: 'callers-own',
  checkpoint: 'callers-own',
  findings: 'callers-own',
  answerCoverage: 'callers-own',
  answerValidation: 'callers-own',
  stoppedEarly: 'callers-own',
  unsupportedValues: 'callers-own',
  outputContractUnmet: 'callers-own',
  assessment: 'callers-own',
  parseOutput: 'callers-own',
  parseOutputAsync: 'callers-own',
  outcomeOf: 'callers-own',
  // What was dropped — the pending question, in the person's words.
  abandonPause: 'callers-own',
  // ── Control: nothing a record could hold ───────────────────────────────
  off: 'control',
  removeAllListeners: 'control',
  shutdown: 'control',
  drainObservers: 'control',
  closeToolSessions: 'control',
};

describe('the Agent public surface is classified against the redaction law', () => {
  it('every member has exactly one side', () => {
    const kinds = new Set<SurfaceKind>(['record', 'structure', 'callers-own', 'control']);
    for (const kind of Object.values(AGENT_PUBLIC_SURFACE)) expect(kinds.has(kind)).toBe(true);
    expect(Object.keys(AGENT_PUBLIC_SURFACE).length).toBeGreaterThan(40);
  });
});
