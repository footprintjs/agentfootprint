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
 *          least one tool declared `argumentsFrom`). Registration is what
 *          makes silence auditable — an unregistered check is honest
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
import { invariantViolationsOf } from '../invariant-violation/check.js';
import { wireViolationsOf } from '../invariant-violation/wire.js';
import { danglingReferencesOf } from '../dangling-reference/check.js';
import { unsupportedClaimsOf } from '../unsupported-claim/check.js';

export type IntegrityPosture = 'observe' | 'dev';

/** Which checks this agent's configuration makes applicable. */
export interface IntegrityChecksPresent {
  readonly wire: boolean;
  readonly composeInvariant: boolean;
  readonly dangling: boolean;
  /** A `.claims()` contract is declared (9.61.0). */
  readonly claim?: boolean;
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
  if (present.composeInvariant) ledger.register('invariant-violation', 'compose');
  if (present.dangling) ledger.register('dangling-reference', 'compose');
  if (present.claim === true) ledger.register('unsupported-claim', 'claim');
  if (posture !== 'dev') return ledger;

  // The canaries — one known-bad fixture per registered check, through the
  // REAL pure function. Epoch -1 marks them as no run iteration's business.
  if (present.wire) {
    ledger.noteSynthetic('invariant-violation', 'wire', 'minted');
    const caught = wireViolationsOf(
      { names: ['canary_tool'], provenance: 'canary: composed frame' },
      { names: ['canary_tool', 'canary_ghost'], provenance: 'canary: wire' },
      -1,
    );
    if (caught.length > 0) ledger.noteSynthetic('invariant-violation', 'wire', 'caught');
  }
  if (present.composeInvariant) {
    ledger.noteSynthetic('invariant-violation', 'compose', 'minted');
    const caught = invariantViolationsOf(
      { mapId: 'canary-map', standing: 'parked', iteration: -1, ownedToolNames: ['canary_tool'] },
      { names: ['canary_tool'], provenance: 'canary: serving' },
    );
    if (caught.length > 0) ledger.noteSynthetic('invariant-violation', 'compose', 'caught');
  }
  if (present.dangling) {
    ledger.noteSynthetic('dangling-reference', 'compose', 'minted');
    const caught = danglingReferencesOf(
      [{ name: 'canary_tool', argumentsFrom: ['canary_ground'] }],
      new Set(['canary_ground']),
      new Set(),
      -1,
    );
    if (caught.length > 0) ledger.noteSynthetic('dangling-reference', 'compose', 'caught');
  }
  if (present.claim === true) {
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
  return ledger;
}
