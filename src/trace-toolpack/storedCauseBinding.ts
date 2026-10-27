import type { CauseGraph } from 'foottrace/cause';
import type { SnapshotCapture } from './causeCapture.js';
import type { StoredCauseAdmission, StoredCauseArtifacts } from './storedCauseTypes.js';

export type StoredCauseAssessment =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'stored';
      readonly capture: SnapshotCapture;
      readonly admission: StoredCauseAdmission;
    };

type Binding = {
  readonly graph: CauseGraph;
  readonly capture: SnapshotCapture;
  readonly admission: StoredCauseAdmission;
  /** Detached and deeply frozen; a graph can never borrow a different history's assessment. */
  readonly history: object;
};
const bindings = new WeakMap<object, Binding>();

function admissionFor(capture: SnapshotCapture): StoredCauseAdmission {
  return Object.freeze({
    native: Object.freeze({
      status: capture.status,
      reason: capture.reason,
      version: 1 as const,
      scope: 'root-log' as const,
      persistence: 'memory-only' as const,
    }),
    storage: Object.freeze({
      status: 'adapter-acknowledged-history' as const,
      scope: 'root-log' as const,
    }),
    readSources: 'not-collected' as const,
  });
}

/** Internal issuer. This identity is intentionally not serializable or shared across module instances. */
export function bindStoredCause(
  graph: CauseGraph,
  capture: SnapshotCapture,
  history: object,
): StoredCauseArtifacts {
  const frozenGraph = Object.freeze(graph);
  const frozenCapture = Object.freeze({ ...capture });
  const admission = admissionFor(frozenCapture);
  // The display copy is separate from the authority retained by this module instance.
  const cause: StoredCauseArtifacts = Object.freeze({
    graph: frozenGraph,
    admission: admissionFor(frozenCapture),
  });
  bindings.set(cause, { graph: frozenGraph, capture: frozenCapture, admission, history });
  return cause;
}

/** Read identity, never the value of a caller's assessment property or an attached getter. */
export function storedCauseAssessment(cause: unknown): StoredCauseAssessment {
  if (cause === null || typeof cause !== 'object') return { kind: 'none' };
  try {
    const binding = bindings.get(cause);
    if (binding) {
      const graph = Object.getOwnPropertyDescriptor(cause, 'graph');
      return graph && 'value' in graph && graph.value === binding.graph
        ? { kind: 'stored', capture: binding.capture, admission: binding.admission }
        : { kind: 'invalid' };
    }
    // Inherited copies carry the same claim but not the issuing identity. `in` invokes no getter.
    return 'admission' in cause ? { kind: 'invalid' } : { kind: 'none' };
  } catch {
    return { kind: 'invalid' };
  }
}
