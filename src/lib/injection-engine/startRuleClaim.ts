/**
 * startRuleClaim — WHO CLAIMS A PHRASE. The one place that answers it.
 *
 * Two check-ups ask the same question of a graph's start rules and want
 * opposite answers:
 *
 *   • `skillExamples.ts` declares a phrase and asserts THIS rule claims it;
 *   • `skillNeverRoutes.ts` declares a phrase and asserts NO rule claims it.
 *
 * The question underneath is identical — run the compiled conditions over one
 * concrete phrase, on the context a turn's first iteration really hands a start
 * rule, and see who says yes. Two copies of that would drift the moment one of
 * them learned something about the router the other did not, and the two would
 * then disagree about the same graph. So it lives here, once, and the modules
 * that report keep only their own sentences.
 *
 * Nothing here decides SEVERITY or writes a message — that is the reporting
 * module's job, because the same "no" means different things to a positive and
 * a negative assertion. This module only runs predicates and names conditions.
 *
 * Zone: PURE CORE (no engine, no loop). Pinned by
 * `test/lib/injection-engine/skill-graph-fence.test.ts`.
 */

import type { InjectionContext } from './types.js';
import { plainMatchCaption, type SkillMatchData } from './skillMatch.js';

/**
 * The slice of an entry declaration a claim question reads — structural, so
 * `skillGraph.ts`'s module-private `EntryDecl` satisfies it unchanged (the same
 * trick `skillIntent.ts` uses).
 */
export interface StartRuleDecl {
  readonly id: string;
  /** The compiled condition (from `match:`) or the author's `when`. Absent on
   *  an unconditional entry and on an intent rule (no sync predicate). */
  readonly when?: (ctx: InjectionContext) => boolean;
  /** The serializable matcher behind `when`, when declared as data — quoted
   *  back in the messages, and the one way to spot the intent arm. */
  readonly match?: SkillMatchData;
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
export function runsOn(entry: StartRuleDecl, phrase: string): 'match' | 'no-match' | 'threw' {
  if (entry.when === undefined) return 'match';
  try {
    return entry.when(coldContext(phrase)) ? 'match' : 'no-match';
  } catch {
    return 'threw';
  }
}

/** The one context every predicate in a phrase check is judged on. */
export function coldContext(userMessage: string): InjectionContext {
  return { iteration: 1, userMessage, history: [], activatedInjectionIds: [] };
}

/** The one context every predicate here is judged on, spelled out for the
 *  reader of a message — a check that names its own inputs can be argued with;
 *  one that hides them can only be guessed at. Kept as ONE string so every
 *  message describes the SAME context {@link coldContext} really builds. */
export const COLD_CONTEXT_PHRASE =
  'a COLD-START context (iteration 1, the phrase as `userMessage`, empty `history`, no ' +
  'cursor and no activated injections)';

/** One claimant of a phrase: the entry, and its position in declaration order.
 *  (Named Claimant since 9.58.0 — `Claim<T>` on the `/maps` door is the
 *  honesty primitive, a different thing; one name, one meaning.) */
export interface Claimant {
  readonly entry: StartRuleDecl;
  readonly index: number;
}

/** How a rule's condition is named in a message: the data matcher quoted back,
 *  the honest word for opaque code — or, for an entry that declares neither,
 *  what having no condition MEANS. Naming a `when` predicate an unconditional
 *  entry does not have is how a report describes a graph nobody wrote. */
export function describeCondition(entry: StartRuleDecl): string {
  if (entry.match !== undefined) return `its matcher \`${plainMatchCaption(entry.match)}\``;
  return entry.when === undefined
    ? 'declares no `match` and no `when`, so it claims every message'
    : 'its `when` predicate';
}

/**
 * The two claimant sets, mirroring the TWO start laws (see `skillExamples.ts`'s
 * header for the whole statement) rather than re-inventing either:
 *
 *   • COLD WALK (`makeResolveCursor`, the default mount): every non-intent
 *     entry, unconditional ones included — they claim everything from their
 *     position onward.
 *   • CASCADE tier 1 (`firstRuleMatch`, mounted by `.classify()` OR by
 *     `continuity: 'conversation'`): the CONDITIONAL non-intent entries only —
 *     an unconditional entry is a default, not a rule.
 *
 * Intent entries appear in NEITHER: they compile to no sync predicate at all,
 * and the classifier judges them at run time with a scorer this pass does not
 * run.
 */
export interface ClaimLaws {
  /** First claimant under the declaration-order cold walk, or undefined. */
  readonly underColdWalk: (phrase: string) => Claimant | undefined;
  /** First claimant under the turn-start cascade's tier 1, or undefined. */
  readonly underCascade: (phrase: string) => Claimant | undefined;
}

/** Build both laws' claim finders over one entry list, in declaration order. */
export function claimLaws(entries: readonly StartRuleDecl[]): ClaimLaws {
  const nonIntent = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.match?.kind !== 'intent');
  const ruleClaimants = nonIntent.filter(({ entry }) => entry.when !== undefined);
  return {
    underColdWalk: (phrase) => nonIntent.find(({ entry }) => runsOn(entry, phrase) === 'match'),
    underCascade: (phrase) => ruleClaimants.find(({ entry }) => runsOn(entry, phrase) === 'match'),
  };
}
