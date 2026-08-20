/**
 * invariant-violation at the WIRE seam — the composed frame and the
 * serialized body disagree about what the model was shown.
 *
 * Pattern: pure function over two name lists; same algebra, new seam.
 * Role:    the check the compose seam CANNOT do. The recorded defect: the
 *          internal frame said a subsystem's tools were removed, and the
 *          adapter still serialized four schemas. Every check over the
 *          pre-serialization IR read a clean frame — the bug lived in the
 *          gap between the frame and the body. So the comparison here is
 *          IR against `LLMResponse.wireManifest`, the manifest an adapter
 *          reads back from the FINAL request body after every transform
 *          (adapters/llm/wireManifest.ts).
 *
 * BOTH DIRECTIONS are defects, distinguished in the message: a name on the
 * wire the frame never composed (the recorded bug — the adapter retained or
 * invented it) and a composed name that never crossed (the model was
 * promised a capability it cannot call). One finding per direction, all
 * offending names aboard, so ten leaked schemas are one defect, not ten.
 *
 * HONEST ABSENCE: an adapter that states no manifest leaves the request
 * INCOMPARABLE — no finding, never a guess; the disposition for that call
 * is `unreachable`, not `checked-pass`. An EMPTY manifest is a stated zero
 * and compares normally.
 */

import type { Assertion, SubjectRef } from '../assertion/types.js';
import { conflictsOf } from '../assertion/conflicts.js';
import type { ContextError } from '../finding/types.js';

/** The tool names the frame composed for THIS call, and where that was read. */
export interface ComposedTools {
  readonly names: readonly string[];
  readonly provenance: string;
}

/** The tool names the adapter says actually crossed, and which adapter said so. */
export interface ServedWire {
  readonly names: readonly string[];
  readonly provenance: string;
}

const uniq = (names: readonly string[]): readonly string[] => [...new Set(names)];

/**
 * Compare one call's composed frame against its wire manifest.
 *
 * Returns findings (usually none). Equal sets — whatever the order or
 * duplication — return nothing, which the caller files as `checked-pass`.
 */
export function wireViolationsOf(
  composed: ComposedTools,
  wire: ServedWire | undefined,
  epoch: number,
): readonly ContextError[] {
  if (wire === undefined) return []; // no manifest stated: incomparable, never a guess

  const composedSet = new Set(composed.names);
  const wireSet = new Set(wire.names);
  const added = uniq(wire.names).filter((n) => !composedSet.has(n));
  const dropped = uniq(composed.names).filter((n) => !wireSet.has(n));
  if (added.length === 0 && dropped.length === 0) return [];

  const findings: ContextError[] = [];
  const fileDirection = (
    names: readonly string[],
    onWireValue: 'present' | 'absent',
    message: string,
  ): void => {
    if (names.length === 0) return;
    const subjects = names.map((id): SubjectRef => ({ kind: 'tool', id }));
    const witnesses: Assertion[] = names.flatMap((name): Assertion[] => {
      const subject: SubjectRef = { kind: 'tool', id: name };
      return [
        {
          subject,
          predicate: 'on-wire',
          value: onWireValue === 'present' ? 'absent' : 'present',
          epoch,
          stratum: 'asserted',
          provenance: `${composed.provenance}: composed frame`,
        },
        {
          subject,
          predicate: 'on-wire',
          value: onWireValue,
          epoch,
          stratum: 'asserted',
          provenance: `${wire.provenance}: serialized body`,
        },
      ];
    });
    // Run the algebra rather than asserting the conflict directly — the
    // fences (quotation, unknowns, epochs) apply for free, and one
    // comparison owns the definition of "contradict".
    if (conflictsOf(witnesses).length === 0) return;
    findings.push({
      kind: 'invariant-violation',
      seam: 'wire',
      subjects,
      witnesses,
      epoch,
      message,
    });
  };

  fileDirection(
    added,
    'present',
    `${String(added.length)} tool(s) crossed the wire that the composed frame never carried ` +
      `(${added.join(', ')}). The adapter's serialized body and the frame it was built from ` +
      `disagree — the model was shown capabilities the composition had removed or never held. ` +
      `Nothing here resolves which side is right, and the call was already made.`,
  );
  fileDirection(
    dropped,
    'absent',
    `${String(dropped.length)} composed tool(s) never crossed the wire ` +
      `(${dropped.join(', ')}). The frame promised the model capabilities the serialized body ` +
      `dropped — a call the model makes against them cannot land. Nothing here resolves which ` +
      `side is right, and the call was already made.`,
  );
  return findings;
}
