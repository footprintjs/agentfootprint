/**
 * Compile-level regression test — 7.6.1 widened `planAction` with `'none'`
 * so an over-budget slot can honestly report "no mitigation performed;
 * the full content was sent to the LLM".
 *
 * The member has to land in BOTH replicas of the union in lockstep:
 *   - `BudgetPressureRecord`        (src/recorders/core/types.ts) — what
 *     the slot builders write to the `slotBudgetPressures` scope key;
 *   - `ContextBudgetPressurePayload` (src/events/payloads.ts) — what
 *     `ContextRecorder` dispatches as
 *     `agentfootprint.context.budget_pressure`.
 *
 * Widening only one of them compiles fine inside the library (the record
 * is structurally copied into the payload through a typed dispatch that
 * erases at the boundary) but breaks any consumer that reads the event and
 * switches on `planAction`. This file lives under its own tsconfig
 * (./tsconfig.json, run via `npm run test:types`) so the REAL TypeScript
 * compiler checks the assignments, while its name still matches
 * `test/**\/*.test.ts` so `npm test` also runs the assertions.
 */
import { describe, expect, it } from 'vitest';
import type { BudgetPressureRecord } from '../../src/index';
import type { AgentfootprintEventMap, Payloads } from '../../src/events';

type BudgetPressurePayload = Payloads.ContextBudgetPressurePayload;
type DispatchedPayload =
  AgentfootprintEventMap['agentfootprint.context.budget_pressure']['payload'];

describe("planAction 'none' — stays assignable across both union replicas (7.6.1)", () => {
  it('assigns to BudgetPressureRecord — what the slot builders write', () => {
    // The annotation IS the assertion: this fails to COMPILE if `'none'`
    // is dropped from src/recorders/core/types.ts.
    const record: BudgetPressureRecord = {
      slot: 'tools',
      capTokens: 2000,
      projectedTokens: 2447,
      overflowBy: 447,
      planAction: 'none',
    };
    expect(record.planAction).toBe('none');
  });

  it('assigns to ContextBudgetPressurePayload — what consumers receive', () => {
    const payload: BudgetPressurePayload = {
      slot: 'tools',
      capTokens: 2000,
      projectedTokens: 2447,
      overflowBy: 447,
      planAction: 'none',
    };
    expect(payload.overflowBy).toBe(447);
  });

  it('a record flows into the dispatched payload without a cast', () => {
    const record: BudgetPressureRecord = {
      slot: 'system-prompt',
      capTokens: 4000,
      projectedTokens: 4100,
      overflowBy: 100,
      planAction: 'none',
    };
    // The lockstep check: if only ONE replica gained `'none'`, this
    // assignment stops compiling.
    const dispatched: DispatchedPayload = record;
    expect(dispatched.planAction).toBe('none');
  });

  it('the pre-existing members are untouched (additive widening only)', () => {
    const actions: BudgetPressureRecord['planAction'][] = ['evict', 'summarize', 'abort', 'none'];
    expect(actions).toHaveLength(4);
  });
});
