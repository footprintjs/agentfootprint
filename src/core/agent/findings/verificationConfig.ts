/**
 * Compile the explicit verifier's authored rules and retention permission.
 * Role: closure-only configuration; callbacks never enter recorded state.
 */
import { bindingRuleOf } from '../../../integrity/claim-binding/admit.js';
import { resultIdentityOf } from '../../../integrity/claim-binding/capture.js';
import {
  BINDING_LIMITS,
  boundedText,
  ownConfigArray,
} from '../../../integrity/claim-binding/scope.js';
import type {
  CapturedDispatch,
  ClaimBindingRule,
  ReturnedEvidence,
  ScopeDeclaration,
} from '../../../integrity/claim-binding/types.js';
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { canonicalJson } from '../../../lib/canonicalJson.js';
import { readSemantics } from '../../../semantics/envelope.js';

export interface EvidenceAuthorizationInput {
  /** Exact executed identity and selected scope, never all tool arguments. */
  readonly dispatch: CapturedDispatch;
  /** Full return-time semantic metadata, not the stripped model projection. */
  readonly returned: ReturnedEvidence;
  /** Actual payload after governance, placement and caps, before extra notes. */
  readonly served: unknown;
}

export interface EvidenceAuthorization {
  /** Grants retention of ALL original facts, provenance, coverage extras and period. */
  readonly resultVisible: boolean;
  /** Separately grants retention of EVERY selected executed scope dimension. */
  readonly scopeVisible: boolean;
}

export interface FindingsVerificationOptions {
  readonly rules: readonly ClaimBindingRule[];
  /**
   * Synchronous author policy; may close over app-owned authorization. Inputs
   * are detached/frozen. Projection equality does not supply this permission.
   * Missing, partial, malformed or throwing decisions withhold both channels.
   */
  readonly authorizeEvidence: (input: EvidenceAuthorizationInput) => EvidenceAuthorization;
}

export interface CompiledVerificationConfig extends FindingsVerificationOptions {
  /** One admitted scope per tool; conflicting declarations fail at compilation. */
  readonly scopeForTool: (toolName: string) => ScopeDeclaration | undefined;
}

const WITHHELD: EvidenceAuthorization = Object.freeze({
  resultVisible: false,
  scopeVisible: false,
});
const GRANTED: EvidenceAuthorization = Object.freeze({ resultVisible: true, scopeVisible: true });

function sameScope(left: ScopeDeclaration, right: ScopeDeclaration): boolean {
  // Functions are author-owned identities, not JSON or a stringified source.
  if (
    left.dimensions.length !== right.dimensions.length ||
    left.dimensions.some(
      (dimension, index) => dimension.normalize !== right.dimensions[index].normalize,
    )
  )
    return false;
  const data = (scope: ScopeDeclaration) => ({
    ...scope,
    dimensions: scope.dimensions.map((dimension) => ({ ...dimension, normalize: undefined })),
  });
  return canonicalJson(data(left)) === canonicalJson(data(right));
}

/** Only the existing detached capture ports can enter the author's callback. */
function authorizationInputOf(raw: EvidenceAuthorizationInput): EvidenceAuthorizationInput {
  const source = ownData(raw, ['dispatch', 'returned', 'served']);
  const dispatch = ownData(copyJson(source.dispatch, BINDING_LIMITS.scopeBytes * 2, true), [
    'identity',
    'id',
    'toolName',
    'toolCallId',
    'iteration',
    'scopeDeclaration',
    'scope',
    'periodDimension',
    'unavailable',
  ]);
  const identity = ownData(dispatch.identity, ['namespace', 'runId', 'ordinal']);
  const declaration = ownData(dispatch.scopeDeclaration, ['id', 'version']);
  const returned = ownData(
    copyJson(source.returned, BINDING_LIMITS.resultBytes + BINDING_LIMITS.scopeBytes, true),
    ['resultId', 'semantics', 'unavailable'],
  );
  if (
    dispatch.unavailable !== undefined ||
    returned.unavailable !== undefined ||
    !boundedText(identity.namespace) ||
    !boundedText(identity.runId) ||
    typeof identity.ordinal !== 'number' ||
    dispatch.id !==
      resultIdentityOf({
        namespace: identity.namespace,
        runId: identity.runId,
        ordinal: identity.ordinal,
      }) ||
    returned.resultId !== dispatch.id ||
    !boundedText(dispatch.toolName) ||
    !boundedText(dispatch.toolCallId) ||
    typeof dispatch.iteration !== 'number' ||
    !Number.isSafeInteger(dispatch.iteration) ||
    dispatch.iteration < 0 ||
    !boundedText(declaration.id) ||
    !boundedText(declaration.version) ||
    (Object.hasOwn(dispatch, 'periodDimension') && !boundedText(dispatch.periodDimension)) ||
    readSemantics(returned.semantics) === undefined
  )
    throw new Error('Invalid verification authorization input.');
  ownData(copyJson(dispatch.scope, BINDING_LIMITS.scopeBytes, true));
  return Object.freeze({
    dispatch: Object.freeze(dispatch) as unknown as CapturedDispatch,
    returned: Object.freeze(returned) as unknown as ReturnedEvidence,
    served: copyJson(source.served, BINDING_LIMITS.resultBytes, true),
  });
}

/** Strict configuration admission runs once, not at every verification. */
export function compileVerificationConfig(raw: unknown): CompiledVerificationConfig {
  const source = ownData(raw, ['rules', 'authorizeEvidence']);
  const rules = ownConfigArray(source.rules, BINDING_LIMITS.results).map(bindingRuleOf);
  if (rules.length === 0 || typeof source.authorizeEvidence !== 'function')
    throw new Error('findings.verify requires rules and an explicit authorizeEvidence callback.');
  const authorize = source.authorizeEvidence as FindingsVerificationOptions['authorizeEvidence'];
  const ids = new Set<string>();
  const scopes = new Map<string, ScopeDeclaration>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error('Duplicate findings verification rule.');
    ids.add(rule.id);
    const prior = scopes.get(rule.toolName);
    if (prior !== undefined && !sameScope(prior, rule.scopeDeclaration))
      throw new Error('Conflicting findings verification scopes for one tool.');
    scopes.set(rule.toolName, rule.scopeDeclaration);
  }
  return Object.freeze({
    rules: Object.freeze(rules),
    scopeForTool: (toolName: string) => scopes.get(toolName),
    authorizeEvidence: (input: EvidenceAuthorizationInput): EvidenceAuthorization => {
      try {
        const response: unknown = authorize(authorizationInputOf(input));
        // A mistaken async callback cannot grant access. Consume rejection of
        // a genuine Promise without awaiting it or invoking an arbitrary then.
        if (response instanceof Promise) {
          void Promise.prototype.then.call(response, undefined, () => undefined);
          return WITHHELD;
        }
        const decision = ownData(response, ['resultVisible', 'scopeVisible']);
        return decision.resultVisible === true && decision.scopeVisible === true
          ? GRANTED
          : WITHHELD;
      } catch {
        // Never record policy exception text, return values or private inputs.
        return WITHHELD;
      }
    },
  });
}
