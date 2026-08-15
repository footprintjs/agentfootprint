/**
 * skillPartition — three ADVISORY signals about the shape of the partition
 * itself: how a graph cut the world into skills.
 *
 * ## Why the partition is worth a check at all
 *
 * Everything else the check-up reports is a wiring fact — an edge to a skill
 * that is not there, a rule that can never win. The partition is upstream of
 * all of it, and it is the decision with the most leverage: a graph whose
 * skills follow SYSTEMS rather than CAPABILITIES makes one ordinary question
 * cross four skills, and the capability the user actually wanted ends up
 * implemented outside the graph, by hand, where nothing can see it. Field use
 * produced exactly that shape — nineteen skills, ONE declared edge, and tool
 * names carrying the system that owns them (`influx_*`, `pmax_*`, `pstore_*`,
 * `rvtools_*`) with the skills following the prefixes.
 *
 * The important part: all three of those are visible from NAMES AND STRUCTURE
 * ALONE, at build time, with no run and no model. So the runtime can say them.
 *
 * ## Why every one of them is an advisory, and stays one
 *
 * Each signal has a legitimate design behind it:
 *
 *   • a skill really can be one system's capability (a weather skill wrapping a
 *     weather API is not a mistake);
 *   • a deliberately FLAT menu of independent skills really does declare almost
 *     no edges — a scorer or the model picks, and there is nothing to hand off;
 *   • a one-call capability really can be one tool with a short body.
 *
 * So none of them is ever an error, and none of them says "this is wrong". Each
 * message states the SIGNAL AS A FACT the author can check against their own
 * intent — "your 19 skills declare 1 route", "every tool in `powerstore` shares
 * the prefix `pstore_`" — and then names the design each fact usually indicates
 * and the design it is also consistent with. This library's check-up teaches;
 * it does not grade.
 *
 * ## The thresholds, and why each one is where it is
 *
 * Named constants below, each with the argument beside it. They are chosen so a
 * SMALL graph is silent (small graphs have no partition problem worth naming),
 * so a trivially-true observation is never dressed up as a finding (one tool
 * shares a prefix with itself), and so the commonest honest naming convention —
 * a VERB first — never fires.
 *
 * Zone: PURE CORE. Pinned by
 * `test/lib/injection-engine/skill-graph-fence.test.ts`.
 */

import type { GraphProblem } from './skillGraphCheckup.js';
import { skillToolNames } from './skillContract.js';
import type { Injection } from './types.js';

/**
 * How many tools a skill needs before "they all share a prefix" is evidence of
 * anything. ONE tool shares a prefix with itself — a trivial truth, and the
 * skill it describes has its own signal below. TWO is two coin flips; a
 * `get_order` / `get_invoice` pair is a naming habit, not a system boundary.
 * At THREE the shared prefix is a decision somebody made about scope.
 */
const MIN_TOOLS_FOR_PREFIX = 3;

/**
 * First segments that are NOT a system — they are the verb half of the house
 * naming convention (`get_price`, `issue_refund`, `lookup_order`). Verified
 * against this repo's real tool names, where the ten commonest first segments
 * are all verbs and outnumber every system prefix put together: without this
 * list the check would fire on the best-named skills in the library, which is
 * the fastest way to teach an author to ignore a check-up.
 *
 * The test is deliberately crude — a first segment either IS one of these words
 * or it is not. A cleverer part-of-speech guess would be wrong more quietly.
 */
const VERB_PREFIXES: ReadonlySet<string> = new Set([
  'get',
  'set',
  'put',
  'post',
  'add',
  'read',
  'write',
  'list',
  'find',
  'fetch',
  'load',
  'save',
  'open',
  'close',
  'make',
  'create',
  'update',
  'delete',
  'remove',
  'search',
  'query',
  'count',
  'check',
  'verify',
  'validate',
  'run',
  'exec',
  'execute',
  'send',
  'call',
  'ask',
  'show',
  'lookup',
  'issue',
  'approve',
  'deny',
  'pay',
  'process',
  'resolve',
  'respond',
  'inspect',
  'export',
  'import',
  'start',
  'stop',
  'cancel',
  'compute',
  'calculate',
  'generate',
  'summarize',
  'transform',
]);

/**
 * The floor under ALL THREE signals: below this many skills there is no
 * partition to have an opinion about.
 *
 * This is the module's one structural decision, and it is what keeps the
 * advisories quiet by construction. Every signal here is a statement about how
 * a graph CUT THE WORLD; a two-skill graph with no edge is a menu, one skill
 * wrapping one tool is a choice about that skill, and a pair of tools sharing a
 * prefix is a naming habit. None of those become a partition question until
 * there are enough skills for the cut itself to be the design — and the field
 * case that motivated all three had nineteen. A check that fires on a
 * three-skill graph teaches an author to stop reading the check-up, which costs
 * more than the finding is worth.
 */
const MIN_SKILLS_FOR_PARTITION = 5;

/**
 * The ratio that counts as "almost no declared edges". A graph needs N−1 edges
 * to connect N skills into one routed structure; this fires below ONE EDGE PER
 * FOUR SKILLS, which is four times sparser than a bare chain — far enough from
 * the boundary that a graph tripping it is not a matter of taste. (The field
 * case: 19 skills, 1 route — a ratio of 0.05.)
 */
const MIN_ROUTES_PER_SKILL = 0.25;

/**
 * Word count below which a body carries no knowledge the tool schema does not
 * already carry. One sentence of real guidance — when to reach for this, what
 * to check first, what the failure looks like — does not fit in 25 words, so a
 * body under it is either a restatement of the tool's own description or a
 * placeholder. Counted in whitespace-separated words, the only measure that
 * means the same thing in prose as in markdown.
 */
const THIN_BODY_WORDS = 25;

/** What the partition check reads. Counts, because that is what the signals
 *  are about — no check here reasons about which edge goes where. */
export interface PartitionInput {
  /** Every skill in the graph (wired or not). */
  readonly skills: readonly Injection[];
  /** Declared routes, of any kind (a bare/model edge is still a declared
   *  handoff — the signal is about handoffs that were never written down at
   *  all, not about how deterministic they are). */
  readonly routeCount: number;
  /** Declared entries — quoted in the ratio message so the fact is complete. */
  readonly entryCount: number;
  /** A decision `tree()` owns its own routing and declares no routes by
   *  construction, so the edge-ratio signal does not apply there. */
  readonly isTree: boolean;
}

/**
 * Run the three partition signals. Pure, and cheap: one pass over the skills
 * and two integers. Every problem it produces is a WARNING.
 */
export function checkPartition(input: PartitionInput): GraphProblem[] {
  const skillCount = input.skills.length;
  // The floor, applied once for all three signals — see
  // MIN_SKILLS_FOR_PARTITION. A small graph reports byte-identically to the
  // way it did before this module existed.
  if (skillCount < MIN_SKILLS_FOR_PARTITION) return [];
  const problems: GraphProblem[] = [];

  for (const skill of input.skills) {
    const tools = skillToolNames(skill);
    const id = idOf(skill);

    // 1. tools-share-prefix — every tool in the skill comes from one system.
    //    Computed from the first `_`-delimited segment, which is where a system
    //    prefix lives when there is one (`pstore_list_volumes` → `pstore`), and
    //    silent when that segment is a verb (see VERB_PREFIXES).
    const prefix = sharedPrefix(tools);
    if (tools.length >= MIN_TOOLS_FOR_PREFIX && prefix !== undefined) {
      problems.push({
        kind: 'warning',
        code: 'tools-share-prefix',
        message:
          `Every tool in "${id}" shares the prefix \`${prefix}_\` (${tools.join(', ')}). ` +
          `A skill whose whole tool set comes from one system is usually a wrapper around ` +
          `that SYSTEM rather than a CAPABILITY — and when the skills follow the systems, one ` +
          `ordinary question crosses several of them, so the thing the user actually asked ` +
          `for gets built outside the graph where nothing can route it. Worth checking: ` +
          `could a user's question be answered by "${id}" alone, or does answering it need ` +
          `two of these skills at once? If it needs two, the capability is the skill and ` +
          `\`${prefix}_\` is just where its tools happen to come from. If "${id}" really is ` +
          `one system's capability, this is exactly right and there is nothing to fix.`,
        skill: id,
      });
    }

    // 2. skill-wraps-one-tool — one tool, and a body that adds nothing to its
    //    schema. The body is what the model reads to decide HOW to use the
    //    tool; when it is this short there is no procedure in the graph, only
    //    an endpoint with a name.
    if (tools.length === 1 && tools[0] !== undefined) {
      const words = wordCount(bodyOf(skill));
      if (words < THIN_BODY_WORDS) {
        problems.push({
          kind: 'warning',
          code: 'skill-wraps-one-tool',
          message:
            `Skill "${id}" carries one tool (\`${tools[0]}\`) and a ${words}-word body — ` +
            `under the ${THIN_BODY_WORDS} words it takes to say when to reach for it, what to ` +
            `check first, or what a bad answer looks like. A skill whose body adds nothing to ` +
            `the tool's own schema is an endpoint wrapper: the model already sees the tool, so ` +
            `the skill buys nothing but a name and an activation. Either put the knowledge in ` +
            `the body (that is the half a schema cannot carry), or drop the skill and register ` +
            `\`${tools[0]}\` on the agent directly. If it is genuinely a one-call capability ` +
            `with nothing to say about it, registering the tool is the smaller thing.`,
          skill: id,
        });
      }
    }
  }

  // 3. few-declared-edges — many skills, almost no declared handoffs. A graph
  //    level fact, reported once, and never for a tree (a tree declares its
  //    routing as the tree).
  if (!input.isTree && input.routeCount < skillCount * MIN_ROUTES_PER_SKILL) {
    problems.push({
      kind: 'warning',
      code: 'few-declared-edges',
      message:
        `This graph declares ${plural(skillCount, 'skill', 'skills')}, ${plural(
          input.entryCount,
          'entry',
          'entries',
        )} and ${plural(input.routeCount, 'route', 'routes')} — fewer than one route per four ` +
        `skills, where connecting ${skillCount} skills into one routed structure takes at ` +
        `least ${skillCount - 1}. When skills hand off to each other in PROSE ("then use the ` +
        `capacity skill"), the handoff is invisible: nothing draws it, \`checkup()\` cannot ` +
        `check it, the reachability walk cannot see it, and \`read_skill\`'s gate cannot ` +
        `offer it — the model is left to infer the sequence every turn. Declaring the ones ` +
        `you already rely on (\`.route(a, b, { onToolReturn })\`) turns each into something ` +
        `the graph can route and a reader can see. If this is a deliberately flat menu of ` +
        `independent skills — a scorer or the model picks one and it answers alone — then ` +
        `there is nothing to hand off and this is the shape you meant.`,
    });
  }

  return problems;
}

/** The id, read structurally like every other check in this family. */
function idOf(skill: Injection): string {
  return (skill as { id: string }).id;
}

/** The skill's BODY — the prose that lands in the system slot when it
 *  activates. Same accessor `skillContract.ts` reads. */
function bodyOf(skill: Injection): string {
  return (skill as { inject?: { systemPrompt?: string } }).inject?.systemPrompt ?? '';
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * The first `_`-delimited segment shared by EVERY name, or undefined when there
 * is none, when a name carries no `_` at all, or when the shared segment is a
 * verb (a convention, not a system — see {@link VERB_PREFIXES}).
 *
 * Case-folded, because a tool registry that mixes `PSTORE_get` and
 * `pstore_list` is still one system.
 */
function sharedPrefix(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined;
  let shared: string | undefined;
  for (const name of names) {
    const separator = name.indexOf('_');
    if (separator <= 0) return undefined; // no prefix segment to speak of
    const segment = name.slice(0, separator).toLowerCase();
    if (shared === undefined) shared = segment;
    else if (shared !== segment) return undefined;
  }
  return shared !== undefined && !VERB_PREFIXES.has(shared) ? shared : undefined;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
