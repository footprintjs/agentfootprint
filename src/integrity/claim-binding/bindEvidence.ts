/** Exact evidence selection and eligibility, before the shared pair evaluator. */
import { copyJson, ownData } from '../../lib/boundedJson.js';
import { participates, comparableValueOf } from '../assertion/types.js';
import type { ClaimLedgerRow } from '../unsupported-claim/check.js';
import { periodVerdict } from '../../semantics/coverage/period.js';
import { resultIdentityOf } from './capture.js';
import {
  BINDING_LIMITS,
  boundedText,
  boundedResultId,
  queriedPeriodMatches,
  scopesMatch,
  ownConfigArray,
} from './scope.js';
import { bindingRuleOf, readEvidenceSnapshot } from './admit.js';
import type { BindingReason, ClaimBinding, ClaimBindingRule, EvidenceSnapshot } from './types.js';

const unverified = (reason: BindingReason): ClaimBinding => ({ kind: 'unverified', reason });
const isDoubt = (value: unknown): boolean =>
  value === null || value === 'unknown' || value === undefined;

/**
 * The model supplies only result/value/rule. Snapshot lineage, rule registry
 * and intendedScope are runtime/app inputs. A bound pair is not a verdict.
 * JSON-restored snapshots must originate from the caller's verified recording;
 * this module validates shape and associations, not signatures or ownership.
 */
export function bindClaim(
  rawClaim: unknown,
  snapshot: EvidenceSnapshot,
  rules: readonly ClaimBindingRule[],
  intendedScope?: unknown,
): ClaimBinding {
  let claim: Record<string, unknown>;
  try {
    claim = ownData(copyJson(rawClaim, BINDING_LIMITS.scopeBytes, true), [
      'result',
      'value',
      'rule',
    ]);
    if (
      !boundedResultId(claim.result) ||
      !boundedText(claim.rule) ||
      !Object.hasOwn(claim, 'value')
    )
      return unverified('invalid-claim');
  } catch {
    return unverified('invalid-claim');
  }
  let matchingRules: readonly ClaimBindingRule[];
  try {
    matchingRules = ownConfigArray(rules, BINDING_LIMITS.results)
      .map(bindingRuleOf)
      .filter((rule) => rule.id === claim.rule);
  } catch {
    return unverified('invalid-rule');
  }
  if (matchingRules.length === 0) return unverified('unknown-rule');
  if (matchingRules.length !== 1) return unverified('invalid-rule');
  const rule = matchingRules[0];
  if (rule === undefined) return unverified('invalid-rule');
  try {
    const saved = readEvidenceSnapshot(snapshot);
    const matches = saved.results.filter((result) => result.id === claim.result);
    if (matches.length === 0) return unverified('missing-result');
    if (matches.length !== 1) return unverified('ambiguous-result');
    const result = matches[0];
    if (result === undefined || result.id !== resultIdentityOf(result.identity))
      return unverified('invalid-evidence');
    if (
      result.identity.namespace !== saved.namespace ||
      !saved.runIds.includes(result.identity.runId)
    )
      return unverified('foreign-result');
    if (result.unavailable !== undefined) return unverified(result.unavailable);
    if (result.toolName !== rule.toolName) return unverified('invalid-rule');
    if (
      result.scopeDeclaration.id !== rule.scopeDeclaration.id ||
      result.scopeDeclaration.version !== rule.scopeDeclaration.version
    )
      return unverified('scope-version-mismatch');
    if (result.scope === undefined) return unverified('missing-scope');
    const dimensions = rule.scopeDeclaration.dimensions.map((dimension) => dimension.name);
    if (
      !dimensions.every(boundedText) ||
      new Set(dimensions).size !== dimensions.length ||
      dimensions.some((name) => !Object.hasOwn(result.scope as object, name)) ||
      Object.keys(result.scope).some((name) => !dimensions.includes(name))
    )
      return unverified('missing-scope');
    if (result.periodDimension !== rule.scopeDeclaration.periodDimension)
      return unverified('scope-version-mismatch');
    if (intendedScope !== undefined && !scopesMatch(result.scope, intendedScope))
      return unverified('scope-mismatch');
    const entity =
      typeof rule.fact.entity === 'string'
        ? rule.fact.entity
        : result.scope[rule.fact.entity.scopeDimension];
    if (!boundedText(entity) || !boundedText(rule.fact.field)) return unverified('invalid-rule');
    if (!Array.isArray(result.facts)) return unverified('invalid-evidence');
    const facts = result.facts.filter(
      (fact: ClaimLedgerRow) => fact.entity === entity && fact.field === rule.fact.field,
    );
    if (facts.length === 0) return unverified('missing-fact');
    if (facts.length !== 1) return unverified('ambiguous-fact');
    const fact = facts[0];
    if (fact === undefined || !participates(fact.value) || !participates(claim.value))
      return unverified('unasserted-value');
    // Absence/doubt needs a separately authored absence rule in a later slice.
    if (isDoubt(comparableValueOf(fact.value)) || isDoubt(comparableValueOf(claim.value)))
      return unverified('unasserted-value');
    if (result.period !== undefined) {
      const verdict = periodVerdict(result.period);
      if (verdict === 'unknown') return unverified('coverage-unknown');
      if (verdict !== 'covered') return unverified('coverage-partial');
    }
    if (result.periodDimension !== undefined) {
      if (result.period === undefined) return unverified('coverage-undeclared');
      if (!queriedPeriodMatches(result.scope[result.periodDimension], result.period))
        return unverified('scope-mismatch');
    }
    if (rule.coverage === undefined || result.coverage === undefined)
      return unverified('coverage-undeclared');
    const completeness = rule.coverage({
      scope: result.scope,
      coverage: result.coverage,
      ...(result.period !== undefined && { period: result.period }),
    });
    if (completeness === 'partial') return unverified('coverage-partial');
    if (completeness === 'stale') return unverified('coverage-stale');
    if (completeness !== 'complete') return unverified('coverage-unknown');
    const common = {
      subject: { kind: 'entity' as const, id: entity },
      predicate: rule.fact.field,
      stratum: 'asserted' as const,
    };
    return copyJson(
      {
        kind: 'bound',
        resultId: result.id,
        rule: { id: rule.id, version: rule.version },
        scope: result.scope,
        coverage: result.coverage,
        ...(result.period !== undefined && { period: result.period }),
        evidence: { ...common, value: fact.value, provenance: `result ${result.id}` },
        claim: { ...common, value: claim.value, provenance: `rule ${rule.id}` },
      },
      BINDING_LIMITS.resultBytes,
      true,
    ) as ClaimBinding;
  } catch {
    return unverified('invalid-evidence');
  }
}
