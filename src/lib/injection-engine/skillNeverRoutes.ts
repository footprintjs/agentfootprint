/**
 * skillNeverRoutes — the NEGATIVE routing row: a phrase this graph must claim
 * NOWHERE.
 *
 * ## Why the negative form is the valuable one
 *
 * `skillExamples.ts` pins the positive assertion — this rule claims this
 * phrasing — and it cannot state the opposite. Field use says the opposite is
 * the one that catches the expensive failure. An UNDER-triggering skill costs a
 * turn: the deterministic layer declines, the model tier picks, and the answer
 * is usually still reachable. An OVER-triggering skill costs the whole answer:
 * the wrong body enters the system prompt, the wrong tools enter the tools
 * slot, and everything the model then says is shaped by a skill that had no
 * business in the turn. One reviewer of a production graph had written his own
 * harness for exactly this, outside the library, because the library could only
 * express the cheap half.
 *
 * ## Where a negative row lives, and why it is NOT on a skill
 *
 * `examples` sits on the rule it is about. A negative row cannot: the phrase it
 * describes belongs to NO skill, and hanging it on one would make three things
 * wrong at once —
 *
 *   • it would read as that skill's business ("weather questions, filed under
 *     billing") when the point is that it is nobody's;
 *   • the assertion is satisfied only when EVERY rule declines, so a row read
 *     as one rule's property would be checked against one rule and pass while
 *     another rule swallowed the phrase;
 *   • deleting the skill would delete the assertion — exactly when a graph is
 *     re-partitioned, which is exactly when over-triggering is introduced.
 *
 * A negative row is a property of the PARTITION, so it is declared at the graph
 * level (`.neverRoutes([...])` / `neverRoutes: [...]`) and judged against every
 * rule in declaration order.
 *
 * ## What is asserted — precisely, and what it does NOT cover
 *
 * The claim this module proves is: **no declared start RULE claims the
 * phrase.** It runs the compiled conditions on a cold-start context, exactly as
 * `skillExamples.ts` does, and reports the rule that says yes.
 *
 * It does NOT prove "no routing at all occurs", and could not without becoming
 * a different kind of check:
 *
 *   • an INTENT rule compiles to no sync predicate — a classifier judges it at
 *     run time, with a scorer (and, for `llmClassifier`, a model call). Running
 *     that would make the check async, non-deterministic, and in the LLM case
 *     billable — `graph.checkupIntents()` is where scorer-dependent auditing
 *     already lives;
 *   • a scorer menu (`.entryBy()`) and `.entryByRead()` RANK descriptions;
 *     there is no claim to run;
 *   • the model tier can open any open skill by name with `read_skill`, at
 *     which point no declaration is deciding anything.
 *
 * That statement ships on the report as {@link NEVER_ROUTES_BOUNDARY}, next to
 * the problems, for the same reason the examples boundary does: a reader who
 * meets a boundary only in prose docs meets a clean report first.
 *
 * A predicate that THROWS on the cold context counts as a no-match here, and is
 * not reported — because routing itself treats a throw as a no-match, so the
 * phrase really does not route through that rule. Its own rule's `examples`
 * report the throw as an error (that is a defect in the rule, not in the
 * partition).
 *
 * Composed into `graph.checkup()` by `skillGraph.ts`, like every other domain
 * check, and reporting in the shared `GraphProblem` voice.
 *
 * Zone: PURE CORE. Pinned by
 * `test/lib/injection-engine/skill-graph-fence.test.ts`.
 */

import type { GraphProblem } from './skillGraphCheckup.js';
import {
  COLD_CONTEXT_PHRASE,
  claimLaws,
  describeCondition,
  type StartRuleDecl,
} from './startRuleClaim.js';

/**
 * The statement the negative check makes about its own reach, carried on
 * `GraphCheckup.notes` whenever a graph declared any negative row. Same voice
 * as `EXAMPLES_BOUNDARY` (skillExamples.ts): silence here is evidence about the declared
 * RULES, and about nothing downstream of them.
 */
export const NEVER_ROUTES_BOUNDARY =
  'A `neverRoutes` row proves that no DECLARED start rule claims the phrase. It does not ' +
  'prove the turn routes nowhere: an intent rule is judged by a classifier at run time, a ' +
  'scorer / `.entryByRead()` menu ranks descriptions, and the model can always open an open ' +
  'skill by name with read_skill — none of those are run here.';

/** The slice of an entry declaration this check reads: the shared claim shape,
 *  plus the POSITIVE phrases the same rule declared (a phrase asserted both
 *  ways is a contradiction the author wrote, and is reported as one). */
export interface NeverRoutesRuleDecl extends StartRuleDecl {
  readonly examples?: readonly string[];
}

/** What {@link checkNeverRoutes} found, plus what it wants to say about its own
 *  reach. Both empty when the graph declared no negative row. */
export interface NeverRoutesCheckup {
  readonly problems: readonly GraphProblem[];
  readonly notes: readonly string[];
}

const NOTHING: NeverRoutesCheckup = Object.freeze({
  problems: Object.freeze([]) as readonly GraphProblem[],
  notes: Object.freeze([]) as readonly string[],
});

/** How two phrases are compared for "the same phrase": trimmed and
 *  case-folded, the same normalization `duplicate-intent-example` uses — an
 *  author who writes one row in two casings meant one row. Exported so the
 *  builder's accumulated-rows set is keyed the SAME way the refusal is; two
 *  spellings of one rule is how a duplicate slips through. */
export function neverRouteKey(phrase: string): string {
  return phrase.trim().toLowerCase();
}

/**
 * Validate a graph-level `neverRoutes` list at DECLARATION time, refusing every
 * shape whose check-up answer could only mislead — each refusal naming the fix:
 *
 *   • not an array / an EMPTY array — nothing to assert, and a check-up that
 *     passes in silence reads as coverage;
 *   • a non-string or blank entry — there is no phrase to run a matcher on;
 *   • a phrase already declared — a repeat asserts nothing the first one did
 *     not, and reads as if two different phrasings were meant.
 *
 * A single string is accepted and read as a one-row list: `.neverRoutes('what
 * is the weather')` is the commonest call, and making the author type brackets
 * for it buys nothing.
 *
 * Returns a frozen copy of the ROWS THIS CALL ADDS, so the stored list cannot
 * drift from the validated one.
 */
export function validateNeverRoutes(
  phrases: unknown,
  where: string,
  alreadyDeclared: ReadonlySet<string>,
): readonly string[] {
  const list = typeof phrases === 'string' ? [phrases] : phrases;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `skillGraph: ${where} declares a \`neverRoutes\` list this library cannot honor. ` +
        `\`neverRoutes\` is the phrasings this graph must claim NOWHERE — a non-empty array ` +
        `of non-empty strings (or one string), e.g. neverRoutes: ['what is the weather']. ` +
        `${
          Array.isArray(list)
            ? 'An empty list asserts nothing, so the check-up would pass in silence and you ' +
              'would read that as proof no rule over-triggers. '
            : ''
        }List at least one phrasing, or drop the field.`,
    );
  }
  const bad = list.findIndex((p) => typeof p !== 'string' || p.trim().length === 0);
  if (bad >= 0) {
    throw new Error(
      `skillGraph: ${where} declares \`neverRoutes[${bad}]\` = ${JSON.stringify(
        list[bad],
      )}, which is not a usable phrasing. Every row must be a NON-EMPTY string — the words a ` +
        `user would really type and that no skill here should take. Fix that entry, or drop it.`,
    );
  }
  const seen = new Set(alreadyDeclared);
  for (const phrase of list as string[]) {
    const key = neverRouteKey(phrase);
    if (seen.has(key)) {
      throw new Error(
        `skillGraph: ${where} declares the \`neverRoutes\` row ${JSON.stringify(
          phrase,
        )} twice (compared trimmed and case-folded). One row already asserts it against every ` +
          `rule in the graph; the repeat proves nothing further. Drop the duplicate.`,
      );
    }
    seen.add(key);
  }
  return Object.freeze([...(list as string[])]);
}

/**
 * Run the negative rows against the declared start rules. Pure, and
 * byte-identically silent when the graph declared none (one length check and
 * out).
 *
 * Unlike the positive examples, this needs NO `orderDecides` gate: the
 * assertion is "nobody claims it", which every rule has to satisfy, so the
 * order they are read in cannot change the answer. That is also why it is the
 * one phrase check that stays meaningful under a classifier — tier 1 is still
 * read first there, and a rule that claims the phrase still takes the turn
 * before any scorer runs.
 */
export function checkNeverRoutes(input: {
  readonly entries: readonly NeverRoutesRuleDecl[];
  readonly phrases: readonly string[];
}): NeverRoutesCheckup {
  const { entries, phrases } = input;
  if (phrases.length === 0) return NOTHING;

  const laws = claimLaws(entries);
  const problems: GraphProblem[] = [];
  for (const phrase of phrases) {
    // (a) CONTRADICTION — the author declared the same phrase as a POSITIVE
    //     example on some rule. Reported first and alone: whichever way the
    //     router lands, one of the two declarations is wrong, and no fact about
    //     matchers helps until the author decides which. (Checked before the
    //     matchers are run, because a rule can declare an example its own
    //     matcher misses — the contradiction is in the declarations, not in the
    //     routing.)
    const contradicting = entries.find((e) =>
      (e.examples ?? []).some((ex) => neverRouteKey(ex) === neverRouteKey(phrase)),
    );
    if (contradicting !== undefined) {
      problems.push({
        kind: 'error',
        code: 'never-routes-contradicts-example',
        message:
          `The graph declares that "${phrase}" must route NOWHERE, and the start rule for ` +
          `"${contradicting.id}" declares the SAME phrase in its own \`examples\` — the list ` +
          `of phrasings that rule CLAIMS. Two of your own declarations contradict each other ` +
          `about one phrase, so one of them is wrong wherever the router lands, and the ` +
          `check-up cannot tell which you meant. Decide: drop the \`neverRoutes\` row, or ` +
          `drop the phrase from "${contradicting.id}"'s \`examples\`.`,
        skill: contradicting.id,
        example: phrase,
      });
      continue;
    }

    // (b) CLAIMED BY A RULE — the failure this row exists to catch. An ERROR:
    //     the author personally wrote that no skill should take this phrase, a
    //     rule takes it, and both start laws agree it does (a CONDITIONAL
    //     claimant is read by tier 1 AND by the cold walk). The turn would open
    //     with that skill's body and tools on the wire.
    const byRule = laws.underCascade(phrase);
    if (byRule !== undefined) {
      problems.push({
        kind: 'error',
        code: 'never-routes-claimed',
        message:
          `The graph declares that "${phrase}" must route NOWHERE, but the start rule for ` +
          `"${byRule.entry.id}" claims it — ${describeCondition(
            byRule.entry,
          )} matches the phrase, so a turn phrased that way STARTS on "${byRule.entry.id}", ` +
          `with that skill's body in the system prompt and that skill's tools on the wire ` +
          `shaping the whole answer. Narrow "${byRule.entry.id}"'s ${
            byRule.entry.match === undefined ? 'predicate' : 'matcher'
          } until it stops claiming this phrasing, or drop the row if "${byRule.entry.id}" ` +
          `really should take it. (Proved by running the declared conditions on the phrase on ` +
          `${COLD_CONTEXT_PHRASE} — no regex intersection was decided.)`,
        skill: byRule.entry.id,
        example: phrase,
      });
      continue;
    }

    // (c) CLAIMED BY A DEFAULT — no RULE claims it, but an unconditional entry
    //     does under one of the two start laws. That is the one place the laws
    //     differ (`skillExamples.ts` header), and which one applies is decided
    //     at AGENT MOUNT, not here — so a WARNING naming both readings, never
    //     an error the router might disagree with.
    const byWalk = laws.underColdWalk(phrase);
    if (byWalk === undefined) continue;
    problems.push({
      kind: 'warning',
      code: 'never-routes-by-default',
      message:
        `The graph declares that "${phrase}" must route NOWHERE, and no start RULE claims it ` +
        `— but the entry "${byWalk.entry.id}" ${describeCondition(
          byWalk.entry,
        )}, so whether the phrase routes depends on how this graph is MOUNTED and the check-up ` +
        `cannot decide it. Mounted the default way (continuity: 'turn'), the declaration-order ` +
        `cold start stops at "${byWalk.entry.id}" and every message starts there, this one ` +
        `included. Mounted with a classifier or with continuity: 'conversation', the turn-start ` +
        `cascade's tier 1 reads the CONDITIONAL rules only — an unconditional entry is a ` +
        `default, not a rule — so nothing claims the phrase and the turn falls onward. Give ` +
        `"${byWalk.entry.id}" a \`match\`/\`when\` if it is meant to be a rule; if it is meant ` +
        `to be the catch-all, a negative row can only ever be a statement about the RULES ` +
        `above it (which is what this warning reports).`,
      skill: byWalk.entry.id,
      example: phrase,
    });
  }

  return { problems, notes: [NEVER_ROUTES_BOUNDARY] };
}
