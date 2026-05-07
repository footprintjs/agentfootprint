/**
 * Regression: every subflow declared in `SUBFLOW_IDS` (and every decider
 * stage in `STAGE_IDS` that's pure plumbing) MUST be categorized as
 * either:
 *
 *   - A slot subflow (system-prompt / messages / tools — filtered by
 *     `slotKind` in BoundaryRecorder, attributed to the next LLM call)
 *   - Agent-internal plumbing (`AGENT_INTERNAL_LOCAL_IDS` in
 *     BoundaryRecorder.ts — filtered out of the user-facing StepGraph)
 *   - Explicitly user-facing (a known primitive — Agent, LLMCall, etc.)
 *
 * If someone adds a new entry to `SUBFLOW_IDS` and forgets to register
 * it in the right place, this test fails by NAME so the bug is caught
 * before it leaks fake "steps" into Lens.
 *
 * What v2.6 missed:
 *   - SUBFLOW_IDS.INJECTION_ENGINE  (was always missing — pre-existing)
 *   - SUBFLOW_IDS.CACHE_DECISION    (added in v2.6, never registered)
 *   - STAGE_IDS.CACHE_GATE          (added in v2.6, never registered)
 *
 * → Each iteration of the agent leaked these 3 as fake user steps,
 * inflating Lens's step count by ~3 per iteration. This test prevents
 * that recurring.
 */

import { describe, expect, it } from 'vitest';
import { SUBFLOW_IDS, STAGE_IDS } from '../../../src/conventions.js';

// ── Categorization (mirror BoundaryRecorder.ts) ──────────────────────

/** Slot subflows — handled by `slotKind` tagging, NOT by the internal set. */
const SLOT_SUBFLOW_IDS: ReadonlySet<string> = new Set<string>([
  SUBFLOW_IDS.SYSTEM_PROMPT,
  SUBFLOW_IDS.MESSAGES,
  SUBFLOW_IDS.TOOLS,
]);

/** Subflow ids that are pure plumbing — must match
 *  `AGENT_INTERNAL_LOCAL_IDS` in BoundaryRecorder.ts. */
const EXPECTED_INTERNAL_SUBFLOW_IDS: ReadonlySet<string> = new Set<string>([
  SUBFLOW_IDS.INJECTION_ENGINE,
  SUBFLOW_IDS.ROUTE,
  SUBFLOW_IDS.TOOL_CALLS,
  SUBFLOW_IDS.FINAL,
  SUBFLOW_IDS.MERGE,
  SUBFLOW_IDS.CACHE_DECISION,
  SUBFLOW_IDS.THINKING, // v2.14 — normalize-thinking mount; payload folds onto parent LLM step
]);

/** Decider stage ids that are pure plumbing. */
const EXPECTED_INTERNAL_STAGE_IDS: ReadonlySet<string> = new Set<string>([STAGE_IDS.CACHE_GATE]);

describe('SUBFLOW_IDS coverage — every subflow categorized', () => {
  it('every SUBFLOW_IDS entry is either a slot OR an internal subflow', () => {
    const uncategorized: string[] = [];
    for (const [name, id] of Object.entries(SUBFLOW_IDS)) {
      const isSlot = SLOT_SUBFLOW_IDS.has(id);
      const isInternal = EXPECTED_INTERNAL_SUBFLOW_IDS.has(id);
      if (!isSlot && !isInternal) {
        uncategorized.push(`SUBFLOW_IDS.${name} = '${id}'`);
      }
    }
    expect(
      uncategorized,
      `Uncategorized SUBFLOW_IDS — add to BoundaryRecorder's AGENT_INTERNAL_LOCAL_IDS ` +
        `(if it's plumbing) OR to the SLOT_SUBFLOW_IDS list above (if it's a context slot). ` +
        `Otherwise these subflows leak as fake user-visible steps in Lens:\n  ` +
        uncategorized.join('\n  '),
    ).toEqual([]);
  });

  it('AGENT_INTERNAL_LOCAL_IDS (mirrored here) covers every internal subflow', () => {
    // Soft check: if a new SUBFLOW_IDS entry was added that should be
    // internal but the test author forgot to mirror it here, surface
    // that. Pairs with the cross-check inside BoundaryRecorder itself.
    const expected = [...EXPECTED_INTERNAL_SUBFLOW_IDS].sort();
    const allIds = new Set(Object.values(SUBFLOW_IDS));
    for (const id of expected) {
      expect(
        allIds.has(id),
        `${id} is in EXPECTED_INTERNAL_SUBFLOW_IDS but not in SUBFLOW_IDS`,
      ).toBe(true);
    }
  });

  it('STAGE_IDS internal-decider entries all exist', () => {
    const allStageIds = new Set(Object.values(STAGE_IDS));
    for (const id of EXPECTED_INTERNAL_STAGE_IDS) {
      expect(
        allStageIds.has(id),
        `${id} is in EXPECTED_INTERNAL_STAGE_IDS but not in STAGE_IDS`,
      ).toBe(true);
    }
  });
});
