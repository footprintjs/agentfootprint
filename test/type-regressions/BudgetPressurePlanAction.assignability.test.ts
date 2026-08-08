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
 * ── 8.14.0 → 9.0.0: what the two replicas carry now ───────────────────────
 *
 * 8.14.0 added `unit` / `cap` / `projected` beside `capTokens` /
 * `projectedTokens`, which asserted a unit the slot channel does not use: a
 * slot counts CHARS, a window strategy fills the same event with TOKENS.
 * Through 8.x both pairs were written with identical values so nothing broke
 * mid-major. **9.0.0 removed the `*Tokens` pair from BOTH replicas.**
 *
 * One asymmetry survives on purpose, and it is design rather than drift:
 * `unit` is REQUIRED on the payload and OPTIONAL on the record.
 *
 *   • a consumer only ever READS a payload, so requiring it there costs them
 *     nothing and guarantees the unit is always answerable;
 *   • a slot builder WRITES a record — including one a consumer wrote — and a
 *     slot composition is counted in characters by construction, so an absent
 *     `unit` reads as `'chars'` without guessing.
 *
 * `ContextRecorder` closes that gap by filling `unit: 'chars'` on the way
 * past. `cap` / `projected` are required on both: a record carrying neither
 * pair would be a record with no numbers on it.
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
      cap: 2000,
      projected: 2447,
      overflowBy: 447,
      planAction: 'none',
    };
    expect(record.planAction).toBe('none');
  });

  it('assigns to ContextBudgetPressurePayload — what consumers receive', () => {
    const payload: BudgetPressurePayload = {
      slot: 'tools',
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

describe('unit is optional on the record, required on the payload (8.14.0 → 9.0.0)', () => {
  it('a record written WITHOUT `unit` still compiles — third-party slot builders', () => {
    // The one field a slot builder may leave off. If this stops compiling,
    // every consumer-written slot builder breaks on upgrade.
    const noUnit: BudgetPressureRecord = {
      slot: 'system-prompt',
      cap: 4000,
      projected: 4100,
      overflowBy: 100,
      planAction: 'none',
    };
    expect(noUnit.unit).toBeUndefined();
  });

  it('a record NORMALIZED the way ContextRecorder does satisfies the payload', () => {
    const record: BudgetPressureRecord = {
      slot: 'system-prompt',
      cap: 4000,
      projected: 4100,
      overflowBy: 100,
      planAction: 'none',
    };
    // This is `ContextRecorder.handleBudgetPressureWrite`, spelled out. The
    // annotation is the assertion: drop `unit` and it stops compiling, which
    // is the whole point of requiring it on the payload. `cap` / `projected`
    // need no `??` fallback since 9.0.0 — they are required on the record too,
    // so the normalization is one field wide.
    const dispatched: DispatchedPayload = {
      ...record,
      unit: record.unit ?? 'chars',
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

  it('9.0.0 — the token-named pair is gone from BOTH replicas', () => {
    // The removal has to land in lockstep, same as the `planAction` widening
    // above: `BudgetPressureRecord` and `ContextBudgetPressurePayload` are two
    // declarations of one fact, and a field kept on one of them is a field a
    // consumer will find on exactly half their code paths.
    const payload: BudgetPressurePayload = {
      slot: 'messages',
      overflowBy: 11_000,
      planAction: 'summarize',
      unit: 'tokens',
      cap: 120_000,
      projected: 131_000,
    };
    expect(payload.cap).toBe(120_000);
    expect(payload.projected).toBe(131_000);

    // Excess-property checking is what pins the removal at COMPILE time: an
    // object literal carrying `capTokens` is refused by both annotations, so
    // resurrecting either field fails `npm run test:types`. Spelled as a type
    // query rather than a literal so this file itself still compiles.
    type RecordKeys = keyof BudgetPressureRecord;
    type PayloadKeys = keyof BudgetPressurePayload;
    const removedOnRecord: Exclude<'capTokens' | 'projectedTokens', RecordKeys>[] = [
      'capTokens',
      'projectedTokens',
    ];
    const removedOnPayload: Exclude<'capTokens' | 'projectedTokens', PayloadKeys>[] = [
      'capTokens',
      'projectedTokens',
    ];
    // If either name came back, its `Exclude<>` collapses to `never` and the
    // array literal above stops compiling.
    expect(removedOnRecord).toEqual(['capTokens', 'projectedTokens']);
    expect(removedOnPayload).toEqual(['capTokens', 'projectedTokens']);
  });
});
