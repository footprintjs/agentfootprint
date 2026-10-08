/**
 * served — what an event of a run is SERVED as: its payload and the identity
 * on its meta, through the run's redaction rule. THE funnel: every typed event
 * leaves a stage through it (`runRedaction.ts` · `emitServed`), and every fact
 * the dispatcher hands a listener is served by it (`EventDispatcher`).
 *
 * Pattern: one mapping step, decided once per event.
 * Role:    the Lens half of `src/redaction/`. It decides nothing about what a
 *          policy selects — footprintjs's `RedactionRule` (footprintjs/advanced)
 *          does, the ONE owner of every verdict by name — and it keeps
 *          nothing: no list of runs, listeners or values, and no cache outside
 *          the one run's serving. In order:
 *
 *   1. THE EVENT'S NAME — `retainEmit`: an event whose name `emitPatterns`
 *      selects is served with the placeholder for a payload, exactly as
 *      footprintjs serves a `$emit` payload it selects by name.
 *   2. THE PAYLOAD, BY NAME — `retainBoundary`: a typed event's payload is a
 *      record handed out whole — a selected key at ANY depth, a declared field
 *      under a key of its name.
 *   3. THE VALUE-KIND RULE — under ANY policy (one that selects at least one
 *      name), events are DEFAULT-DENY by value kind: every value is checked by
 *      its kind, wherever it sits (`knownStrings.ts` · `keepKnownValues`).
 *      Numbers, booleans and null pass; a string passes only when it is one
 *      of the library's own words (a closed set generated from its types);
 *      everything else — ids and names included — is the placeholder. So a copy the
 *      library derives from a selected value under a name of its own (a
 *      validation issue's quote, a check-in's rendered arguments, a parser's
 *      message about the draft, a coverage declaration's words) can never
 *      leave raw — no field is trusted by its position, and there is no list
 *      of fields, or of derived copies, to keep complete. A policy makes
 *      EVENTS conservative; state, the snapshot and the commit log keep
 *      footprintjs's rule, by name. For full observability, run with no policy.
 *   4. THE META'S IDENTITY — `principal` and `tenant` (who asked) are served
 *      by their names, then by the value-kind rule, each in its own slot: the
 *      placeholder under any policy. Every other meta field is the record's
 *      ADDRESS (run, stage, session, trace ids) and is never served
 *      differently.
 *
 * A payload whose serving cannot run (a getter that throws) is served as the
 * placeholder whole, never raw.
 */

import type { RedactionRule } from 'footprintjs/advanced';

import type { EventMeta } from '../events/types.js';
import { keepKnownValues, servedString } from './knownStrings.js';
import { SERVED_PLACEHOLDER } from './placeholder.js';

export { SERVED_PLACEHOLDER };

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
 * @param underPolicy whether the run is covered by a policy that names
 *                    anything (`policy.ts` · `namesAnything`) — one of event
 *                    names or diagnostic selectors only keeps footprintjs's
 *                    rule inert, and inertness alone would serve its events raw
 */
export function eventServing(ruleOf: () => RedactionRule, underPolicy: boolean): EventServing {
  // A run with no policy is active only once it marks a key (a per-call
  // `$setValue(key, value, true)`): its rule is then no longer inert.
  const active = (): boolean => underPolicy || !ruleOf().isInert();
  return {
    active,
    payload(type, payload) {
      if (!active()) return payload;
      const rule = ruleOf();
      try {
        const byEvent = rule.retainEmit(type, payload);
        if (byEvent !== payload) return byEvent;
        return keepKnownValues(rule.retainBoundary(payload));
      } catch {
        return SERVED_PLACEHOLDER;
      }
    },
    meta(meta) {
      if (meta.principal === undefined && meta.tenant === undefined) return meta;
      if (!active()) return meta;
      return servedMeta(ruleOf(), meta);
    },
  };
}

/** The two identity fields of a meta — the meta's own names, never data. */
const IDENTITY = ['principal', 'tenant'] as const;

/**
 * The meta with its identity served — by name, then by kind; the address
 * untouched. Each field is served IN ITS OWN SLOT: `principal` and `tenant`
 * are the meta's names, not data, so only their values are checked — a
 * served copy is never spread over the meta (a key the value rule collapsed
 * would leave the raw value beside it).
 */
function servedMeta<M extends EventMeta>(rule: RedactionRule, meta: M): M {
  const identity: { principal?: string; tenant?: string } = {
    ...(meta.principal !== undefined && { principal: meta.principal }),
    ...(meta.tenant !== undefined && { tenant: meta.tenant }),
  };
  let named: Record<string, unknown> | undefined;
  try {
    named = rule.retainBoundary(identity) as Record<string, unknown>;
  } catch {
    named = undefined;
  }
  let served: M | undefined;
  for (const field of IDENTITY) {
    const value = identity[field];
    if (value === undefined) continue;
    const verdict = named?.[field];
    const kept = typeof verdict === 'string' ? servedString(verdict) : SERVED_PLACEHOLDER;
    if (kept === value) continue;
    served ??= { ...meta };
    (served as { [K in (typeof IDENTITY)[number]]?: string })[field] = kept;
  }
  return served ?? meta;
}
