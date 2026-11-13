import type { OtelAttributeValue } from '../types.js';
import { bound, boundList } from './bounds.js';

// ─── decide()/select() evidence rendering ────────────────────────────
//
// Structural mirror of footprintjs's DecisionEvidence / SelectionEvidence
// (lib/decide/types). We read it duck-typed so the adapter also accepts
// the same shape arriving on `composition.route_decided.evidence`.

interface RuleEvidenceLike {
  readonly type?: string;
  readonly ruleIndex?: number;
  readonly branch?: string;
  readonly matched?: boolean;
  readonly label?: string;
  /** filter rules — operator-level conditions. `threshold` is a
   *  developer-written rule constant (not runtime data);
   *  `actualSummary` is the engine's bounded, redaction-aware summary. */
  readonly conditions?: ReadonlyArray<{
    readonly key?: string;
    readonly op?: string;
    readonly threshold?: unknown;
    readonly actualSummary?: string;
    readonly result?: boolean;
  }>;
  /** function rules — the scope reads the predicate made. */
  readonly inputs?: ReadonlyArray<{ readonly key?: string; readonly valueSummary?: string }>;
}

export interface DecisionEvidenceLike {
  readonly rules?: readonly RuleEvidenceLike[];
  readonly chosen?: string;
  readonly default?: string;
  readonly selected?: readonly string[];
}

/** Render one rule's operator-level conditions as compact strings:
 *  `creditScore gt 700 → 750 (true)`. Value summaries come from the
 *  engine already bounded + redaction-aware — we only re-cap length. */
function renderConditions(rule: RuleEvidenceLike): readonly string[] {
  if (rule.conditions !== undefined && rule.conditions.length > 0) {
    return boundList(
      rule.conditions.map(
        (c) => `${c.key} ${c.op} ${bound(c.threshold)} → ${c.actualSummary} (${c.result})`,
      ),
    );
  }
  if (rule.inputs !== undefined && rule.inputs.length > 0) {
    return boundList(rule.inputs.map((i) => `${i.key} = ${i.valueSummary}`));
  }
  return [];
}

/** Flatten decide()/select() evidence into span-event attributes. */
export function renderEvidenceAttrs(
  evidence: DecisionEvidenceLike,
): Record<string, OtelAttributeValue> {
  const attrs: Record<string, OtelAttributeValue> = {};
  if (evidence.chosen !== undefined)
    attrs['agentfootprint.decision.chosen'] = bound(evidence.chosen);
  if (evidence.default !== undefined)
    attrs['agentfootprint.decision.default'] = bound(evidence.default);
  if (evidence.selected !== undefined)
    attrs['agentfootprint.decision.selected'] = boundList(evidence.selected.map(String));
  const rules = evidence.rules ?? [];
  if (rules.length > 0) attrs['agentfootprint.decision.rules_evaluated'] = rules.length;
  const matched = rules.find((r) => r.matched === true);
  if (matched !== undefined) {
    if (matched.label !== undefined)
      attrs['agentfootprint.decision.rule.label'] = bound(matched.label);
    if (matched.ruleIndex !== undefined)
      attrs['agentfootprint.decision.rule.index'] = matched.ruleIndex;
    if (matched.branch !== undefined)
      attrs['agentfootprint.decision.rule.branch'] = bound(matched.branch);
    const conditions = renderConditions(matched);
    if (conditions.length > 0) attrs['agentfootprint.decision.conditions'] = conditions;
  }
  return attrs;
}

/** Is this object shaped like decide()/select() evidence? */
export function looksLikeDecideEvidence(value: unknown): value is DecisionEvidenceLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as DecisionEvidenceLike).rules)
  );
}
