/**
 * served — what an event of a run is SERVED as: its payload and the identity
 * on its meta, through the run's redaction rule.
 *
 * Pattern: one projection, decided once per event, by footprintjs's rule.
 * Role:    the Lens half of `src/redaction/`. It decides nothing about what is
 *          secret — `RedactionRule` (footprintjs/advanced) does, the ONE owner
 *          of every verdict. This file only says which of the rule's own
 *          decisions applies to a typed event:
 *
 *   - THE EVENT'S NAME — `retainEmit`: an event whose name `emitPatterns`
 *     selects is served with the placeholder for a payload, exactly as
 *     footprintjs serves a `$emit` payload it selects by name.
 *   - THE PAYLOAD — `retainBoundary`: a typed event's payload is a record
 *     handed out whole, the class footprintjs serves a pause payload, a run's
 *     input and output, a subflow's seed and a thrown value as — a selected
 *     key at ANY depth, and a declared field under a key of its name.
 *   - THE META'S IDENTITY — `principal` and `tenant` are who asked: values the
 *     caller passed, selected by their names like any other. Every other meta
 *     field (run, stage, session, trace, correlation ids; timestamps) is the
 *     record's ADDRESS — how an event joins its run — and is never selected:
 *     masking an address would detach the record from itself, not protect it.
 *
 * A payload whose scrub cannot run (an uncloneable value under a selected
 * field) is served as the placeholder whole, never raw — footprintjs's own
 * rule for a pause payload it cannot scrub.
 *
 * One more decision, the rule's own TAINT law applied to the library's own
 * copies: a field the library DERIVES from another value and carries under a
 * name of its own (`DERIVED` — a parser's message quotes the model's draft)
 * is served as the placeholder whenever the rule keeps the value it was
 * derived from out. footprintjs marks a subflow mapper's computed copy of a
 * selected value the same way; the verdict is still the rule's, by name.
 */

import type { RedactionRule } from 'footprintjs/advanced';

import type { EventMeta } from '../events/types.js';

/** The placeholder footprintjs serves a record handed out whole with. */
export const SERVED_PLACEHOLDER = '[REDACTED]';

/** What one run's events are served as. */
export interface EventServing {
  /** True when the run's rule can select anything — the no-policy fast path is `false`. */
  active(): boolean;
  /** The payload as served: the placeholder, a scrubbed copy, or the payload itself. */
  payload(type: string, payload: unknown): unknown;
  /** The meta as served: the same object unless its identity was selected. */
  meta<M extends EventMeta>(meta: M): M;
}

/**
 * Serving through `ruleOf()` — read on every event, because the rule a run
 * decides with is the executor's own and footprintjs builds a fresh one per
 * leg (a resume continues the paused run's marks on a new rule).
 *
 * @param ruleOf      the rule in force for the current event
 * @param hasEmitNames whether the policy selects any event by NAME
 *                    (`emitPatterns`) — a policy with only those keeps the
 *                    state rule inert, and inertness alone would skip them
 */
export function eventServing(ruleOf: () => RedactionRule, hasEmitNames: boolean): EventServing {
  const active = (): boolean => hasEmitNames || !ruleOf().isInert();
  return {
    active,
    payload(type, payload) {
      if (!active()) return payload;
      return servedPayload(ruleOf(), type, payload);
    },
    meta(meta) {
      if (meta.principal === undefined && meta.tenant === undefined) return meta;
      if (!active()) return meta;
      return servedMeta(ruleOf(), meta);
    },
  };
}

/**
 * Fields the library derives from another value, per event type: a parser's
 * or a fallback's message can quote the model's draft (`rawOutput`) it could
 * not read, so it is kept out whenever the draft is.
 */
const DERIVED: Readonly<
  Record<string, { readonly from: string; readonly fields: readonly string[] }>
> = {
  'agentfootprint.agent.output_schema_validation_failed': {
    from: 'rawOutput',
    fields: ['message'],
  },
  'agentfootprint.agent.output_schema_retry': { from: 'rawOutput', fields: ['error'] },
  'agentfootprint.agent.output_contract_unmet': { from: 'rawOutput', fields: ['error'] },
  'agentfootprint.reliability.fail_fast': { from: 'rawOutput', fields: ['errorMessage'] },
  'agentfootprint.resilience.output_fallback_triggered': {
    from: 'rawOutput',
    fields: ['primaryErrorMessage'],
  },
  'agentfootprint.resilience.output_canned_used': {
    from: 'rawOutput',
    fields: ['fallbackErrorMessage'],
  },
};

/** The served form of one payload — see the file header for the decisions. */
function servedPayload(rule: RedactionRule, type: string, payload: unknown): unknown {
  try {
    const named = rule.retainEmit(type, payload);
    if (named !== payload) return named;
    return withDerivedKeptOut(rule, type, rule.retainBoundary(payload));
  } catch {
    return SERVED_PLACEHOLDER;
  }
}

/** `served` with the fields derived from a kept-out value served as the placeholder. */
function withDerivedKeptOut(rule: RedactionRule, type: string, served: unknown): unknown {
  const derived = DERIVED[type];
  if (derived === undefined || !rule.isKeyRedacted(derived.from)) return served;
  if (served === null || typeof served !== 'object' || Array.isArray(served)) return served;
  const record = served as Record<string, unknown>;
  const held = derived.fields.filter(
    (field) => record[field] !== undefined && record[field] !== SERVED_PLACEHOLDER,
  );
  if (held.length === 0) return served;
  return { ...record, ...Object.fromEntries(held.map((field) => [field, SERVED_PLACEHOLDER])) };
}

/** The meta with its identity served by name; the address untouched. */
function servedMeta<M extends EventMeta>(rule: RedactionRule, meta: M): M {
  const identity: { principal?: string; tenant?: string } = {
    ...(meta.principal !== undefined && { principal: meta.principal }),
    ...(meta.tenant !== undefined && { tenant: meta.tenant }),
  };
  let kept: { principal?: unknown; tenant?: unknown };
  try {
    kept = rule.retainBoundary(identity);
  } catch {
    kept = Object.fromEntries(Object.keys(identity).map((key) => [key, SERVED_PLACEHOLDER]));
  }
  if (kept === identity) return meta;
  return { ...meta, ...kept } as M;
}
