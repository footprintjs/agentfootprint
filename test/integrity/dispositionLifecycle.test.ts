/**
 * The disposition ledger goes LIVE — every run answers "did the checkers
 * run, and what did they see?" (T9's run-lifecycle half).
 *
 * The failure this wires against is named in the ledger's own header: two
 * shipped checks in this codebase decayed into decoration — unhooked, green,
 * counted by nobody. Per run: registered checks note one disposition per
 * encounter; the run's end files ONE `integrity.disposition` event with the
 * rows; and under `integrityPosture: 'dev'` a canary proves each pure check
 * can still catch its own synthetic defect, with `assertAlive` throwing on a
 * run whose checkers demonstrably never ran.
 *
 * Test types (Convention 3): unit (beginIntegrityRun registration + canary) /
 * functional (the live loop: rows carry real dispositions; the shadowing park
 * shows checked-fail) / contract (dev posture completes healthy; synthetic
 * counts quarantined; one event per run).
 */

import { describe, expect, it } from 'vitest';
import {
  beginIntegrityRun,
  type IntegrityChecksPresent,
} from '../../src/integrity/disposition/lifecycle.js';
import { Agent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';

// ---------------------------------------------------------------------------
// The lifecycle module, on its own
// ---------------------------------------------------------------------------

const ALL: IntegrityChecksPresent = { wire: true, composeInvariant: true, dangling: true };

describe('unit: beginIntegrityRun', () => {
  it('a check armed alone still leaves the other two registered — as not-applicable rows, never absences', () => {
    // REVERSED by design. The old law read: "an unarmed check is absent
    // from `report()` — no row, no trace it was ever considered." Absence
    // read as silence, and silence is exactly what let two shipped checks
    // in this codebase decay into decoration without anyone noticing. The
    // new law: every optional check registers on EVERY run, armed or not,
    // so "never armed" and "armed and never ran" are both visible rows
    // instead of sharing one blank spot a reader has to interpret.
    //
    // dangling stays unarmed here while composeInvariant IS armed, so one
    // fixture pins both halves at once: the armed check must be genuinely
    // armed — no `not-applicable` note filed on its behalf at registration
    // time, its silence (if any) has to come from a real encounter later
    // in the run — and the unarmed one must still be a row, already
    // carrying the honest verdict "no subject this run" rather than being
    // missing entirely.
    const ledger = beginIntegrityRun(
      { wire: true, composeInvariant: true, dangling: false },
      'observe',
    );
    const rows = ledger.report();
    // wire + compose/invariant-violation (armed) + compose/dangling-reference
    // (unarmed) + choice/unsupported-argument (unarmed — same `argumentsFrom`
    // declaration arms it) + claim/unsupported-claim (unarmed) +
    // write/empty-lookup (unarmed — 9.77.0, two halves) +
    // write/column-type-mismatch and write/missing-column (unarmed — 9.78.0,
    // two halves, one declaration arming both) — eight rows, always.
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.seam === 'wire')).toMatchObject({ check: 'invariant-violation' });
    // The armed check: registered, and genuinely armed.
    const composeInvariantRow = rows.find(
      (r) => r.seam === 'compose' && r.check === 'invariant-violation',
    );
    expect(composeInvariantRow).toMatchObject({ checked: 0, findings: 0, notApplicable: 0 });
    // The two the caller never armed: still rows, each already noted
    // not-applicable rather than left as an inferred blank.
    const danglingRow = rows.find((r) => r.check === 'dangling-reference');
    expect(danglingRow).toMatchObject({
      seam: 'compose',
      notApplicable: 1,
      checked: 0,
      findings: 0,
    });
    // One declaration arms two checks, so an unarmed `argumentsFrom` leaves
    // BOTH of them as honest not-applicable rows, at their own seams.
    expect(rows.find((r) => r.check === 'unsupported-argument')).toMatchObject({
      seam: 'choice',
      notApplicable: 1,
      checked: 0,
      findings: 0,
    });
    const claimRow = rows.find((r) => r.check === 'unsupported-claim');
    expect(claimRow).toMatchObject({ seam: 'claim', notApplicable: 1, checked: 0, findings: 0 });
  });

  it('nothing opted-in registers all seven opt-in checks as not-applicable, not silence', () => {
    // The exact shape that used to be indistinguishable from "everything
    // passed": only `wire` present, none of the opt-in checks armed.
    const ledger = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: false },
      'observe',
    );
    const rows = ledger.report();
    expect(rows).toHaveLength(8);
    const wireRow = rows.find((r) => r.seam === 'wire');
    expect(wireRow).toMatchObject({ check: 'invariant-violation' });
    for (const [check, seam] of [
      ['invariant-violation', 'compose'],
      ['dangling-reference', 'compose'],
      ['unsupported-argument', 'choice'],
      ['unsupported-claim', 'claim'],
      ['empty-lookup', 'write'],
      ['column-type-mismatch', 'write'],
      ['missing-column', 'write'],
    ] as const) {
      const row = rows.find((r) => r.check === check && r.seam === seam);
      expect(row).toMatchObject({ checked: 0, findings: 0, notApplicable: 1, unreachable: 0 });
    }
    // `not-applicable` counts as touched — this state can never itself trip
    // the wiring-rot alarm, because opting out of a check is not rot. (No
    // `note()` was filed for `wire` here — a synthetic ledger, not a run —
    // so `workExisted` stays false to isolate what this test is actually
    // checking: the three opt-in rows, not wire's own liveness.)
    expect(() => ledger.assertAlive({ workExisted: false })).not.toThrow();
  });

  it('a partial run — one opt-in check armed, two not — is exactly when the unarmed rows matter most', () => {
    // This pins the OPPOSITE of an earlier, rejected all-or-nothing design:
    // that design would have gone quiet the moment ANY optional check was
    // armed, on the reasoning "something ran, so the ledger has a story to
    // tell." That is backwards. The shape this library actually sees in
    // the field is PARTIAL: a consumer wires `.claims()` and stops there,
    // never learning that the compose-invariant and dangling-reference
    // checks sat out the entire run. Per-check registration (rather than
    // one shared flag) means arming one check can never suppress the rows
    // for the two it didn't arm — the partial case is precisely when the
    // remaining blind spots start to matter, so it is the LAST case that
    // should ever go quiet.
    const ledger = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: false, claim: true },
      'observe',
    );
    const rows = ledger.report();
    // wire + all seven opt-ins, armed or not — eight rows, always.
    expect(rows).toHaveLength(8);
    const claimRow = rows.find((r) => r.check === 'unsupported-claim');
    expect(claimRow).toMatchObject({ seam: 'claim', notApplicable: 0 });
    for (const [check, seam] of [
      ['invariant-violation', 'compose'],
      ['dangling-reference', 'compose'],
      ['unsupported-argument', 'choice'],
      ['empty-lookup', 'write'],
      ['column-type-mismatch', 'write'],
      ['missing-column', 'write'],
    ] as const) {
      const row = rows.find((r) => r.check === check && r.seam === seam);
      expect(row).toMatchObject({ notApplicable: 1 });
    }
  });

  it('dev posture mints AND catches one canary per REGISTERED check — including a not-applicable one', () => {
    // A canary is minted for every REGISTERED check, not only for the ones
    // this run armed.
    //
    // The question is whether a check that is registered but not-applicable
    // this run should still prove itself. It should, and for the same reason
    // the not-applicable row exists at all: a checker that has ROTTED and a
    // checker that simply had no subject file an identical row, and the
    // canary is the only thing that separates them. Without it we would have
    // removed one ambiguity at the arming level and reintroduced it one level
    // down.
    //
    // The cost is a pure function against a fixture. The alternative — prove
    // only what the app armed — means that the day somebody finally declares
    // `.claims()`, they inherit whatever state that checker rotted into while
    // nobody was looking, with nothing in the record saying how long it had
    // been dead.
    const ledger = beginIntegrityRun(ALL, 'dev');
    const rows = ledger.report();
    // wire + compose/invariant-violation + compose/dangling-reference +
    // choice/unsupported-argument (all four armed by `ALL`, the last two off
    // the one `dangling` declaration) + claim/unsupported-claim and
    // write/empty-lookup + the two write/column rows (NOT armed — `ALL`
    // omits those flags, so they register as not-applicable, and still prove
    // themselves with a canary).
    expect(rows).toHaveLength(8);
    const registeredChecks = [
      { check: 'invariant-violation', seam: 'wire' },
      { check: 'invariant-violation', seam: 'compose' },
      { check: 'dangling-reference', seam: 'compose' },
      { check: 'unsupported-argument', seam: 'choice' },
    ] as const;
    for (const { check, seam } of registeredChecks) {
      const row = rows.find((r) => r.check === check && r.seam === seam)!;
      expect(row.synthetic).toBe(1);
      // Real counts untouched by the canary.
      expect(row.findings).toBe(0);
      expect(row.checked).toBe(0);
    }
    // The un-armed row proves itself too: registered, honestly noted
    // not-applicable for this run, and still carrying a caught canary — so a
    // reader can tell "no subject today" apart from "this checker is dead".
    for (const check of ['unsupported-claim', 'empty-lookup'] as const) {
      const unarmed = rows.find((r) => r.check === check)!;
      expect(unarmed.notApplicable).toBe(1);
      expect(unarmed.synthetic).toBe(1);
    }
    // Every registered check minted and caught its canary, so theorem (i)
    // and theorem (ii) both hold and a healthy dev run does not throw.
    expect(() => ledger.assertAlive({ workExisted: false })).not.toThrow();
  });

  it('observe posture mints no canary', () => {
    const ledger = beginIntegrityRun(ALL, 'observe');
    for (const row of ledger.report()) expect(row.synthetic).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Through the live loop
// ---------------------------------------------------------------------------

const call = (id: string, name: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});
const done = { content: 'done', toolCalls: [], stopReason: 'stop' as const };

const screen = () =>
  defineTool({
    name: 'screen_open',
    description: 's',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'ok',
  });

describe('functional: the run files its disposition rows', () => {
  it('a healthy default agent: one event, a checked-pass wire row PLUS the seven opt-ins as not-applicable', async () => {
    // This agent declares no maps plan, no `argumentsFrom` tool, no claims
    // contract — the exact "nothing armed" shape the per-check registration
    // law makes observable (see 'nothing opted-in registers all seven
    // opt-in checks as not-applicable, not silence', above).
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'screen_open'), done] }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .tool(screen())
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });
    await agent.run('go');
    expect(events).toHaveLength(1);
    const rows = events[0]!.rows as CheckReport[];
    expect(rows).toHaveLength(8);
    const wireRow = rows.find((r) => r.seam === 'wire')!;
    expect(wireRow).toMatchObject({ check: 'invariant-violation', findings: 0 });
    expect(wireRow.checked).toBeGreaterThanOrEqual(2); // one per LLM call
    for (const [check, seam] of [
      ['invariant-violation', 'compose'],
      ['dangling-reference', 'compose'],
      ['unsupported-argument', 'choice'],
      ['unsupported-claim', 'claim'],
      ['empty-lookup', 'write'],
      ['column-type-mismatch', 'write'],
      ['missing-column', 'write'],
    ] as const) {
      expect(rows.find((r) => r.check === check && r.seam === seam)).toMatchObject({
        checked: 0,
        findings: 0,
        notApplicable: 1,
      });
    }
    expect(events[0]!.workExisted).toBe(true);
  });

  it('the shadowing park serves nothing for the parked name — the compose row records a clean check, not a finding', async () => {
    // The provider-shadowing trap from invariantViolation.test.ts, verbatim
    // in shape: a parked map whose tool name a provider copy USED TO keep
    // serving. Change A (buildToolsSlot.ts) closes the leak at its
    // source — the park hold-out now filters the PROVIDER route too, the
    // same as the registry and dynamic routes already had it — so by the
    // time this pass reaches the compose-seam backstop there is nothing
    // left on the wire to compare against and find guilty. The backstop
    // itself is untouched and still runs every pass; it simply has
    // nothing left to report.
    const zoneTool = defineTool({
      name: 'get_zone_info',
      description: 'z',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'zones',
    });
    const zoneAudit = defineSkill({
      id: 'zone-audit',
      description: 'a',
      body: 'Z',
      tools: [zoneTool],
    });
    const billing = defineSkill({ id: 'billing', description: 'b', body: 'B' });
    const graph = skillGraph()
      .entry(zoneAudit, { match: { keywords: ['zone'] } })
      .route(zoneAudit, billing)
      .build();
    const events: Array<Record<string, unknown>> = [];
    const toolsPerCall: Array<{ iteration: number; names: string[] }> = [];
    let parkedAtIteration: number | undefined;
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('c1', 'screen_open'),
          call('c2', 'screen_open'),
          call('c3', 'screen_open'),
          call('c4', 'screen_open'),
          done,
        ],
      }),
      model: 'mock',
      maxIterations: 8,
    })
      .system('s')
      .tool(screen())
      .skillGraph(graph)
      .maps({ renewalGrace: 3 })
      .toolProvider({
        id: 'shadow-provider',
        list: () => [
          defineTool({
            name: 'get_zone_info',
            description: 'provider copy',
            inputSchema: { type: 'object', properties: {} },
            execute: () => 'provider zones',
          }),
        ],
      })
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });
    agent.on('agentfootprint.map.parked', (e) => {
      parkedAtIteration = e.payload.iteration;
    });
    agent.on('agentfootprint.stream.llm_start', (e) => {
      toolsPerCall.push({
        iteration: e.payload.iteration,
        names: (e.payload.tools ?? []).map((t) => t.name),
      });
    });
    await agent.run('find the most recent zone redundancy run');
    // Sanity: the scenario is real — the map actually parked.
    expect(parkedAtIteration).toBeDefined();
    // Every call made AFTER the park never sees the parked name again, on
    // any route — this is the served-tool-list half of the new truth.
    const afterPark = toolsPerCall.filter((c) => c.iteration > parkedAtIteration!);
    expect(afterPark.length).toBeGreaterThan(0);
    for (const call of afterPark) expect(call.names).not.toContain('get_zone_info');
    // And the disposition row records a CLEAN check — checked, zero
    // findings — rather than a counted finding.
    expect(events).toHaveLength(1);
    const rows = events[0]!.rows as CheckReport[];
    const compose = rows.find((r) => r.seam === 'compose' && r.check === 'invariant-violation');
    expect(compose).toBeDefined();
    expect(compose!.findings).toBe(0);
    expect(compose!.checked).toBeGreaterThanOrEqual(1);
    expect(compose!.lastFiredAt).toBeUndefined();
  });

  it('dev posture: a healthy run completes, canaries caught, synthetic counts quarantined', async () => {
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: mock({ replies: [done] }),
      model: 'mock',
      maxIterations: 3,
      integrityPosture: 'dev',
    })
      .system('s')
      .tool(screen())
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });
    await agent.run('go');
    expect(events).toHaveLength(1);
    expect(events[0]!.posture).toBe('dev');
    const rows = events[0]!.rows as CheckReport[];
    expect(rows[0]!.synthetic).toBe(1);
    expect(rows[0]!.findings).toBe(0);
  });
});
