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
 *
 * ── 8.14.0: the two replicas are deliberately NO LONGER identical ──────────
 *
 * `unit` / `cap` / `projected` are REQUIRED on the payload and OPTIONAL on the
 * record, and that asymmetry is the design rather than drift:
 *
 *   • a consumer only ever READS a payload, so requiring the fields there
 *     costs them nothing and guarantees the unit is always answerable;
 *   • a slot builder WRITES a record — including one a consumer wrote — so
 *     requiring them there would break code that compiled in 8.13.
 *
 * `ContextRecorder` closes the gap by filling `unit: 'chars'` on the way past.
 * The tests below pin BOTH halves: the record must still compile without the
 * new fields, and the normalization must produce a payload that satisfies the
 * required ones.
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
      unit: 'chars',
      cap: 2000,
      projected: 2447,
    };
    expect(payload.overflowBy).toBe(447);
  });

  it('the pre-existing members are untouched (additive widening only)', () => {
    const actions: BudgetPressureRecord['planAction'][] = ['evict', 'summarize', 'abort', 'none'];
    expect(actions).toHaveLength(4);
  });
});

describe('unit / cap / projected — the asymmetry is deliberate (8.14.0)', () => {
  it('a record written WITHOUT the new fields still compiles', () => {
    // Exactly the object a 8.13-era slot builder produced. If this stops
    // compiling, the additive path was not additive.
    const legacy: BudgetPressureRecord = {
      slot: 'system-prompt',
      capTokens: 4000,
      projectedTokens: 4100,
      overflowBy: 100,
      planAction: 'none',
    };
    expect(legacy.unit).toBeUndefined();
  });

  it('a record NORMALIZED the way ContextRecorder does satisfies the payload', () => {
    const record: BudgetPressureRecord = {
      slot: 'system-prompt',
      capTokens: 4000,
      projectedTokens: 4100,
      overflowBy: 100,
      planAction: 'none',
    };
    // This is `ContextRecorder.handleBudgetPressureWrite`, spelled out. The
    // annotation is the assertion: drop any of the three and it stops
    // compiling, which is the whole point of requiring them on the payload.
    const dispatched: DispatchedPayload = {
      ...record,
      unit: record.unit ?? 'chars',
      cap: record.cap ?? record.capTokens,
      projected: record.projected ?? record.projectedTokens,
    };
    expect(dispatched.planAction).toBe('none');
    expect(dispatched.unit).toBe('chars');
    expect(dispatched.cap).toBe(4000);
    expect(dispatched.projected).toBe(4100);
  });

  it('unit is a closed two-member union on both replicas', () => {
    const units: NonNullable<BudgetPressureRecord['unit']>[] = ['chars', 'tokens'];
    const payloadUnits: BudgetPressurePayload['unit'][] = ['chars', 'tokens'];
    expect(units).toEqual(payloadUnits);
  });

  it('the deprecated names still carry the SAME numbers as the honest ones', () => {
    // Both pairs are written, always. A consumer mid-migration reads either
    // and gets the same answer — that is what makes the old names safe to
    // keep rather than a second source of truth.
    const payload: BudgetPressurePayload = {
      slot: 'messages',
      capTokens: 120_000,
      projectedTokens: 131_000,
      overflowBy: 11_000,
      planAction: 'summarize',
      unit: 'tokens',
      cap: 120_000,
      projected: 131_000,
    };
    expect(payload.cap).toBe(payload.capTokens);
    expect(payload.projected).toBe(payload.projectedTokens);
  });
});
