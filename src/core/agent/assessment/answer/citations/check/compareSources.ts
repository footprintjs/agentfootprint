import { conflictsOf } from '../../../../../../integrity/assertion/conflicts.js';
import { comparableValueOf, type Assertion } from '../../../../../../integrity/assertion/types.js';
import {
  bindingRuleOf,
  readEvidenceSnapshot,
} from '../../../../../../integrity/claim-binding/admit.js';
import { bindClaim } from '../../../../../../integrity/claim-binding/bindEvidence.js';
import {
  BINDING_LIMITS,
  boundedText,
  ownConfigArray,
} from '../../../../../../integrity/claim-binding/scope.js';
import type {
  ClaimBindingRule,
  EvidenceSnapshot,
  ResultEvidence,
} from '../../../../../../integrity/claim-binding/types.js';
import { ownData } from '../../../../../../lib/boundedJson.js';
import { canonicalJson } from '../../../../../../lib/canonicalJson.js';
import { instantOf } from '../../../../../../time/instant.js';

export interface CitationComparisonGroup {
  readonly concept: string;
  readonly rules: readonly string[];
}

interface CitationComparisonInput {
  readonly slots: ReadonlyMap<number, string>;
  readonly evidence: EvidenceSnapshot;
  readonly rules: readonly ClaimBindingRule[];
  readonly groups: readonly CitationComparisonGroup[];
}

export interface CitationComparison {
  readonly complete: boolean;
  readonly conflicts: readonly (readonly [number, number])[];
}

interface GroupRule {
  readonly concept: string;
  readonly rule: ClaimBindingRule;
}

interface Witness {
  readonly slot: number;
  readonly tool: string;
  readonly assertion: Assertion;
  readonly valueType: 'string' | 'number' | 'boolean';
}

// One budget for grouper admission, witness binding and comparisons.
const MAX_WORK = 4096;
const INCOMPLETE = { complete: false, conflicts: [] } as const;

function knownLabel(value: unknown): value is string {
  return boundedText(value) && value.trim().toLowerCase() !== 'unknown';
}

/** Admit and detach author declarations before any result is examined. */
export function compileComparisonGroups(
  raw: unknown,
  allowed: readonly ClaimBindingRule[],
): readonly CitationComparisonGroup[] {
  const allowedIds = new Set(allowed.map(({ id }) => id));
  const concepts = new Set<string>();
  return Object.freeze(
    ownConfigArray(raw, BINDING_LIMITS.results).map((entry) => {
      const { concept, rules } = ownData(entry, ['concept', 'rules']);
      if (!knownLabel(concept) || concepts.has(concept))
        throw new TypeError('Citation comparison groups require distinct concept names.');
      concepts.add(concept);
      const ids = ownConfigArray(rules, BINDING_LIMITS.results).map((id) => {
        if (typeof id !== 'string' || !allowedIds.has(id))
          throw new TypeError('A citation comparison group references an unknown rule.');
        return id;
      });
      if (ids.length < 2 || new Set(ids).size !== ids.length)
        throw new TypeError('A citation comparison group requires at least two distinct rules.');
      return Object.freeze({ concept, rules: Object.freeze(ids) });
    }),
  );
}

function rulesByTool(input: CitationComparisonInput, spend: () => boolean) {
  const rules = new Map<string, ClaimBindingRule>();
  for (const raw of ownConfigArray(input.rules, BINDING_LIMITS.results)) {
    const rule = bindingRuleOf(raw);
    if (rules.has(rule.id)) return undefined;
    rules.set(rule.id, rule);
  }
  const byTool = new Map<string, GroupRule[]>();
  const concepts = new Set<string>();
  for (const raw of ownConfigArray(input.groups, BINDING_LIMITS.results)) {
    const { concept, rules: ids } = ownData(raw, ['concept', 'rules']);
    if (!knownLabel(concept) || concepts.has(concept)) return undefined;
    concepts.add(concept);
    const group = new Set<string>();
    for (const id of ownConfigArray(ids, BINDING_LIMITS.results)) {
      if (!spend() || typeof id !== 'string' || group.has(id)) return undefined;
      const rule = rules.get(id);
      if (rule === undefined) return undefined;
      group.add(id);
      const members = byTool.get(rule.toolName) ?? [];
      members.push({ concept, rule });
      byTool.set(rule.toolName, members);
    }
  }
  return byTool;
}

function scopedWitness(
  slot: number,
  result: ResultEvidence,
  declaration: GroupRule,
  snapshot: EvidenceSnapshot,
) {
  const { rule } = declaration;
  const scope = result.scope;
  if (scope === undefined || !knownLabel(scope.unit) || !knownLabel(scope.grain)) return undefined;
  const periodDimension = result.periodDimension;
  if (periodDimension === undefined || periodDimension === 'unit' || periodDimension === 'grain')
    return undefined;

  const entitySpec = rule.fact.entity;
  const entity = typeof entitySpec === 'string' ? entitySpec : scope[entitySpec.scopeDimension];
  if (!knownLabel(entity) || !knownLabel(rule.fact.field)) return undefined;
  const fact = result.facts?.find((row) => row.entity === entity && row.field === rule.fact.field);
  if (fact === undefined) return undefined;
  // This is one source's executed scope, not a claim's scope inferred from its citation.
  const bound = bindClaim(
    { result: result.id, rule: rule.id, value: fact.value },
    snapshot,
    [rule],
    scope,
  );
  if (bound.kind === 'unverified' || bound.period === undefined) return undefined;
  const from = instantOf(bound.period.queried.from, 'strict');
  const to = instantOf(bound.period.queried.to, 'strict');
  if (from === undefined || to === undefined) return undefined;
  const value = comparableValueOf(bound.evidence.value);
  const valueType = typeof value;
  if (
    (valueType !== 'string' && valueType !== 'number' && valueType !== 'boolean') ||
    (valueType === 'string' && !knownLabel(value))
  )
    return undefined;

  // Keep other authored qualifiers, such as a filter, in the comparison key.
  const extra = Object.fromEntries(
    Object.entries(scope).filter(
      ([name]) => name !== periodDimension && name !== 'unit' && name !== 'grain',
    ),
  );
  const key = canonicalJson([
    declaration.concept,
    entity,
    rule.fact.field,
    scope.unit,
    scope.grain,
    [from.ms, from.nanos, to.ms, to.nanos],
    extra,
  ]);
  const witness: Witness = { slot, tool: rule.toolName, assertion: bound.evidence, valueType };
  return { key, witness };
}

/** Compare declared sources in the accepted offer, including those the answer did not cite. */
export function compareCitationSources(input: CitationComparisonInput): CitationComparison {
  if (input.slots.size > BINDING_LIMITS.results) return INCOMPLETE;
  if (input.groups.length === 0 || input.slots.size < 2) return { complete: true, conflicts: [] };
  let remaining = MAX_WORK;
  const spend = () => remaining-- > 0;
  try {
    const declarations = rulesByTool(input, spend);
    if (declarations === undefined) return INCOMPLETE;
    const snapshot = readEvidenceSnapshot(input.evidence);
    const byId = new Map(snapshot.results.map((result) => [result.id, result]));
    if (byId.size !== snapshot.results.length) return INCOMPLETE;

    const found = new Set<string>();
    const buckets = new Map<string, Map<number, Witness>>();
    for (const [slot, resultId] of input.slots) {
      const result = byId.get(resultId);
      if (
        result === undefined ||
        result.unavailable !== undefined ||
        !Number.isSafeInteger(slot) ||
        slot < 1 ||
        slot > BINDING_LIMITS.results ||
        found.has(resultId)
      )
        return INCOMPLETE;
      found.add(resultId);
      for (const declaration of declarations.get(result.toolName) ?? []) {
        if (!spend()) return INCOMPLETE;
        const proved = scopedWitness(slot, result, declaration, snapshot);
        if (proved === undefined) continue;
        const bucket = buckets.get(proved.key) ?? new Map<number, Witness>();
        bucket.set(slot, proved.witness);
        buckets.set(proved.key, bucket);
      }
    }

    const pairs = new Map<string, readonly [number, number]>();
    for (const bucket of buckets.values()) {
      const witnesses = [...bucket.values()];
      for (const [index, left] of witnesses.entries()) {
        for (let other = index + 1; other < witnesses.length; other += 1) {
          if (!spend()) return INCOMPLETE;
          const right = witnesses[other];
          if (left.tool === right.tool || left.valueType !== right.valueType) continue;
          if (conflictsOf([left.assertion, right.assertion]).length === 0) continue;
          const pair = [Math.min(left.slot, right.slot), Math.max(left.slot, right.slot)] as const;
          pairs.set(`${pair[0]}:${pair[1]}`, pair);
          if (pairs.size > BINDING_LIMITS.results) return INCOMPLETE;
        }
      }
    }
    const conflicts = [...pairs.values()].sort(([a, b], [c, d]) => a - c || b - d);
    return { complete: true, conflicts };
  } catch {
    return INCOMPLETE;
  }
}
