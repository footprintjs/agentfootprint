/**
 * auditKeptByContract — what a BOUNDED audit record keeps although its value
 * may come from the run: the named exceptions to "structure is kept, content
 * is a marker", in one place.
 *
 * Pattern: a closed list of named exceptions (`KEPT_BY_CONTRACT`), each a rule
 *          built from `auditBounding.ts` and wrapped in `byContract`, so a walker
 *          finds every one by name.
 * Role:    `auditShapes.ts` places these rules in the event shapes and the meta
 *          shape; no other rule keeps a value the run composed.
 * Emits:   N/A.
 *
 * An exception is a POSITION, never a pass-through: each one still checks its
 * value like every other rule — it keeps a value of its declared kind (a
 * string, or decide() evidence's own shape, field by field), and a value of any
 * other kind, or a child its type does not declare, is a marker.
 *
 * Adding an exception, or placing one somewhere new, changes the pin in
 * `test/observability-providers/audit-bounded-sweep.test.ts` — a reviewed
 * change, never a silent one. The module documentation of `audit.ts`, the
 * observability README and the exporters page state the same list.
 */

import type { DecisionEvidence, RuleEvidence, SelectionEvidence } from 'footprintjs';

import {
  bool,
  byContract,
  charsMarker,
  either,
  keysMarker,
  listOf,
  nullOr,
  num,
  oneOf,
  orList,
  shapeOf,
  str,
  when,
  type BoundRule,
} from './auditBounding.js';

/** The exceptions, by name — what each keeps, and why the record keeps it. */
export const KEPT_BY_CONTRACT = {
  'meta-identity':
    "who a run is for — the session id, principal and tenant the caller named — on each record's meta: the who of an audit record",
  'decide-evidence':
    'decide()/select() evidence an app emits on `composition.route_decided`, as the engine summarized it: rule labels, branches, operators, thresholds and verdicts, each field checked',
  'decision-summary':
    "the engine's summary of a value a decision rule read (decide() evidence, a skill guard's condition) — redaction-aware: under an agent's `redact` a selected key is the placeholder; otherwise the summary shows the value",
  'policy-reason-tag':
    "a permission policy's telemetry `reason` tag (`permission.check`, `permission.halt`) — the policy's own word",
  'app-reason-word':
    'the reason word an app attaches to a lifecycle event it emits itself (`skill.deactivated`, `tools.offered`, `permission.gate_closed`) — the app’s own words, as written',
  'seen-tool-name': 'a `tryInsteadTool` name, once this strategy has seen that tool run',
} as const;

/** The name of a kept-by-contract exception. */
export type KeptByContract = keyof typeof KEPT_BY_CONTRACT;

const exception = (name: KeptByContract, rule: BoundRule): BoundRule => byContract(name, rule);

/** decide()/select() evidence, as footprintjs declares it. */
export type DecideEvidence = DecisionEvidence | SelectionEvidence;
/** What a function rule read: a key and the engine's summary of its value. */
type ReadInput = Extract<RuleEvidence, { type: 'function' }>['inputs'][number];
/** What a filter rule compared: a key, an operator, a threshold, a summary and a verdict. */
type FilterCondition = Extract<RuleEvidence, { type: 'filter' }>['conditions'][number];

/**
 * What a decide() filter compares against — a value the app declared, or a
 * list of them — as this record keeps it. Anything else is a marker.
 */
export type DecideThreshold =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean | null)[];

/** A value the app declared: a word, a number or a flag — or a declared "none". */
export const declaredValue: BoundRule = nullOr(either(str, num, bool));

// ─── The exceptions ──────────────────────────────────────────────────

/** `meta.sessionId`, `meta.principal`, `meta.tenant`: the caller's own names for who. */
export const metaIdentity: BoundRule = exception('meta-identity', str);

/** The engine's summary of a value a rule read. */
export const decisionSummary: BoundRule = exception('decision-summary', str);

/** A permission policy's telemetry tag. */
export const policyReasonTag: BoundRule = exception('policy-reason-tag', str);

/** A reason word an app attaches to a lifecycle event it emits itself. */
export const appReasonWord: BoundRule = exception('app-reason-word', str);

/**
 * A `tryInsteadTool` name: kept only once this strategy has seen that tool run —
 * a tool the agent holds, by construction (`otel.ts` · `coverageAttrs`, the same
 * rule); otherwise it is the tool author's word for a tool this agent may not
 * hold.
 */
export function seenToolName(toolRan: (name: string) => boolean): BoundRule {
  return when(
    'a name this strategy has seen run is a tool the agent holds',
    (value) => typeof value === 'string' && toolRan(value),
    exception('seen-tool-name', str),
    charsMarker,
  );
}

/** One rule's evidence: what it read or compared, its verdict; a rule's thrown message is a marker. */
const boundRuleEvidence = shapeOf<RuleEvidence>({
  type: oneOf('filter', 'function'),
  ruleIndex: num,
  branch: str,
  matched: bool,
  label: str,
  inputs: listOf(shapeOf<ReadInput>({ key: str, valueSummary: decisionSummary, redacted: bool })),
  conditions: listOf(
    shapeOf<FilterCondition>({
      key: str,
      op: str,
      threshold: orList(declaredValue),
      actualSummary: decisionSummary,
      result: bool,
      redacted: bool,
    }),
  ),
  // A `when` that threw: its message can echo the value it read.
  matchError: charsMarker,
});

/** decide()/select() evidence: every field footprintjs declares, each checked. */
const boundDecideEvidence = shapeOf<DecideEvidence>({
  retryLoop: shapeOf<NonNullable<DecisionEvidence['retryLoop']>>({
    id: str,
    series: str,
    attempt: num,
    of: num,
    effect: oneOf('applied', 'none', 'unknown'),
    reconciled: bool,
    next: oneOf('done', 'retry', 'stop'),
    reason: str,
  }),
  rules: listOf(boundRuleEvidence),
  chosen: str,
  default: str,
  defaultLabel: str,
  selected: listOf(str),
});

/** decide() evidence carries its own `rules` list — `otel.ts`'s test too. */
const isDecideEvidence = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.hasOwn(value, 'rules') &&
  Array.isArray((value as { rules?: unknown }).rules);

/**
 * `composition.route_decided.evidence`: decide() evidence is kept by contract,
 * as its own shape; any other evidence (a router's own `{ reason }`) is a
 * free-form record — its key names only.
 */
export const routeEvidence: BoundRule = when(
  "decide() evidence is the engine's, kept by contract; any other is a record",
  isDecideEvidence,
  exception('decide-evidence', boundDecideEvidence),
  keysMarker,
);
