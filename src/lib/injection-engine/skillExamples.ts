/**
 * skillExamples — the EXAMPLES side of a start rule: the phrasings a rule says
 * it claims, and the three things a build-time check-up can then PROVE about
 * them by RUNNING the compiled matchers instead of comparing them.
 *
 * ## Why this exists (two field failures, one evening)
 *
 * `compareMatchers` (skillMatch.ts) answers only what matcher-vs-matcher
 * analysis can prove, and says so out loud: two DIFFERENT regex sources return
 * `undefined` ("regex intersection is not decided here — only identity is
 * provable"). That honesty left two real production failures unreportable:
 *
 *   A. SHADOWING BY DIFFERENT REGEXES — an earlier rule matching one product
 *      name sat above an inventory rule whose matcher is a longer alternation.
 *      A real phrase ("what's running on <host-looking-name>") was claimed by
 *      the earlier rule, so the later rule could never win on its own
 *      phrasings. Two different regexes: the check-up was correctly silent.
 *   B. ABSENCE — a second phrase matched NO rule at all, fell through to the
 *      model tier, and the model picked the wrong skill because an array name
 *      looked like a hostname. Not shadowing: absence. No amount of
 *      matcher-vs-matcher analysis can ever catch it.
 *
 * A declared example turns both into arithmetic. Run the compiled predicates
 * over one concrete phrase, in declaration order, exactly as the cold start
 * does — and the answer is a WITNESS, not a theory: this phrase, this rule,
 * this winner. No regex intersection is decided anywhere in this file.
 *
 * ## The tier difference (read this before writing `examples` anywhere)
 *
 * Two different lists spell the same author-facing sentence — "the phrasings
 * this rule claims" — and they have DIFFERENT RUNTIME ROLES:
 *
 *   • TIER 2, `match: { intent, examples }` — SCORING material. The classifier
 *     reads those examples AT RUN TIME to judge every new message
 *     (`skillIntent.ts`); they are part of how the graph routes.
 *   • TIER 1, a rule-level `examples: [...]` (this file) — TEST material. Read
 *     at BUILD time by the check-up and fed to nothing, ever. They do not
 *     widen, soften or otherwise touch matching: a rule with examples routes
 *     byte-identically to the same rule without them.
 *
 * One rule may not carry both lists (a teaching refusal names the difference):
 * two example lists with two different jobs under one rule is exactly the
 * confusion this note exists to prevent.
 *
 * ## The two start laws, and why one of them is only a WARNING
 *
 * Which rule claims a phrase is decided by one of TWO laws, and the graph does
 * not know which one it will be mounted under:
 *
 *   • the declaration-order COLD WALK (`makeResolveCursor`, the default mount)
 *     returns at the first entry with no condition or the first whose condition
 *     passes — so an UNCONDITIONAL entry claims every message from its position
 *     onward;
 *   • the turn-start CASCADE's tier 1 (`firstRuleMatch`, skillIntent.ts) reads
 *     the CONDITIONAL non-intent entries only — an unconditional entry is a
 *     default, not a rule, and never wins the turn there. That cascade is
 *     mounted by `.classify()` AND by `.skillGraph(g, { continuity:
 *     'conversation' })`, and continuity is an AGENT-MOUNT option that does not
 *     exist yet when this check runs.
 *
 * The two laws differ in exactly one place: whether an unconditional entry
 * claims. So when the earlier claimant is unconditional, the check-up cannot
 * say which law will apply — it reports BOTH readings as a WARNING
 * (`example-shadowed-by-default`) instead of asserting one as an ERROR. A
 * check-up that disagrees with the router is worse than no check-up: the router
 * really does start that turn on the later rule under a `continuity:
 * 'conversation'` mount. The ERROR (`example-shadowed-by-earlier`) is kept for
 * what both laws agree on.
 *
 * ## The context a rule is judged in, and what that makes provable
 *
 * Every predicate here runs on ONE context: {@link coldContext} — iteration 1,
 * the phrase as `userMessage`, empty `history`, no cursor. That is a real
 * context (the first iteration of a turn), but it is not the only one a start
 * rule ever sees: turn 2 of a conversation also starts cold in cursor terms
 * while carrying HISTORY. So:
 *
 *   • a DATA matcher (`match:`) reads `userMessage` and nothing else, so a
 *     no-match here is a no-match under every context — ERROR;
 *   • an opaque `when` may legitimately be gated on conversation state
 *     (`ctx.history.length > 0`) and claim the phrase on a later turn — the
 *     check cannot run that turn, so a no-match is a WARNING, and the message
 *     names the context it judged under rather than leaving the author to guess.
 *
 * A THROW stays an ERROR either way: a predicate must be pure and total, and
 * the context it threw on is one every turn 1 really hands it.
 *
 * ## The boundary, and why it is on the report itself
 *
 * These checks prove things about the phrases the author DECLARED and nothing
 * about phrases nobody wrote. No warning is NOT proof of coverage. That
 * sentence ships as {@link EXAMPLES_BOUNDARY} on `GraphCheckup.notes` —
 * visible wherever the graph reports its problems — because a reader who meets
 * it only in prose docs will meet a clean report first.
 *
 * Composed into `graph.checkup()` by `skillGraph.ts`, exactly like
 * `skillContract`/`skillIntent`/`skillVocabulary`: this module owns the rule
 * AND its boundaries, and reports in the shared `GraphProblem` voice.
 */

import type { InjectionContext } from './types.js';
import { plainMatchCaption, type SkillMatchData } from './skillMatch.js';
import type { GraphProblem } from './skillGraphCheckup.js';

/**
 * The statement the check-up makes about its own reach, carried on
 * `GraphCheckup.notes` whenever any rule declared examples. Same voice as the
 * ingress ticket's "absence of a refusal is not consent": a clean report is
 * evidence about the phrases you wrote, and about nothing else.
 */
export const EXAMPLES_BOUNDARY =
  'These example checks prove things about the phrases you DECLARED and nothing about ' +
  'phrases nobody wrote — no warning here is not proof of coverage.';

/** The note added when declaration order does not decide the turn start, so
 *  only the order-independent check (self-match) could run. */
export const EXAMPLES_ORDER_NOT_CHECKED =
  'Shadowing and coverage were NOT checked for the declared examples: this graph picks its ' +
  'entry with a scorer / by model read, so declaration order does not decide the turn start. ' +
  "Each rule's own matcher was still run against its own examples.";

/**
 * The slice of an entry declaration this module reads — structural, so
 * `skillGraph.ts`'s module-private `EntryDecl` satisfies it unchanged (the
 * same trick `skillIntent.ts` uses).
 */
export interface ExampleRuleDecl {
  readonly id: string;
  /** The compiled condition (from `match:`) or the author's `when`. Absent on
   *  an unconditional entry and on an intent rule (no sync predicate). */
  readonly when?: (ctx: InjectionContext) => boolean;
  /** The serializable matcher behind `when`, when declared as data — quoted
   *  back in the messages, and the one way to spot the intent arm. */
  readonly match?: SkillMatchData;
  /** The phrasings this rule claims (build-time TEST material). */
  readonly examples?: readonly string[];
}

/** What {@link checkStartRuleExamples} found, plus what it wants to say about
 *  its own reach. Both empty when no rule declared examples. */
export interface ExamplesCheckup {
  readonly problems: readonly GraphProblem[];
  readonly notes: readonly string[];
}

const NOTHING: ExamplesCheckup = Object.freeze({
  problems: Object.freeze([]) as readonly GraphProblem[],
  notes: Object.freeze([]) as readonly string[],
});

/**
 * Validate a rule-level `examples` list at DECLARATION time, refusing every
 * shape whose check-up answer could only mislead — each refusal naming the fix:
 *
 *   • not an array / an EMPTY array — nothing to prove, and a check-up that
 *     passes in silence reads as coverage;
 *   • a non-string or blank entry — there is no phrase to run a matcher on;
 *   • examples on an UNCONDITIONAL entry — it claims every message, so every
 *     example passes by construction and proves nothing;
 *   • examples beside `match: { intent, examples }` — two lists, two jobs (see
 *     the tier note in this file's header).
 *
 * Returns a frozen copy (or `undefined` when nothing was declared), so the
 * stored list cannot drift from the validated one.
 */
export function validateStartRuleExamples(
  examples: unknown,
  where: string,
  rule: { readonly hasCondition: boolean; readonly isIntent: boolean },
): readonly string[] | undefined {
  if (examples === undefined) return undefined;
  if (!Array.isArray(examples) || examples.length === 0) {
    throw new Error(
      `skillGraph: ${where} declares an \`examples\` list this library cannot honor. ` +
        `\`examples\` is the phrasings this rule CLAIMS — a non-empty array of non-empty ` +
        `strings, e.g. examples: ['where is my refund']. They are read at build time by ` +
        `\`graph.checkup()\` and fed to nothing at run time. ` +
        `${
          Array.isArray(examples)
            ? 'An empty list declares nothing to prove, so the check-up would pass in silence ' +
              'and you would read that as coverage. '
            : ''
        }List at least one phrasing, or drop the field.`,
    );
  }
  const bad = examples.findIndex((e) => typeof e !== 'string' || e.trim().length === 0);
  if (bad >= 0) {
    throw new Error(
      `skillGraph: ${where} declares \`examples[${bad}]\` = ${JSON.stringify(
        examples[bad],
      )}, which is not a usable phrasing. Every example must be a NON-EMPTY string — the ` +
        `words a user would really type, which the check-up runs this rule's matcher ` +
        `against. Fix that entry, or drop it.`,
    );
  }
  if (rule.isIntent) {
    throw new Error(
      `skillGraph: ${where} declares \`match: { intent, examples }\` AND a rule-level ` +
        `\`examples\` list. One rule cannot carry two example lists with two different ` +
        `jobs: the examples INSIDE \`match: { intent, examples }\` are SCORING material — ` +
        `the classifier reads them at RUN time to judge new messages — while a rule-level ` +
        `\`examples\` list is TEST material, read only at build time by the check-up and ` +
        `fed to nothing. Keep the phrasings inside \`match: { intent, examples }\` (they ` +
        `are already audited by \`graph.checkupIntents()\`), and drop the rule-level list.`,
    );
  }
  if (!rule.hasCondition) {
    throw new Error(
      `skillGraph: ${where} declares \`examples\` but neither \`match\` nor \`when\`. An ` +
        `unconditional entry claims EVERY message (the cold start returns at the first ` +
        `entry with no condition), so every example on it passes by construction and ` +
        `proves nothing. Give this entry a \`match\` (a RegExp, { keywords: [...] } or ` +
        `{ all: [...] }) or a \`when\`, or move the examples to the rule that really ` +
        `claims those phrasings.`,
    );
  }
  return Object.freeze([...(examples as string[])]);
}

/**
 * Run the three example properties. Pure, and byte-identically silent when no
 * rule declared examples (one `Array.some` and out).
 *
 * `orderDecides` mirrors the gate the pairwise rule checks already use
 * (`!exclusiveEntries || hasClassifier`): declaration order decides the turn
 * start under the default form and under a classifier's tier 1, and does NOT
 * under a scorer or `.entryByRead()`. Where it does not hold, only the
 * order-independent property (self-match) is claimed and a note says so.
 */
export function checkStartRuleExamples(input: {
  readonly entries: readonly ExampleRuleDecl[];
  readonly orderDecides: boolean;
  readonly hasClassifier: boolean;
}): ExamplesCheckup {
  const { entries, orderDecides, hasClassifier } = input;
  if (!entries.some((e) => e.examples !== undefined && e.examples.length > 0)) return NOTHING;

  // WHO CAN CLAIM A PHRASE — both routing laws, mirrored, not re-invented (see
  // this file's header). Intent entries never claim synchronously in either
  // (no predicate at all), so neither set carries them.
  //
  //   • COLD WALK (`makeResolveCursor`, the default mount): every non-intent
  //     entry, unconditional ones included — they claim everything from their
  //     position onward.
  //   • CASCADE tier 1 (`firstRuleMatch`, mounted by `.classify()` OR by
  //     `continuity: 'conversation'`): the CONDITIONAL non-intent entries only.
  //
  // With a classifier the cascade is certain, so it is the only law consulted.
  // Without one, EITHER may be mounted — both are computed, and where they
  // disagree the report says so instead of picking one.
  const nonIntent = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.match?.kind !== 'intent');
  const ruleClaimants = nonIntent.filter(({ entry }) => entry.when !== undefined);
  const claimUnderCascade = (phrase: string): Claim | undefined =>
    ruleClaimants.find(({ entry }) => runsOn(entry, phrase) === 'match');
  const claimUnderColdWalk = (phrase: string): Claim | undefined =>
    nonIntent.find(({ entry }) => runsOn(entry, phrase) === 'match');

  const problems: GraphProblem[] = [];
  for (const [index, entry] of entries.entries()) {
    const examples = entry.examples;
    if (examples === undefined || examples.length === 0) continue;
    for (const phrase of examples) {
      // (a) SELF-MATCH — the cheapest of the three, and order-independent: a
      //     rule that does not claim its own example is a defect at build time.
      //     Severity follows PROVABILITY (see the header): a data matcher reads
      //     the user message and nothing else, so its no-match holds under every
      //     context — ERROR. An opaque `when` may be gated on conversation state
      //     and claim the phrase on a later turn, which this check cannot run —
      //     WARNING, with the judged context named. A throw is an ERROR either
      //     way: turn 1 really hands it that context.
      const own = runsOn(entry, phrase);
      if (own !== 'match') {
        const provable = own === 'threw' || entry.match !== undefined;
        problems.push({
          kind: provable ? 'error' : 'warning',
          code: 'example-misses-own-rule',
          message: selfMissMessage(entry, phrase, own),
          skill: entry.id,
          example: phrase,
        });
      }
      if (!orderDecides) continue;

      // The mounted-by-default reading. With a classifier the cascade is
      // certain, so it IS the walk; the second law is consulted only where the
      // two can differ (an unconditional claimant, below) — a predicate is run
      // no more often than the answer needs.
      const winner = hasClassifier ? claimUnderCascade(phrase) : claimUnderColdWalk(phrase);
      // (c) UNCLAIMED — the strong case: no rule claims the phrase at all, so
      //     the deterministic layer declines and the turn falls onward. WARNING,
      //     not an error: the run is not broken — the next tier (a classifier, or
      //     the model) may well answer correctly, and the library cannot prove
      //     otherwise. What it CAN prove is that nothing declared claims it.
      if (winner === undefined) {
        problems.push({
          kind: 'warning',
          code: 'example-unclaimed',
          message:
            `No start rule claims the example "${phrase}" (declared on "${entry.id}") — every ` +
            `rule's condition was run against it in declaration order on ${COLD_CONTEXT_PHRASE} ` +
            `and none matched, so a turn phrased that way ${
              hasClassifier
                ? 'falls past tier 1 to the classifier, and on a near-tie to a menu the model ' +
                  'resolves'
                : 'starts on no entry and falls through to the model tier, which picks a skill ' +
                  'by name'
            }. Widen "${entry.id}"'s ${
              entry.match === undefined ? 'predicate' : 'matcher'
            } to cover the phrase, or add a rule that claims ` +
            `it. (This proves coverage for the phrases you declared and for no others — a ` +
            `phrasing nobody wrote is not checked.)`,
          skill: entry.id,
          example: phrase,
        });
        continue;
      }
      // A winner LATER than the owner means the owner rejected its own example —
      // already reported as `example-misses-own-rule` above, which names the
      // defect. Nothing further is provable that the first problem did not say.
      if (winner.index >= index) continue;

      // (b) SHADOWED-BY-EARLIER — proof by witness, where matcher-vs-matcher
      //     analysis has to stay silent (two different regexes). ERROR: two of
      //     the author's own declarations contradict each other about ONE
      //     phrase they both wrote, and the turn start is decided — wrongly,
      //     by the author's own account. (`rules-shadowed-by-order` stays a
      //     warning because it reasons about ALL possible messages, where a
      //     deliberately dead fallback is a legitimate design; here the author
      //     personally wrote the phrase this rule claims.)
      //
      //     The ERROR is claimed only where BOTH start laws agree. A CONDITIONAL
      //     claimant is one both laws read, and it is the first match under the
      //     cold walk, so no unconditional entry preceded it and the cascade
      //     reads the identical prefix — the two laws cannot disagree here.
      if (winner.entry.when !== undefined) {
        problems.push({
          kind: 'error',
          code: 'example-shadowed-by-earlier',
          message:
            `Start rule for "${entry.id}" declares the example "${phrase}", but the EARLIER ` +
            `rule for "${winner.entry.id}" claims it first (${describeCondition(
              winner.entry,
            )} matches the phrase) — the first matching rule in declaration order wins the ` +
            `turn start, so that message starts on "${winner.entry.id}", never on ` +
            `"${entry.id}". Reorder the rules (declare "${entry.id}" before ` +
            `"${winner.entry.id}"), or narrow "${winner.entry.id}"'s matcher so it stops ` +
            `claiming this phrasing. (Proved by running BOTH compiled matchers on the ` +
            `phrase — no regex intersection was decided.)`,
          skill: entry.id,
          from: winner.entry.id,
          to: entry.id,
          example: phrase,
        });
        continue;
      }

      // The claimant is UNCONDITIONAL — the ONE place the two start laws differ
      // (only the cold walk lets a default claim). `hasClassifier` cannot be
      // true here: the cascade set carries conditional entries only. So the
      // OTHER law is consulted now, and both readings are reported.
      const byRules = claimUnderCascade(phrase);
      if (byRules !== undefined && byRules.index < index) {
        // Both laws still agree on the OUTCOME the author cares about — the
        // turn does not start on this rule — so the ERROR stands, and the
        // message names each law's claimant rather than one of them. `from`
        // carries the default mount's claimant (the reading a graph gets when
        // nothing else is configured); the message names the other in full.
        problems.push({
          kind: 'error',
          code: 'example-shadowed-by-earlier',
          message:
            `Start rule for "${entry.id}" declares the example "${phrase}", but an earlier ` +
            `entry claims it under BOTH start laws, so that message never starts on ` +
            `"${entry.id}". Mounted the default way (continuity: 'turn'), the ` +
            `declaration-order cold start stops at "${winner.entry.id}", which ` +
            `${describeCondition(winner.entry)}. Mounted with a classifier or with ` +
            `continuity: 'conversation', the turn-start cascade reads the conditional rules ` +
            `only, and "${byRules.entry.id}" claims it first ` +
            `(${describeCondition(byRules.entry)} matches the phrase). Declare "${entry.id}" ` +
            `before both, or narrow "${byRules.entry.id}"'s matcher and give ` +
            `"${winner.entry.id}" a condition (or declare it last — a default entry belongs ` +
            `after the rules it must not swallow). (Proved by running the declared conditions ` +
            `on the phrase in declaration order, under both laws — no regex intersection was ` +
            `decided.)`,
          skill: entry.id,
          from: winner.entry.id,
          to: entry.id,
          example: phrase,
        });
        continue;
      }

      // (b′) SHADOWED-BY-DEFAULT — the laws DISAGREE, and which one applies is
      //      decided at AGENT MOUNT (`continuity`), not in this graph. WARNING,
      //      naming both readings: asserting either as an error would put the
      //      check-up in disagreement with the router it claims to describe —
      //      the cascade really does start that turn on this rule.
      problems.push({
        kind: 'warning',
        code: 'example-shadowed-by-default',
        message:
          `Start rule for "${entry.id}" declares the example "${phrase}", and which entry ` +
          `claims it depends on how this graph is MOUNTED — the graph alone cannot decide it, ` +
          `so this is a warning, not an error. The earlier entry "${winner.entry.id}" declares ` +
          `no \`match\` and no \`when\`, so under the declaration-order cold start (the ` +
          `default mount, continuity: 'turn') it claims every message from its position ` +
          `onward and that turn starts on "${winner.entry.id}". Mounted with a classifier or ` +
          `with continuity: 'conversation', the turn-start cascade's tier 1 reads the ` +
          `CONDITIONAL rules only — an unconditional entry is a default, not a rule — so ` +
          `"${winner.entry.id}" is skipped and the turn starts on ${
            byRules === undefined
              ? 'no entry at all, falling onward to the next tier'
              : `"${byRules.entry.id}"`
          }. Make the two readings agree: declare "${entry.id}" before ` +
          `"${winner.entry.id}", give "${winner.entry.id}" a \`match\`/\`when\`, or declare ` +
          `it last (a default entry belongs after the rules) — an always-on procedure beside ` +
          `the graph is what .steering(...) / .skill(...) are for. (Proved by running the ` +
          `declared conditions on the phrase in declaration order under both laws; ` +
          `"${winner.entry.id}" declares none, so the cold walk stops there by construction.)`,
        skill: entry.id,
        from: winner.entry.id,
        to: entry.id,
        example: phrase,
      });
    }
  }

  return {
    problems,
    notes: orderDecides ? [EXAMPLES_BOUNDARY] : [EXAMPLES_ORDER_NOT_CHECKED, EXAMPLES_BOUNDARY],
  };
}

/**
 * Run one entry's condition over one phrase, on a COLD-START context — the
 * context a turn's first iteration really hands a start rule: iteration 1, the
 * phrase as `userMessage`, no history, no cursor, no tool results. A throw is
 * reported as `'threw'` and treated as a no-match by every caller, which is
 * exactly what the cursor resolver does with it at run time (so a claim made
 * here stays true of the run).
 *
 * An entry with NO condition matches everything: that is the cold walk's law
 * (`if (!e.when) return { to: e.id }`), not a shortcut.
 */
function runsOn(entry: ExampleRuleDecl, phrase: string): 'match' | 'no-match' | 'threw' {
  if (entry.when === undefined) return 'match';
  try {
    return entry.when(coldContext(phrase)) ? 'match' : 'no-match';
  } catch {
    return 'threw';
  }
}

function coldContext(userMessage: string): InjectionContext {
  return { iteration: 1, userMessage, history: [], activatedInjectionIds: [] };
}

/** The one context every predicate here is judged on, spelled out for the
 *  reader of a message — a check that names its own inputs can be argued with;
 *  one that hides them can only be guessed at. Kept as ONE string so every
 *  message describes the SAME context {@link coldContext} really builds. */
const COLD_CONTEXT_PHRASE =
  'a COLD-START context (iteration 1, the phrase as `userMessage`, empty `history`, no ' +
  'cursor and no activated injections)';

/** One claimant of a phrase: the entry, and its position in declaration order. */
interface Claim {
  readonly entry: ExampleRuleDecl;
  readonly index: number;
}

/** The `example-misses-own-rule` sentence. Two readings, and the message says
 *  which one it is: a data matcher's no-match holds under every context, an
 *  opaque `when`'s holds only under the context it was run on. */
function selfMissMessage(
  entry: ExampleRuleDecl,
  phrase: string,
  own: 'no-match' | 'threw',
): string {
  const head = `Start rule for "${entry.id}" declares the example "${phrase}", but `;
  if (own === 'threw') {
    return (
      `${head}${describeCondition(entry)} THREW when run on ${COLD_CONTEXT_PHRASE} — a ` +
      `predicate must be pure and total, and a turn's first iteration really hands it that ` +
      `context, so it throws in production too. Routing treats a throw as no-match (this ` +
      `check does the same), so the rule cannot claim the phrasing it says it claims. Make ` +
      `the predicate total (guard the fields it reads), or move the example to the rule that ` +
      `really claims the phrase. (Proved by running this rule's own predicate on that context.)`
    );
  }
  if (entry.match !== undefined) {
    return (
      `${head}${describeCondition(entry)} does not match it — so the rule cannot claim the ` +
      `phrasing it says it claims. Fix the matcher so it covers the phrase, or move the ` +
      `example to the rule that really claims it. (Proved by running this rule's own compiled ` +
      `matcher on the phrase: a data matcher reads the user message and nothing else, so no ` +
      `conversation state makes it true later.)`
    );
  }
  return (
    `${head}${describeCondition(entry)} returned false when run on ${COLD_CONTEXT_PHRASE} — the ` +
    `context a turn's FIRST iteration hands a start rule. A \`when\` predicate is opaque code ` +
    `and may legitimately be gated on conversation state (e.g. \`ctx.history.length > 0\`) and ` +
    `claim this phrase on a LATER turn, which this check cannot run — that is why this is a ` +
    `warning and not the error a data matcher gets. If the rule is meant to claim the phrase ` +
    `at the START of a turn, fix the predicate; if it is gated on conversation state, move the ` +
    `example to the rule that claims the phrase cold — a rule-level \`examples\` list is only ` +
    `ever run on the context named above. (Proved by running this rule's own predicate on it.)`
  );
}

/** How a rule's condition is named in a message: the data matcher quoted back,
 *  the honest word for opaque code — or, for an entry that declares neither,
 *  what having no condition MEANS. Naming a `when` predicate an unconditional
 *  entry does not have is how a report describes a graph nobody wrote. */
function describeCondition(entry: ExampleRuleDecl): string {
  if (entry.match !== undefined) return `its matcher \`${plainMatchCaption(entry.match)}\``;
  return entry.when === undefined
    ? 'declares no `match` and no `when`, so it claims every message'
    : 'its `when` predicate';
}
