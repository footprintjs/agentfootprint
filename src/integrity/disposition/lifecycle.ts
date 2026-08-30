/**
 * The disposition ledger's run lifecycle — registration, the dev canary,
 * and nothing else.
 *
 * Pattern: two small functions bracketing a run; the ledger stays the one
 *          accumulator, this file only decides WHO is registered and runs
 *          the canary.
 * Role:    a check is registered exactly when its preconditions exist on
 *          THIS agent (wire: always — every run calls the model;
 *          compose-invariant: a mount kernel is configured; dangling: at
 *          least one tool declared `argumentsFrom`, which arms BOTH the
 *          compose-seam dangling-reference check and the choice-seam
 *          unsupported-argument check off the same declaration;
 *          empty-lookup: that same declaration AND the operator's
 *          `noticeEmptyLookups` dial — two halves, because an advisory that
 *          armed itself off a declaration made for something else would not
 *          be opt-in at all).
 *          Registration is what makes silence auditable — an unregistered
 *          check is honest
 *          absence, a registered one that never notes is the wiring rot
 *          `assertAlive` exists to name.
 *
 * THE CANARY (dev posture): each registered check's PURE function is run
 * once against a synthetic, deliberately contradictory fixture. A check
 * that cannot catch its own canary is dead — it runs but cannot fire —
 * which is theorem (ii); theorem (i), the unhooked pipeline, is what the
 * real per-encounter notes prove. Canary findings never surface as events
 * and never touch the real counts (`noteSynthetic` quarantine).
 */

import { dispositionLedger, type DispositionLedger } from './ledger.js';
import type { IntegritySeam } from './types.js';
import type { ContextErrorKind } from '../finding/types.js';
import { invariantViolationsOf } from '../invariant-violation/check.js';
import { wireViolationsOf } from '../invariant-violation/wire.js';
import { danglingReferencesOf } from '../dangling-reference/check.js';
import { unsupportedArgumentsOf } from '../unsupported-argument/check.js';
import { unsupportedClaimsOf } from '../unsupported-claim/check.js';
import { emptyLookupOf, readLookupResult } from '../empty-lookup/check.js';

export type IntegrityPosture = 'observe' | 'dev';

/** Which checks this agent's configuration makes applicable. */
export interface IntegrityChecksPresent {
  readonly wire: boolean;
  readonly composeInvariant: boolean;
  /**
   * At least one tool declared `Tool.argumentsFrom`. ONE FLAG, TWO CHECKS
   * (9.63.0): the same declaration arms `dangling-reference` at the compose
   * seam and `unsupported-argument` at the choice seam — one asks whether the
   * ground is still in reach while the tool is offered, the other whether the
   * value the model chose came from that ground when it was called. They are
   * not separated here because nothing can arm one without arming the other.
   * "At least one tool" means the FULL declared catalog (9.72.0): a skill-
   * carried tool's declaration counts even though the tool reaches the model
   * only after its skill activates — the declaration is known at build, and
   * the harvest in `Agent.buildChart` reads the whole catalog, not just the
   * static registry.
   */
  readonly dangling: boolean;
  /** A `.claims()` contract is declared (9.61.0). */
  readonly claim?: boolean;
  /**
   * The write seam's `empty-lookup` notice (9.77.0) — armed only when BOTH
   * halves are true: the operator turned `noticeEmptyLookups` on AND at least
   * one tool declared `argumentsFrom`. Deliberately NOT armed by the
   * declaration alone, unlike its two siblings: this check would otherwise
   * start filing advisories in every app that already declares
   * `argumentsFrom` for the other two, and an absent dial must leave a run
   * byte-identical. Absent → a registered `not-applicable` ROW, never
   * silence.
   */
  readonly emptyLookup?: boolean;
}

/**
 * Start one run's ledger: register the present checks and, in dev posture,
 * prove each can still catch its own synthetic defect.
 */
export function beginIntegrityRun(
  present: IntegrityChecksPresent,
  posture: IntegrityPosture,
): DispositionLedger {
  const ledger = dispositionLedger();
  if (present.wire) ledger.register('invariant-violation', 'wire');
  // An UNARMED check is a row, not a silence.
  //
  // Every optional check is registered whether or not this run armed it, and
  // one the app never opted into is noted `not-applicable` immediately —
  // which is the literal truth: the check looked for its subject (a maps
  // plan, a tool declaring `argumentsFrom`, a claims contract) and this run
  // has none. Before this, an unarmed check filed NO row at all, and the
  // always-on `wire` row sat there green beside it; read casually — which is
  // exactly how the library's own reference agent got read for weeks — a run
  // that checked nothing was indistinguishable from a run where everything
  // passed.
  //
  // Per check, deliberately, rather than one all-or-nothing block for the
  // case where the app armed none of them. The common shape in the field is
  // PARTIAL: a consumer declares `argumentsFrom`, arms the two checks that
  // field carries, and never learns that the rest never ran. An
  // all-or-nothing block goes quiet
  // the moment one check is armed, which is precisely when the remaining
  // blind spots start to matter.
  //
  // This reuses the ledger's existing vocabulary rather than adding a flag or
  // a second channel, so the rows travel through `report()`, the
  // `agentfootprint.integrity.disposition` event and `find_context_errors`'s
  // partial-coverage headline with no change at any consumer. And
  // `notApplicable` counts as touched in `assertAlive`'s theorem, so an
  // unarmed check can never itself trip `CheckerDeadError`: not opting in is
  // not wiring rot, and the two must stay tellable apart.
  const armed = (kind: ContextErrorKind, seam: IntegritySeam, isArmed: boolean): void => {
    ledger.register(kind, seam);
    if (!isArmed) ledger.note(kind, seam, 'not-applicable');
  };
  armed('invariant-violation', 'compose', present.composeInvariant === true);
  armed('dangling-reference', 'compose', present.dangling === true);
  armed('unsupported-argument', 'choice', present.dangling === true);
  armed('unsupported-claim', 'claim', present.claim === true);
  armed('empty-lookup', 'write', present.emptyLookup === true);

  if (posture !== 'dev') return ledger;

  // The canaries — one known-bad fixture per REGISTERED check, through the
  // REAL pure function. Epoch -1 marks them as no run iteration's business.
  //
  // Registered, note, and no longer only armed. The four optional checks now
  // file a row whether or not this run had a subject for them, and a
  // `not-applicable` row with no canary beside it is the exact ambiguity this
  // whole change set exists to remove: a checker that has ROTTED and a checker
  // that simply had nothing to look at produce an identical row. The canary is
  // the only thing that tells them apart, and it costs a pure function call on
  // a fixture.
  //
  // The alternative — canary only what the app armed — reads reasonable and is
  // wrong for the same reason a green report from a check that never ran is
  // decoration: the moment somebody DOES arm `.claims()`, they inherit whatever
  // state that checker rotted into while nobody was looking, and nothing in the
  // record will say how long it had been dead. Dev posture is a library-health
  // instrument, so it proves the machinery, not this run's subset of it.
  if (present.wire) {
    ledger.noteSynthetic('invariant-violation', 'wire', 'minted');
    const caught = wireViolationsOf(
      { names: ['canary_tool'], provenance: 'canary: composed frame' },
      { names: ['canary_tool', 'canary_ghost'], provenance: 'canary: wire' },
      -1,
    );
    if (caught.length > 0) ledger.noteSynthetic('invariant-violation', 'wire', 'caught');
  }
  {
    ledger.noteSynthetic('invariant-violation', 'compose', 'minted');
    const caught = invariantViolationsOf(
      { mapId: 'canary-map', standing: 'parked', iteration: -1, ownedToolNames: ['canary_tool'] },
      { names: ['canary_tool'], provenance: 'canary: serving' },
    );
    if (caught.length > 0) ledger.noteSynthetic('invariant-violation', 'compose', 'caught');
  }
  {
    ledger.noteSynthetic('dangling-reference', 'compose', 'minted');
    const caught = danglingReferencesOf(
      [{ name: 'canary_tool', argumentsFrom: ['canary_ground'] }],
      new Set(['canary_ground']),
      new Set(),
      -1,
    );
    if (caught.length > 0) ledger.noteSynthetic('dangling-reference', 'compose', 'caught');
  }
  {
    // The choice-seam canary: an ARMED call carrying a value the corpus does
    // not contain. The fixture's corpus deliberately says nothing that could
    // match, so a check that still finds nothing is a check that cannot fire.
    ledger.noteSynthetic('unsupported-argument', 'choice', 'minted');
    const caught = unsupportedArgumentsOf(
      [
        {
          toolName: 'canary_tool',
          toolCallId: 'canary',
          args: { id: 'canary-fabricated-id' },
          argumentsFrom: ['canary_ground'],
        },
      ],
      { grounded: ['canary: this frame served no identifiers'], assistant: [] },
      -1,
    );
    if (caught.findings.length > 0) {
      ledger.noteSynthetic('unsupported-argument', 'choice', 'caught');
    }
  }
  {
    ledger.noteSynthetic('unsupported-claim', 'claim', 'minted');
    const caught = unsupportedClaimsOf(
      [{ answerField: 'canary', entity: 'canary-entity', field: 'canary-field' }],
      [
        {
          entity: 'canary-entity',
          field: 'canary-field',
          value: 'settled',
          toolName: 'canary',
          toolCallId: 'canary',
          iteration: -1,
        },
      ],
      { canary: 'claimed-otherwise' },
      -1,
    );
    if (caught.findings.length > 0) ledger.noteSynthetic('unsupported-claim', 'claim', 'caught');
  }
  {
    // The write-seam canary (9.77.0): a lookup whose argument the fixture's
    // PRODUCER really did serve, answering with a zero-row rowset. Both
    // halves of the join are deliberately load-bearing — remove the ground
    // and the value is not the run's own; make the rowset non-empty and
    // there is nothing to notice — so a check that finds nothing here has
    // lost one of the two facts it exists to pair.
    ledger.noteSynthetic('empty-lookup', 'write', 'minted');
    const caught = emptyLookupOf(
      {
        toolName: 'canary_tool',
        toolCallId: 'canary',
        args: { id: 'canary-grounded-id' },
        argumentsFrom: ['canary_ground'],
        reading: readLookupResult([], false),
      },
      [{ toolName: 'canary_ground', text: 'canary: served canary-grounded-id' }],
      -1,
    );
    if (caught.findings.length > 0) ledger.noteSynthetic('empty-lookup', 'write', 'caught');
  }
  return ledger;
}
