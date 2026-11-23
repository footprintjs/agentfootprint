/** Native accepted-response admission, shared by model-calling charts. */
import { decide, type TypedScope } from 'footprintjs';
import { typedEmit } from '../recorders/core/typedEmit.js';
import {
  interventionErrorOf,
  isProviderInterventionError,
  providerInterventionOf,
  type ProviderIntervention,
} from '../provider-contract/intervention.js';

export interface ProviderInterventionState {
  /** The accepted response's sole safe intervention fact; never raw assessment data. */
  providerIntervention?: readonly [] | readonly [ProviderIntervention];
}

/** A fresh grouped turn must explicitly clear a fact its parent carried before it. */
export function seedProviderIntervention<T extends object>(
  scope: TypedScope<T>,
  args: object,
): void {
  if (Object.hasOwn(args, 'priorProviderIntervention'))
    (scope as TypedScope<T & ProviderInterventionState>).providerIntervention = [];
}

/** Grouped/native mounts carry only a fact the accepted-response stage wrote. */
export function interventionRecordOf(
  state: Readonly<Record<string, unknown>>,
): ProviderInterventionState {
  const value = state.providerIntervention;
  if (value === undefined) return {};
  if (Array.isArray(value) && value.length === 0) return { providerIntervention: [] };
  const owned = providerInterventionOf({
    intervention: Array.isArray(value) && value.length === 1 ? value[0] : {},
  });
  return owned === undefined ? {} : { providerIntervention: [owned] };
}

export function interventionVerdictOf(
  state: Readonly<Record<string, unknown>>,
):
  | { readonly kind: 'provider-intervention'; readonly intervention: ProviderIntervention }
  | undefined {
  const value = interventionRecordOf(state).providerIntervention?.[0];
  return value !== undefined && value.outcome !== 'masked'
    ? { kind: 'provider-intervention', intervention: value }
    : undefined;
}

/**
 * This invocation owns the accepted response, before its tools or text.
 * No intervention means no new scope read or write. Only masked output continues.
 * The decision reads the admitted fact, rather than inferring it from stop prose.
 */
export function admitProviderIntervention<T extends object>(
  scope: TypedScope<T>,
  response: unknown,
  beforeBreak?: () => void,
): boolean {
  const value = providerInterventionOf(response);
  if (value === undefined) {
    // Presence is not a tracked value read. Clear a former response's fact
    // only when this traversal, or its grouped parent, actually carried one.
    if ('providerIntervention' in scope)
      (scope as TypedScope<T & ProviderInterventionState>).providerIntervention = [];
    return false;
  }
  const admitted = scope as TypedScope<T & ProviderInterventionState>;
  // A top-level tuple crosses native shallow-merge boundaries with Replace;
  // an empty tuple clears a former value instead of merging it back in.
  admitted.providerIntervention = [value];
  const decision = decide(
    admitted,
    [
      {
        when: (s) => s.providerIntervention?.[0]?.outcome === 'blocked',
        then: 'blocked',
        label: 'The accepted provider assessment proves a block.',
      },
      {
        when: (s) => s.providerIntervention?.[0]?.outcome === 'unknown',
        then: 'unknown',
        label: 'The accepted provider assessment cannot establish a usable outcome.',
      },
    ],
    'usable',
  );
  if (decision.branch === 'usable') return false;
  // Accounting and application notifications follow admission. Their failure
  // cannot turn this already terminal response into a recoverable model crash.
  try {
    beforeBreak?.();
    typedEmit(scope, 'agentfootprint.error.fatal', {
      error:
        value.outcome === 'blocked'
          ? 'The provider blocked this response.'
          : 'The provider intervention outcome is unknown.',
      stage: 'provider-response-admission',
      scope: 'run',
    });
  } catch (cause) {
    throw interventionErrorOf(value, cause);
  }
  scope.$break('Provider intervention withheld the response.');
  return true;
}

/** Formatter failure keeps its original cause outside serializable scope state. */
export function admitInterventionError<T extends object>(
  scope: TypedScope<T>,
  error: unknown,
): never {
  if (isProviderInterventionError(error) && 'intervention' in error) {
    const owned = providerInterventionOf({ intervention: error.intervention });
    if (owned !== undefined)
      (scope as TypedScope<T & ProviderInterventionState>).providerIntervention = [owned];
  }
  throw error;
}

/** Direct-call boundaries with no terminal-state mapper raise the same typed error. */
export function requireUsableProviderResponse<T extends object>(
  scope: TypedScope<T>,
  response: unknown,
): void {
  const value = providerInterventionOf(response);
  if (value === undefined) {
    if ('providerIntervention' in scope)
      (scope as TypedScope<T & ProviderInterventionState>).providerIntervention = [];
    return;
  }
  (scope as TypedScope<T & ProviderInterventionState>).providerIntervention = [value];
  if (value.outcome !== 'masked') throw interventionErrorOf(value);
}
