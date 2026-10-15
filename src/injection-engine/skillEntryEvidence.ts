/**
 * skillEntryEvidence — the two graph-level rows about GUESSED entries.
 *
 * Pattern: pure check module composed into `graph.checkup()` (the
 *          skillExamples.ts shape: frozen empties when nothing applies, so a
 *          graph that never heard of this pays one array scan).
 * Role:    states the PRECONDITION of a recorded failure class, once per
 *          graph, with a named cure — never nineteen errors on a shape the
 *          library documents as legitimate.
 *
 * The recorded failure: an entry regex matched the noun "zone" inside a
 * request to FIND something, the turn started on an audit skill, and no
 * declared edge could ever leave it — so one wrong guess owned all 30 calls.
 * Three independent designers first proposed a per-node "every position must
 * have an exit" lint; run against the real 20-skill graph it flags 0 of 20
 * (the reachability union makes it vacuous) and with the union dropped it
 * flags 19 of 20, including documented-correct shapes. What survives are two
 * ONE-ROW facts, each checkable from the declaration alone:
 *
 *   `one-way-entries` (WARNING, ≤1 per graph) — three or more rule-driven
 *   entries AND more than half of them have no declared outgoing edge. Not a
 *   claim of a trap: the stated precondition for one. If a guess can drop the
 *   cursor on most positions and no declared edge can ever move it off them,
 *   a mis-entry is permanent for the whole turn. Silent on a pipeline, a
 *   decision tree, a two-skill agent, and a graph whose entries mostly route
 *   onward.
 *
 *   `no-negative-evidence` (WARNING, ≤1 per graph) — three or more
 *   rule-driven entries and ZERO `examples` rows and ZERO `neverRoutes`
 *   phrases anywhere. The proving machinery ships (a `neverRoutes` phrase a
 *   rule claims is a build ERROR with a witness; an `examples` phrase proves
 *   which rule wins it); this row exists because the consumer that hit the
 *   recorded failure declared neither, anywhere — the fix existed and was
 *   unused. One row would have turned the incident into build-time
 *   arithmetic.
 *
 * Both are WARNINGS on purpose: escalating either to a refusal would break
 * existing consumers' builds on upgrade (the zero-delta law). The runtime
 * repair for the same failure class is the maps kernel (`.maps()`), which
 * parks a guessed engagement that earns no corroboration.
 */

import type { GraphProblem } from './skillGraphCheckup.js';

export interface EntryEvidenceInput {
  /** Declared entries, with whether each is rule-driven (conditional) and
   *  whether it declares build-time `examples`. */
  readonly entries: ReadonlyArray<{
    readonly id: string;
    readonly conditional: boolean;
    readonly hasExamples: boolean;
  }>;
  /** Every `fromId` that has at least one declared outgoing route. */
  readonly routeFromIds: ReadonlySet<string>;
  /** How many `neverRoutes` phrases the graph declares. */
  readonly neverRoutesCount: number;
  /** Decision trees route by predicate — neither row applies. */
  readonly isTree: boolean;
}

const FROZEN_NONE: readonly GraphProblem[] = Object.freeze([]);

/** Run both rows. Pure; returns the same frozen empty when nothing applies. */
export function checkEntryEvidence(input: EntryEvidenceInput): readonly GraphProblem[] {
  if (input.isTree) return FROZEN_NONE;
  const ruleDriven = input.entries.filter((e) => e.conditional);
  if (ruleDriven.length < 3) return FROZEN_NONE;

  const problems: GraphProblem[] = [];

  const oneWay = ruleDriven.filter((e) => !input.routeFromIds.has(e.id));
  if (oneWay.length * 2 > ruleDriven.length) {
    const named =
      oneWay.length <= 6
        ? oneWay.map((e) => `'${e.id}'`).join(', ')
        : `${oneWay
            .slice(0, 5)
            .map((e) => `'${e.id}'`)
            .join(', ')} and ${oneWay.length - 5} more`;
    problems.push({
      kind: 'warning',
      code: 'one-way-entries',
      message:
        `${oneWay.length} of ${ruleDriven.length} rule-driven entries declare no outgoing ` +
        `edge (${named}). A start rule is a GUESS about intent — and once a guess drops the ` +
        `cursor on one of these, no declared edge can ever move it off, so a wrong guess owns ` +
        `the whole turn. This is the precondition of a recorded 30-call stuck turn, not a ` +
        `verdict about this graph. Cures: declare the real handoffs as routes; prove the ` +
        `rules with examples/neverRoutes; or mount .maps() so an uncorroborated guess is ` +
        `parked instead of riding every call.`,
    });
  }

  const anyExamples = ruleDriven.some((e) => e.hasExamples);
  if (!anyExamples && input.neverRoutesCount === 0) {
    problems.push({
      kind: 'warning',
      code: 'no-negative-evidence',
      message:
        `${ruleDriven.length} rule-driven entries, and not one declares examples — and the ` +
        `graph declares no neverRoutes phrases. Nothing proves any rule routes what its ` +
        `author meant, or refuses what they did not. The machinery ships: one ` +
        `neverRoutes(['<a phrase that must route nowhere>']) row turns a mis-route into a ` +
        `build-time ERROR with a witness, and examples on a rule prove which rule wins them. ` +
        `In the recorded keyword-trap failure the consumer declared neither, anywhere.`,
    });
  }

  return problems.length === 0 ? FROZEN_NONE : problems;
}
