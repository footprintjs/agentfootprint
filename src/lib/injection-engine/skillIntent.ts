/**
 * skillIntent — the intent side of the turn-start routing cascade (SG-C):
 * candidate projection, duplicate-example normalization, the graph's
 * `TurnRoutingPlan` (what the agent's RouteTurn stage consumes), and the
 * leave-one-out `checkupIntents` audit.
 *
 * One module owns how a declared `{ intent, examples }` becomes a scoreable
 * {@link IntentCandidate}, so the router, the menu, the audit and the record
 * can never project the same declaration differently. Pure over the entry
 * declarations `skillGraph.ts` hands it; imports no engine machinery beyond
 * the injection-context type.
 */

import type { InjectionContext } from './types.js';
import type { RouteWitness, SkillMatchData } from './skillMatch.js';
import type { IntentCandidate, IntentScorer } from './intentScorer.js';
import { validateIntentScores } from './intentScorer.js';
import { devWarn } from './devWarn.js';
import { decideTier2, type RoutingPolicy } from './routingPolicy.js';
import type { GraphCheckup, GraphProblem } from './skillGraphCheckup.js';

/** The slice of an entry declaration this module reads — structural, so
 *  `skillGraph.ts`'s module-private `EntryDecl` satisfies it unchanged. */
export interface IntentEntryDecl {
  readonly id: string;
  readonly when?: (ctx: InjectionContext) => boolean;
  readonly match?: SkillMatchData;
  /** The data matcher's EVIDENCE extractor (9.28.0), compiled beside `when` —
   *  called only on the rule that wins the turn. Absent for a `when` rule. */
  readonly witness?: (ctx: InjectionContext) => RouteWitness | undefined;
}

/**
 * The graph's turn-routing surface — everything the agent's RouteTurn stage
 * needs from the graph, projected ONCE at build. Present on every flat graph
 * (a decision `tree()` routes by predicate and has no turn start to route);
 * `scorer` is present only when `.classify()` / `start.classify` configured.
 */
export interface TurnRoutingPlan {
  /** The configured classifier — tier 2 over declared intents. */
  readonly scorer?: IntentScorer;
  /** The resolved tie policy the verdicts are judged under (recorded). */
  readonly policy: RoutingPolicy;
  /** Every entry id, declaration order — the `unmatched` menu. */
  readonly entryIds: readonly string[];
  /** Tier 1: the first NON-intent conditional entry whose predicate passes,
   *  declaration order — its id, plus the `witness` evidence when the rule was
   *  DATA and it yielded quotable text (9.28.0; a `when` rule has none).
   *  Unconditional entries are defaults, not rules — they never beat an
   *  inherited cursor. A throwing predicate is a no-match (dev-warned), the
   *  same law the cursor resolver applies. */
  firstRuleMatch(
    ctx: InjectionContext,
  ): { readonly id: string; readonly witness?: RouteWitness } | undefined;
  /** Tier-2 candidates: the declared intent entries, minus `exclude`. */
  intentCandidates(exclude?: ReadonlySet<string>): readonly IntentCandidate[];
  /** The incumbent as a candidate: its declared intent when it is an intent
   *  entry, else its description (never fabricated — `id` is a graph node). */
  incumbentCandidate(id: string): IntentCandidate;
}

/** Build the plan. `describeFor` resolves a skill id to its description (the
 *  incumbent's fallback intent text). */
export function buildTurnRoutingPlan(input: {
  readonly entries: readonly IntentEntryDecl[];
  readonly describeFor: (id: string) => string | undefined;
  readonly policy: RoutingPolicy;
  readonly scorer?: IntentScorer;
}): TurnRoutingPlan {
  const { entries, describeFor, policy, scorer } = input;
  const intentEntries = entries.filter((e) => e.match?.kind === 'intent');
  const ruleEntries = entries.filter((e) => e.when !== undefined && e.match?.kind !== 'intent');
  const candidateOf = (e: IntentEntryDecl): IntentCandidate => {
    const m = e.match as Extract<SkillMatchData, { kind: 'intent' }>;
    return { id: e.id, intent: m.intent, examples: m.examples };
  };
  return {
    ...(scorer && { scorer }),
    policy,
    entryIds: entries.map((e) => e.id),
    firstRuleMatch(ctx) {
      for (const e of ruleEntries) {
        try {
          if (!e.when!(ctx)) continue;
          // Evidence is extracted on the WINNER only — and a throwing extractor
          // costs the record a witness, never the turn its route.
          let witness: RouteWitness | undefined;
          try {
            witness = e.witness?.(ctx);
          } catch {
            witness = undefined;
          }
          return { id: e.id, ...(witness !== undefined && { witness }) };
        } catch (err) {
          devWarn(
            `agentfootprint skillGraph: entry "${e.id}" predicate threw during the ` +
              `turn-start cascade — treated as no-match. Predicates must be pure + total. ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return undefined;
    },
    intentCandidates(exclude) {
      const list = intentEntries.map(candidateOf);
      return exclude === undefined ? list : list.filter((c) => !exclude.has(c.id));
    },
    incumbentCandidate(id) {
      const declared = intentEntries.find((e) => e.id === id);
      if (declared) return candidateOf(declared);
      return { id, intent: describeFor(id) ?? id, examples: [] };
    },
  };
}

/** Case/whitespace-normalize an example for the duplicate check — the SAME
 *  string under two intents is scorer luck, whatever its casing. */
export function normalizeExample(example: string): string {
  return example.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The one PROVABLE intent-pair fact, decidable from the data alone: the same
 * (normalized) example declared under two intents. Whichever wins is scorer
 * luck, so it is named — both ids and the string. Everything else about two
 * example sets needs the configured scorer ({@link runCheckupIntents}).
 */
export function findDuplicateIntentExamples(
  entries: readonly IntentEntryDecl[],
): readonly GraphProblem[] {
  const seen = new Map<string, { id: string; example: string }>();
  const problems: GraphProblem[] = [];
  for (const e of entries) {
    if (e.match?.kind !== 'intent') continue;
    for (const example of e.match.examples) {
      const key = normalizeExample(example);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, { id: e.id, example });
        continue;
      }
      if (first.id === e.id) continue; // repeated inside ONE intent — harmless emphasis
      problems.push({
        kind: 'warning',
        code: 'duplicate-intent-example',
        message:
          `Intents "${first.id}" and "${e.id}" both declare the example ` +
          `"${example}" (case/whitespace-normalized). A message matching it lands on ` +
          `whichever the scorer happens to rank first — scorer luck, not a declaration. ` +
          `Move the example to the one intent it belongs to, or merge the intents.`,
        skill: e.id,
        from: first.id,
        to: e.id,
      });
    }
  }
  return problems;
}

/**
 * The leave-one-out intent audit behind `graph.checkupIntents()` — run each
 * declared example through the CONFIGURED scorer (the router that will
 * actually run; auditing with a different scorer would prove nothing about
 * production) against all intent candidates, with the example's own intent
 * represented by its REMAINING examples. An example whose top-1 is a
 * different intent, or whose top-vs-own pairwise margin is inside
 * `nearTieMargin`, is an `overlapping-intents` warning naming the example,
 * both intents, both numbers, and the fix.
 *
 * Honesty boundaries, stated in the messages: only the configured scorer's
 * view is checked; `when` predicates are opaque and never claimed checked;
 * tier-1 regex/keyword rules that fire BEFORE tier 2 are named as unaudited
 * shadowers when present. On an `llmClassifier` graph this costs one model
 * call per example — the caller's docstring says so.
 */
export async function runCheckupIntents(input: {
  readonly entries: readonly IntentEntryDecl[];
  readonly scorer: IntentScorer;
  readonly policy: RoutingPolicy;
  readonly signal?: AbortSignal;
}): Promise<GraphCheckup> {
  const { entries, scorer, policy, signal } = input;
  const intentEntries = entries.filter((e) => e.match?.kind === 'intent');
  const shadowers = entries
    .filter((e) => e.when !== undefined && e.match?.kind !== 'intent')
    .map((e) => e.id);
  const shadowClause =
    shadowers.length > 0
      ? ` (Note: tier-1 rule entries ${shadowers
          .map((id) => `"${id}"`)
          .join(', ')} fire BEFORE the classifier in declaration order and were NOT audited — ` +
        `a message they match never reaches these intents.)`
      : '';
  const problems: GraphProblem[] = [...findDuplicateIntentExamples(intentEntries)];

  for (const entry of intentEntries) {
    const m = entry.match as Extract<SkillMatchData, { kind: 'intent' }>;
    for (const [i, example] of m.examples.entries()) {
      const candidates: IntentCandidate[] = intentEntries.map((e) => {
        const em = e.match as Extract<SkillMatchData, { kind: 'intent' }>;
        return e.id === entry.id
          ? // Leave one out: the example under test must not match itself.
            { id: e.id, intent: em.intent, examples: em.examples.filter((_, j) => j !== i) }
          : { id: e.id, intent: em.intent, examples: em.examples };
      });
      const raw = await scorer.score({ message: example }, candidates, signal);
      const scores = validateIntentScores(scorer.name, candidates, raw);
      const verdict = decideTier2(scores, undefined, policy, {
        ...(scorer.floor !== undefined && { floor: scorer.floor }),
        ...(scorer.categorical !== undefined && { categorical: scorer.categorical }),
      });
      // An UNMATCHED example (nothing above the floor, its own intent
      // included) is not an overlap — under leave-one-out a two-example
      // intent whose examples share no tokens lands here routinely, and
      // reading the all-zero ranking's first row as a "winner" would name a
      // cross-match that never happened.
      if (verdict.kind === 'unmatched') continue;
      const top = verdict.ranked[0];
      if (top === undefined) continue;
      const own = verdict.ranked.find((r) => r.id === entry.id);
      if (top.id !== entry.id) {
        problems.push({
          kind: 'warning',
          code: 'overlapping-intents',
          message:
            `Example "${example}" is declared under intent "${entry.id}" but the configured ` +
            `'${scorer.name}' scorer ranks intent "${top.id}" first for it ` +
            `(${fmt(top.score)} vs own ${fmt(own?.score)}). Differentiate the examples, or ` +
            `merge the intents. (Only the configured scorer's view was checked; \`when\` ` +
            `predicates are opaque and were NOT.)${shadowClause}`,
          skill: entry.id,
          from: entry.id,
          to: top.id,
        });
      } else if (verdict.runnerUp !== undefined && verdict.runnerUp.gap < policy.nearTieMargin) {
        problems.push({
          kind: 'warning',
          code: 'overlapping-intents',
          message:
            `Example "${example}" (intent "${entry.id}") is a NEAR-TIE with intent ` +
            `"${verdict.runnerUp.id}" under the configured '${scorer.name}' scorer ` +
            `(pairwise gap ${fmt(verdict.runnerUp.gap)} < margin ${fmt(policy.nearTieMargin)}) ` +
            `— at run time this message would open a menu instead of routing. Differentiate ` +
            `the examples, or merge the intents. (Only the configured scorer's view was ` +
            `checked; \`when\` predicates are opaque and were NOT.)${shadowClause}`,
          skill: entry.id,
          from: entry.id,
          to: verdict.runnerUp.id,
        });
      }
    }
  }
  return { ok: !problems.some((p) => p.kind === 'error'), problems };
}

function fmt(n: number | undefined): string {
  return n === undefined ? '—' : Number.isFinite(n) ? n.toFixed(3) : String(n);
}
