/**
 * skillGraph — a declarative, visualizable skill-dependency graph (proposal 002).
 *
 * The consumer declares skills + routing EDGES; `skillGraph()` compiles each edge
 * to the existing injection-engine TRIGGER on the target skill — so the dynamic,
 * token-efficient loading the engine already does becomes *declared* and *drawn*.
 *
 *   .entry(skill, { when? })              → trigger: `always` (or `rule` if when)
 *   .route(a, b, { onToolReturn | when }) → b compiles to a CURSOR-GATED `rule`
 *   (a skill with no declared incoming edge keeps its default `llm-activated`
 *    trigger — still reachable via `read_skill`, drawn as a dashed "model" edge)
 *
 * **v2 keystone — `from` IS enforced (a sticky cursor state machine).** A skill
 * graph is a state machine over skills; the engine tracks which node it is in via
 * `InjectionContext.currentSkillId` (the cursor). One pure resolver — `resolveCursor`
 * (see `makeResolveCursor`), of which `nextSkill(ctx)` is the `.to` projection — is the
 * single source of truth: each route target B
 * compiles to the trigger `nextSkill(ctx) === B`, which delivers `from`-gating
 * (an edge `A→B` fires only while the cursor is on A — no cross-skill edge bleed),
 * stickiness (the cursor stays on B until an edge leaves B), and a clean handoff
 * (B deactivates the same iteration C activates). The Injection Engine's Evaluate
 * stage advances the cursor with the SAME ctx (`currentSkillId = nextSkill(ctx)`),
 * so the active set and the persisted cursor never disagree. The DRAWN edge kind
 * (`on-tool-return` vs `predicate`) is preserved for rendering even though the
 * compiled trigger is always a `rule`. `toMermaid()` renders declared === drawn.
 *
 * A decision `tree()` routes per-iteration by stable `ctx` predicates (no cursor)
 * and is unaffected by `from`-gating. It has no cursor for `read_skill` to move
 * either, so `reachableSkills()` is EMPTY there and the gate refuses a leaf pick
 * (8.5.0) — see `reachableSkills` for why honouring it would break three of this
 * module's own invariants.
 *
 * **One skill's turn at a time (8.15.0).** The keystone's third property — "B
 * deactivates the same iteration C activates" — now holds for EVERY node in a flat
 * graph, including an entry that carries a `when`. Such an entry used to compile to
 * `when(ctx) || cursor === id`, and the leftover rule clause meant an entry that
 * routed onward stayed loaded beside its own successor, on that iteration and every
 * one after it. A conditional entry is active exactly while the cursor is on it;
 * `when` decides where a turn STARTS. The one declared way to be co-active beside
 * the cursor is an entry with no `when` at all (`{ kind: 'always' }`), which is
 * untouched. A rule that matched while the cursor was elsewhere is reported, not
 * swallowed — see `supersededEntries`.
 *
 * **The model moves too (`read_skill`).** Scoped `read_skill` bounds the model to
 * `reachableSkills(cursor)` — the declared successors of where it stands, plus the
 * entries. A pick the gate ACCEPTS moves the cursor exactly like a declared edge
 * does (`ctx.pendingSkillPick`, honoured in `makeResolveCursor`), so what the gate
 * allows and what actually takes effect are the same set. A declared edge that
 * fires the same turn wins (`D1 > D2`, docs/design/skill-graph.md §4A.1) and the
 * run emits `agentfootprint.skill.reroute_superseded` rather than leaving the
 * model's answered-"activated" claim quietly unmet.
 *
 * **The resolver says WHY, it is not asked to be guessed.** `explainNextSkill(ctx)`
 * returns the destination AND the winning clause (`CursorMove`), decided at the same
 * `return`. The agent stamps it on `context.evaluated` as `cursorMove`, which is how
 * `routeRecorder()` can tell a model pick from a declared edge that happens to point
 * at the same skill (8.5.0 — before, the drawn build-time provenance was read as the
 * per-hop cause, so a model pick was recorded under a declared edge's label).
 */

import { devWarn } from './devWarn.js';
import './types.js';
import type { Injection, InjectionContext } from './types.js';
import type { EntryScorer, EntryScoring, EntryScore } from './entryScorer.js';
import { embeddingScorer } from './entryScorer.js';
import type { GraphProblem, GraphCheckup, CheckupTriggerKind } from './skillGraphCheckup.js';
import { formatCheckup, checkupGraph } from './skillGraphCheckup.js';
import { checkSkillContracts } from './skillContract.js';
import { checkArtifactVocabularies } from './skillVocabulary.js';
import { validateStartRuleExamples, checkStartRuleExamples } from './skillExamples.js';
import { validateNeverRoutes, neverRouteKey, checkNeverRoutes } from './skillNeverRoutes.js';
import { checkPartition } from './skillPartition.js';
import { checkEntryEvidence } from './skillEntryEvidence.js';
import { compileMatch } from './skillMatch.js';
import { compileGuard, plainGuardCaption } from './skillGuard.js';
import type { IntentScorer } from './intentScorer.js';
import type { RoutingPolicy } from './routingPolicy.js';
import { resolveRoutingPolicy } from './routingPolicy.js';
import {
  findDuplicateIntentExamples,
  buildTurnRoutingPlan,
  runCheckupIntents,
} from './skillIntent.js';
import type { TurnRoutingPlan } from './skillIntent.js';
import type {
  SkillGraphBuilder,
  SkillGraphConfig,
  SkillGraph,
  BuildOptions,
  CheckupOptions,
  DeferredBodyContract,
} from './skillGraph/graphContracts.js';
import type {
  EntryDecl,
  RouteDecl,
  SkillNode,
  SkillEdge,
  SkillEdgeKind,
} from './skillGraph/graphRoutes.js';
import type { DecisionNode } from './skillGraph/decision.js';
import {
  describe,
  statusesOf,
  plural,
  isDeterministicRoute,
} from './skillGraph/routePredicates.js';
import type { CursorMove } from './skillGraph/graphCursor.js';
import { compileTree, attachExactlyOneLeafMonitor } from './skillGraph/treeCompilation.js';
import { makeResolveCursor } from './skillGraph/cursorResolution.js';
import { memoizePerPass } from './skillGraph/passMemo.js';
import { makeReachableSkills } from './skillGraph/reachability.js';
import { makeSupersededEntries } from './skillGraph/entrySuppression.js';
import { makeScoreEntries } from './skillGraph/entryScores.js';
import { deriveTrigger } from './skillGraph/triggerCompilation.js';
import { routingFor } from './skillGraph/routingView.js';
import {
  SKILL_GRAPH_METADATA_KEY,
  SKILL_GRAPH_DEFERRED_CONTRACT_KEY,
} from './skillGraph/graphContracts.js';
import { renderMermaid } from './skillGraph/graphDrawing.js';

export { formatCheckup } from './skillGraphCheckup.js';

export type { GraphCheckup, GraphProblem, GraphProblemCode } from './skillGraphCheckup.js';

// The data-matcher domain (`match:` on start rules) — one module owns the type,
// the compiler, the comparator and the caption; see ./skillMatch.ts.
export type { SkillMatch, SkillMatchData, RouteWitness } from './skillMatch.js';

// The data-guard domain (`guard:` on route edges, 9.51.0) — one module owns the
// type, the compiler, the evidence shape and the caption; see ./skillGuard.ts.
export {
  GUARD_HOP_KEYS,
  plainGuardCaption,
  type GuardConditionData,
  type GuardConditionEvidence,
  type GuardOperator,
  type GuardValue,
  type SkillGuard,
  type SkillGuardData,
  type SkillGuardOps,
} from './skillGuard.js';

// The turn-routing surfaces the graph exposes (SG-C) — the plan the agent's
// RouteTurn stage consumes, and the verdict POJO the resolver reads.
export type { TurnRoutingPlan } from './skillIntent.js';

export type { TurnRoute } from './routingPolicy.js';

// `EntryScore` / `EntryScoring` are owned by ./entryScorer.ts now (the scorer
// strategy produces them). Re-exported here so existing `from './skillGraph.js'`
// imports keep working.
export type { EntryScore, EntryScoring };

export type { SkillGraphStart, SkillGraphStep } from './skillGraph/graphConfig.js';

export type {
  SkillStartRule,
  SkillRouteOptions,
  SkillEntryOptions,
  SkillEdgeKind,
  SkillEdge,
  SkillNode,
  SkillRoutingStep,
  SkillRouting,
} from './skillGraph/graphRoutes.js';

export type {
  CursorMoveCause,
  RouteBatchOutcome,
  RouteBatchConflict,
  GuardEvaluation,
  CursorMove,
} from './skillGraph/graphCursor.js';

export {
  SKILL_GRAPH_METADATA_KEY,
  SKILL_GRAPH_DEFERRED_CONTRACT_KEY,
} from './skillGraph/graphContracts.js';

export type {
  GraphCheckMode,
  BuildOptions,
  CheckupOptions,
  SkillGraphFlatConfig,
  SkillGraphTreeConfig,
  SkillGraphConfig,
  TreeOptions,
  DeferredBodyContract,
  SkillGraph,
  SkillGraphBuilder,
  SkillMap,
} from './skillGraph/graphContracts.js';

export { decideSkill } from './skillGraph/decision.js';

export type { DecisionNode } from './skillGraph/decision.js';

export { classifySkillTarget } from './skillGraph/reachability.js';

export type { SkillTargetClass } from './skillGraph/reachability.js';

export function skillGraph(): SkillGraphBuilder;

export function skillGraph(config: SkillGraphConfig): SkillGraph;

export function skillGraph(config?: SkillGraphConfig): SkillGraphBuilder | SkillGraph {
  const skillsById = new Map<string, Injection>();
  const entries: EntryDecl[] = [];
  const routes: RouteDecl[] = [];
  let treeRoot: DecisionNode | Injection | undefined;
  let treeScopeTools = true;
  let entryScorer: EntryScorer | undefined;
  let entryByReadFlag = false;
  let classifyScorer: IntentScorer | undefined;
  let classifyPolicy: Partial<RoutingPolicy> | undefined;
  // The negative rows, in declaration order. A graph that never calls
  // `.neverRoutes()` keeps an empty array and pays one length check at
  // check-up time — zero cost when unused.
  const neverRoutePhrases: string[] = [];

  /**
   * Register a skill under its id, refusing a second DIFFERENT skill under an id
   * already taken (8.4.0). Until then this was a bare `Map.set` — last write won,
   * silently, and the loser vanished from the compiled graph entirely: the flat
   * form kept the LAST body under the FIRST declaration's routing, the config form
   * dropped the first skill outright, and a tree kept the FIRST body and discarded
   * the second. `skillsFromDir` has always refused a collision inside its own
   * directory and `Agent.injection()` has always refused one on the agent, so the
   * graph was the only place in the library where two skills could quietly claim
   * one id — the id `read_skill` dispatches by and every edge routes by.
   *
   * Identity-based, deliberately: re-registering the SAME object is how the fluent
   * form works (`.entry(a).route(a, b)` remembers `a` twice) and how one skill sits
   * at two tree leaves (the compiler merges those into one ORed trigger).
   */
  const remember = (skill: Injection): string => {
    if (skill.flavor !== 'skill') {
      throw new Error(`skillGraph: "${skill.id}" is not a skill (flavor='${skill.flavor}').`);
    }
    const claimed = skillsById.get(skill.id);
    if (claimed && claimed !== skill) {
      throw new Error(
        `skillGraph: two different skills claim the id "${skill.id}" — ` +
          `"${describe(claimed)}" and "${describe(skill)}". Skill ids must be unique ` +
          `(read_skill dispatches by id, and every edge routes by id); rename one, or ` +
          `pass the SAME skill object to both places.`,
      );
    }
    skillsById.set(skill.id, skill);
    return skill.id;
  };

  const builder: SkillGraphBuilder = {
    entry(skill, opts) {
      const id = remember(skill);
      // Exactly one condition per entry: `match` (data) or `when` (code). Both set
      // is a contradiction — which one starts the turn? — refused rather than
      // silently ANDed or ORed. (Neither set stays the `always` entry it has
      // always been; the rules form additionally refuses "neither", because a
      // rule exists to be conditional — see the config translation below.)
      if (opts?.when !== undefined && opts?.match !== undefined) {
        throw new Error(
          `skillGraph: entry "${id}" sets both \`match\` and \`when\` — an entry takes ` +
            `exactly one condition. Use \`match\` (a RegExp, { keywords: [...] } or ` +
            `{ all: [...] } over the user message — comparable and drawable) OR \`when\` ` +
            `(a predicate over the iteration context). To combine a pattern with extra ` +
            `logic, fold the pattern into your \`when\` predicate.`,
        );
      }
      const compiled =
        opts?.match !== undefined ? compileMatch(opts.match, `entry "${id}"`) : undefined;
      // The phrasings this rule claims — validated where they are declared, so
      // an unusable list is refused at the keystroke instead of quietly proving
      // nothing at check-up time (skillExamples.ts owns every refusal).
      const examples = validateStartRuleExamples(opts?.examples, `entry "${id}"`, {
        hasCondition: opts?.when !== undefined || opts?.match !== undefined,
        isIntent: compiled?.data.kind === 'intent',
      });
      entries.push({
        id,
        when: compiled ? compiled.predicate : opts?.when,
        ...(compiled && { match: compiled.data }),
        ...(compiled?.witness && { witness: compiled.witness }),
        ...(examples && { examples }),
        label: opts?.label,
      });
      return builder;
    },
    route(from, to, opts) {
      const fromId = remember(from);
      const toId = remember(to);
      if (opts?.when && opts?.onToolReturn) {
        throw new Error(
          `skillGraph: route ${fromId}→${toId} sets both 'when' and 'onToolReturn' — pick one.`,
        );
      }
      // `when` is code, `onToolStatus` is data over the same result — both
      // set is a contradiction (which one fires the edge?). `onToolReturn`
      // COMPOSES with `onToolStatus` ("this tool, with this outcome"), so
      // that pair stays legal.
      if (opts?.when && opts?.onToolStatus) {
        throw new Error(
          `skillGraph: route ${fromId}→${toId} sets both 'when' and 'onToolStatus' — pick ` +
            `one. 'onToolStatus' is the data form (drawable, comparable); to combine a ` +
            `status with extra logic, read \`result.status\` inside your 'when' predicate.`,
        );
      }
      if (opts?.onToolStatus !== undefined && statusesOf(opts.onToolStatus).length === 0) {
        throw new Error(
          `skillGraph: route ${fromId}→${toId} sets 'onToolStatus: []' — an empty status ` +
            `set can never match, so the edge would be dead wiring. Name at least one ` +
            `status, or drop the field.`,
        );
      }
      // `when` is code, `guard` is data over the same hop — both set is a
      // contradiction (which one fires the edge?), refused exactly as
      // when+onToolStatus is. `guard` COMPOSES with onToolReturn/onToolStatus
      // ("this tool, this outcome, AND these conditions") — conditions AND
      // anyway, so the pair stays legal there.
      if (opts?.when && opts?.guard) {
        throw new Error(
          `skillGraph: route ${fromId}→${toId} sets both 'when' and 'guard' — pick one. ` +
            `'guard' is the data form (drawable, comparable, evidence-recorded); to ` +
            `combine declared conditions with extra logic, fold the checks into your ` +
            `'when' predicate.`,
        );
      }
      // ONE compilation (the compileMatch pattern): the predicate that routes,
      // the data the record carries, and the evidence evaluator — all from the
      // same conditions. Every malformed shape is refused here, by name.
      const guard =
        opts?.guard !== undefined ? compileGuard(opts.guard, `route ${fromId}→${toId}`) : undefined;
      routes.push({
        fromId,
        toId,
        when: opts?.when,
        onToolReturn: opts?.onToolReturn,
        ...(opts?.onToolStatus !== undefined && { onToolStatus: opts.onToolStatus }),
        ...(guard !== undefined && { guard }),
        label: opts?.label,
      });
      return builder;
    },
    tree(root, opts) {
      treeRoot = root;
      if (opts?.scopeTools === false) treeScopeTools = false;
      return builder;
    },
    entryBy(scorer) {
      entryScorer = scorer;
      return builder;
    },
    entryByRelevance(embedder) {
      entryScorer = embeddingScorer(embedder);
      return builder;
    },
    entryByRead() {
      entryByReadFlag = true;
      return builder;
    },
    classify(scorer, policy) {
      classifyScorer = scorer;
      classifyPolicy = policy;
      return builder;
    },
    neverRoutes(phrases) {
      // Validated at the keystroke, like a rule's `examples` — an unusable row
      // is refused where it was written instead of quietly asserting nothing at
      // check-up time. The already-declared set makes the duplicate refusal
      // work across calls, not just within one.
      neverRoutePhrases.push(
        ...validateNeverRoutes(
          phrases,
          '.neverRoutes(...)',
          new Set(neverRoutePhrases.map(neverRouteKey)),
        ),
      );
      return builder;
    },
    build(opts: BuildOptions = {}) {
      // One entry router per graph — classify is a third machine beside the
      // scorer and the model-read menu, and two of them deciding one turn
      // start would let the record and the routing disagree.
      if (classifyScorer && (entryScorer || entryByReadFlag)) {
        throw new Error(
          'skillGraph: pick ONE entry router — .classify(scorer) classifies the message ' +
            'against declared intents; .entryBy()/.entryByRelevance() rank descriptions; ' +
            '.entryByRead() lets the LLM read the menu. This graph configures more than one.',
        );
      }
      if (classifyScorer && treeRoot) {
        throw new Error(
          'skillGraph: .classify() is for flat entry/route graphs; a .tree() already routes ' +
            'by predicate on every iteration (there is no turn start for a classifier to route).',
        );
      }
      // Intent rules need their judge — an intent compiles to no message
      // predicate, so without a classifier the entry could never be chosen and
      // would silently never load. Refused with a stable code, like rule-id-exists.
      const intentEntries = entries.filter((e) => e.match?.kind === 'intent');
      if (intentEntries.length > 0 && !classifyScorer) {
        const problems: GraphProblem[] = intentEntries.map((e) => ({
          kind: 'error',
          code: 'intent-without-classify',
          message:
            `entry "${e.id}" declares match: { intent } and the graph configures no ` +
            `classifier — intent rules need one to be judged. Add ` +
            `\`classify: keywordScorer()\` (no dependency) or \`embeddingScorer(embedder)\`; ` +
            `\`llmClassifier(provider)\` if you want the model to judge.`,
          skill: e.id,
        }));
        throw new Error(
          `skillGraph: build-time check-up failed:\n${formatCheckup({ ok: false, problems })}`,
        );
      }
      if (entryByReadFlag && entryScorer) {
        throw new Error(
          'skillGraph: pick one of .entryByRead() or .entryBy()/.entryByRelevance() — not ' +
            'both (the LLM reads the menu, OR a scorer ranks it).',
        );
      }
      if (entryByReadFlag && treeRoot) {
        throw new Error(
          'skillGraph: .entryByRead() is for flat entry/route graphs; a .tree() already ' +
            'routes by predicate (no entry menu).',
        );
      }
      if (entryScorer && treeRoot) {
        throw new Error(
          'skillGraph: .entryBy()/.entryByRelevance() is for flat entry/route graphs; a ' +
            '.tree() already routes by predicate (the scorer would be ignored).',
        );
      }
      // One dial, one home: a tree declares tool scoping on `.tree(root, { scopeTools })`
      // (object form: the tree arm's own field). Accepting it here too would let the two
      // homes disagree, and only one of them would win — silently.
      if (treeRoot && opts.scopeTools !== undefined) {
        throw new Error(
          "skillGraph: `scopeTools` on build() is the FLAT arm's dial. This graph is a " +
            '.tree(), which declares tool scoping on .tree(root, { scopeTools }) (object ' +
            "form: the tree arm's own `scopeTools` field) — set it there instead.",
        );
      }
      // A negative row is judged against the START RULES, and a `.tree()` has
      // none — it routes by predicate on every iteration, with no turn start to
      // claim or decline a phrase. Accepting the rows here would run them
      // against an empty rule set and report a clean pass, which is the one
      // answer a negative assertion must never give by construction.
      if (treeRoot && neverRoutePhrases.length > 0) {
        throw new Error(
          `skillGraph: .neverRoutes(...) declares ${plural(
            neverRoutePhrases.length,
            'phrase',
            'phrases',
          )} that must claim no skill, but this graph is a .tree() — which routes by predicate ` +
            'on every iteration and has no start rules for a phrase to be judged against, so ' +
            'the rows would pass in silence and you would read that as proof. Assert them on ' +
            'a flat entry/route graph, or test the tree by running its predicates directly.',
        );
      }
      // A tree and the flat entry/route wiring are two ways to declare the same
      // thing, and only ONE of them compiles: the tree branch below never reads
      // `entries` or `routes`. Until 8.4.0 that was silent — the tree won and every
      // declared entry and route was dropped without a word, `checkup()` answered
      // `{ ok: true, problems: [] }` because its tree arm short-circuits, and the
      // author's flat wiring simply never existed at runtime.
      if (treeRoot && (entries.length > 0 || routes.length > 0)) {
        const dropped = [
          ...(entries.length > 0 ? [plural(entries.length, 'entry', 'entries')] : []),
          ...(routes.length > 0 ? [plural(routes.length, 'route', 'routes')] : []),
        ].join(' and ');
        throw new Error(
          'skillGraph: .tree() and .entry()/.route() both declare the routing and only one ' +
            `can compile — the tree wins, so the ${dropped} declared here would be silently ` +
            'dropped. tree() owns the graph: remove the .entry()/.route() calls, or drop ' +
            '.tree() and route with the flat entry/route form.',
        );
      }
      const skills: Injection[] = [];
      const nodes: SkillNode[] = [];
      const edges: SkillEdge[] = [];

      // The build-time check-up — pure over the declared entries/routes/skills,
      // PLUS the proposal-009 Tier-1 skill-body ↔ tool-contract checks (warnings).
      //
      // `triggerKinds` reads the COMPILED `skills` array (filled below, before any
      // caller can reach this closure) rather than the declaration, because that is
      // where the truth is: `deriveTrigger` returns null for an unwired skill, so the
      // skill keeps whatever trigger it arrived with — and `unreachable-skill`'s
      // sentence about read_skill is only true for `llm-activated`.
      const checkup = (options: CheckupOptions = {}): GraphCheckup => {
        const wiring = checkupGraph({
          skillIds: new Set(skillsById.keys()),
          // `conditional` counts a data `match` exactly like a `when` (it compiled
          // to one — an INTENT match compiles to no predicate but is judged by the
          // classifier, which is still a condition), so a rule-router built from
          // matchers is never read as a fan-out. The match DATA rides along so the
          // pairwise rule checks (`overlapping-rules` / `rules-shadowed-by-order`)
          // have something they can honestly compare.
          entries: entries.map((e) => ({
            id: e.id,
            conditional: e.when !== undefined || e.match?.kind === 'intent',
            ...(e.match && { match: e.match }),
          })),
          // A guard rides as DATA so the check-up can prove contradictions
          // (`guard-unsatisfiable`) — beside the only preconditions that are
          // provably comparable: an exact-string onToolReturn (a RegExp is not
          // decided) and the declared status set.
          routes: routes.map((r) => ({
            fromId: r.fromId,
            toId: r.toId,
            deterministic: isDeterministicRoute(r),
            ...(r.guard !== undefined && { guard: r.guard.data }),
            ...(typeof r.onToolReturn === 'string' && { onToolReturnExact: r.onToolReturn }),
            ...(r.onToolStatus !== undefined && {
              onToolStatuses: statusesOf(r.onToolStatus),
            }),
          })),
          isTree: treeRoot !== undefined,
          exclusiveEntries:
            entryScorer !== undefined || entryByReadFlag || classifyScorer !== undefined,
          triggerKinds: new Map(
            skills.map((s) => [s.id, s.trigger.kind as CheckupTriggerKind] as const),
          ),
          hasClassifier: classifyScorer !== undefined,
        });
        const contract = checkSkillContracts([...skillsById.values()], {
          ...(options.knownTools && { knownTools: options.knownTools }),
        });
        // The one PROVABLE intent-pair fact (SG-C) — the same example under two
        // intents. Composed here like the contract checks; the scorer-dependent
        // audit is the ASYNC `checkupIntents()`.
        const intentDuplicates = findDuplicateIntentExamples(entries);
        // The artifact vocabularies (SG-F, 9.25.0). Composed here like the
        // contract checks and NOT deferred: unlike a tool name, a `produces`
        // declaration cannot arrive later from `.tool()` — it is written on a
        // skill, and every skill of this graph is already in hand. Returns []
        // the moment nothing declares a vocabulary, so a graph that never
        // heard of the feature pays one `Array.some`.
        const vocabularies = checkArtifactVocabularies([...skillsById.values()]);
        // The declared phrasings (SG-G) — the three properties a witness phrase
        // makes provable. `orderDecides` is the SAME gate the pairwise rule
        // checks use: declaration order decides the turn start under the default
        // form and under a classifier's tier 1, and does not under a scorer /
        // `.entryByRead()` — where only the order-independent property is
        // claimed, and a note says which one was skipped. Returns frozen empties
        // the moment no rule declared examples, so a graph that never heard of
        // the feature pays one `Array.some` and reports the identical object.
        const examples = checkStartRuleExamples({
          entries,
          orderDecides:
            !(entryScorer !== undefined || entryByReadFlag) || classifyScorer !== undefined,
          hasClassifier: classifyScorer !== undefined,
        });
        // The NEGATIVE rows — phrases this graph claims NOWHERE. No
        // `orderDecides` gate: "nobody claims it" is an assertion every rule
        // has to satisfy, so the order they are read in cannot change the
        // answer (skillNeverRoutes.ts's header has the whole argument).
        const negatives = checkNeverRoutes({ entries, phrases: neverRoutePhrases });
        // The PARTITION advisories — how this graph cut the world into skills,
        // read from names and structure alone. Warnings, always: every signal
        // has a legitimate design behind it, and each message says which.
        const partition = checkPartition({
          skills: [...skillsById.values()],
          routeCount: routes.length,
          entryCount: entries.length,
          isTree: treeRoot !== undefined,
        });
        // The entry-evidence rows (9.58.0) — the two ONE-ROW facts about
        // guessed entries (skillEntryEvidence.ts has the whole argument,
        // including why the intuitive per-node exit lint is dead).
        const entryEvidence = checkEntryEvidence({
          entries: entries.map((e) => ({
            id: e.id,
            conditional: e.when !== undefined || e.match?.kind === 'intent',
            hasExamples: (e.examples?.length ?? 0) > 0,
          })),
          routeFromIds: new Set(routes.map((r) => r.fromId)),
          neverRoutesCount: neverRoutePhrases.length,
          isTree: treeRoot !== undefined,
        });
        const problems = [
          ...wiring.problems,
          ...intentDuplicates,
          ...contract,
          ...vocabularies,
          ...examples.problems,
          ...negatives.problems,
          ...partition,
          ...entryEvidence,
        ];
        // Notes are statements about the report's own REACH, and each check
        // brings its own — a graph that declared both examples and negative
        // rows carries both boundaries, in declaration order of the checks.
        const notes = [...examples.notes, ...negatives.notes];
        return {
          ok: !problems.some((p) => p.kind === 'error'),
          problems,
          ...(notes.length > 0 && { notes }),
        };
      };

      // The cursor resolver — the single source of truth for `from`-gated, sticky
      // routing. Flat mode wires it into each route target's trigger AND returns it
      // for the loop's cursor-update stage. Tree mode has no cursor (per-iteration
      // predicate routing), so it stays a no-op there.
      //
      // It resolves to a `CursorMove` — where AND by which clause — and `nextSkill`
      // is the `.to` projection of it (8.5.0). ONE resolver still: the cause is
      // decided at the same `return` that decides the destination, so an observer
      // can never disagree with the routing about why the cursor moved.
      let resolveCursor: (ctx: InjectionContext) => CursorMove = (ctx) =>
        ctx.currentSkillId === undefined
          ? { by: 'none' }
          : { from: ctx.currentSkillId, to: ctx.currentSkillId, by: 'stay' };
      // The reachable-set resolver — what `read_skill` may jump to from the cursor
      // (the runtime gate enforces it). Default empty; set per mode below.
      let reachableSkills: (currentSkillId?: string) => readonly string[] = () => [];
      // The suppression reporter (8.15.0) — conditional entries whose rule matched
      // while the cursor was elsewhere. Nothing to suppress without a cursor, so tree
      // mode and cursor-less graphs keep the empty default.
      let supersededEntries: (ctx: InjectionContext) => readonly string[] = () => [];
      // The relevance entry scorer — present only with `.entryByRelevance()` (flat).
      let scoreEntries:
        | ((ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>)
        | undefined;
      // The turn-routing plan (SG-C) — flat graphs only; a tree has no turn start.
      let turnRouting: TurnRoutingPlan | undefined;

      if (treeRoot) {
        // Decision-tree mode (v3): compile each leaf to a path-conjunction trigger.
        // Every leaf is REGISTERED as it compiles (8.4.0). Two things ride on that:
        // the duplicate-id refusal now covers leaves (before, two different skills
        // sharing an id as two leaves merged, first body wins, silently), and the
        // skill-CONTRACT checks finally run for a fluent `.tree()` graph — until
        // 8.4.0 `skillsById` stayed empty there, so `checkup()` answered
        // `{ ok: true, problems: [] }` for a tree whose body called a tool that
        // does not exist, while the byte-identical config-form graph reported it.
        compileTree(
          treeRoot,
          () => true,
          { skills, nodes, edges },
          null,
          { n: 0 },
          [],
          treeScopeTools,
          remember,
        );
        attachExactlyOneLeafMonitor(skills);
        const leafIds = skills.map((s) => s.id);
        // A tree routes to its LEAVES and to nothing else, so a skill listed in
        // `skills[]` that is not a leaf is compiled out of the graph entirely — it
        // never reaches the agent, so no trigger, no `read_skill`, no body, ever.
        // Refused by name rather than dropped (8.4.0).
        const leafSet = new Set(leafIds);
        for (const id of skillsById.keys()) {
          if (leafSet.has(id)) continue;
          throw new Error(
            `skillGraph({ tree }): skill "${id}" is listed in skills[] but is not a leaf of ` +
              'the tree, so it would never load — a tree routes only to its leaves. Add it ' +
              `to the tree as a leaf, drop it from skills[], or register it on the agent ` +
              `with .skill(${id}) to keep it read_skill-reachable.`,
          );
        }
        // Tree mode has no cursor, so `read_skill` has nothing to jump — EMPTY (8.5.0).
        //
        // Until 8.5.0 this answered `leafIds`, which made the gate accept a leaf pick
        // that could never take effect: a leaf compiles to `{ kind: 'rule', activeWhen:
        // pathCond }`, and a `read_skill` call writes only `activatedInjectionIds`,
        // which no `rule` trigger reads. The pick was accepted, the tool answered
        // "Skill 'x' activated for the next iteration", the tree re-decided by
        // predicate, and `reroute_superseded` fired naming a winner that did not exist
        // (tree mode never writes a cursor at all). Three of the library's own
        // invariants say the pick cannot be honoured here instead: exactly ONE leaf
        // fires per iteration (`attachExactlyOneLeafMonitor` warns otherwise), each
        // leaf's tools are scoped on that basis (`TreeOptions.scopeTools`), and
        // `toMermaid()` draws what is declared — a model lever over predicate routing
        // is not on the drawing. So the gate refuses, in the same terms 8.4.0 already
        // uses for every other rule-triggered skill.
        //
        // `read_skill` is not dead under a tree: the OPEN skills (anything registered
        // beside the graph — `.skill(x)`, `.skills(reg)`, `.selfExplain()`) are still
        // admitted from any cursor by the agent's gate, which is the only place that
        // knows what else is registered.
        reachableSkills = () => [];
      } else {
        // Flat entry/route mode (v1 + v2 keystone). `from`-gating + sticky cursor
        // both derive from one pure resolver so they can never diverge.
        // `.entryByRead()` makes the entries EXCLUSIVE (like `.entryByRelevance()`),
        // but the cold-start pick is the model's: no entry auto-loads — the LLM picks
        // one via `read_skill`, and that choice becomes the cursor (see
        // makeResolveCursor). `.classify()` suppresses the cold walk the SAME way:
        // the cascade decides the start (or offers a menu) — never the
        // first-declared entry by declaration-order accident. Without the
        // suppression, a 'menu' verdict would fall into the cold walk and silently
        // enter the first no-`when` entry while the record claimed a menu was
        // outstanding. This flag is only the COMPILE-TIME half: an entry-scorer
        // graph opts into the cascade at MOUNT time (`continuity:
        // 'conversation'`), which no graph build can see — there the resolver
        // suppresses the walk on the VERDICT's presence (`ctx.turnRoute`), so
        // both arms obey one law: the cascade's verdict, never the
        // declaration-order accident.
        const llmReadEntry = entryByReadFlag || classifyScorer !== undefined;
        resolveCursor = makeResolveCursor(entries, routes, llmReadEntry);
        // Triggers share ONE memoized view of the resolver per evaluation pass —
        // see memoizePerPass. The public resolvers (one call per iteration) stay raw.
        const nextSkillForTriggers = memoizePerPass(resolveCursor);
        reachableSkills = makeReachableSkills(entries, routes);
        // Exclusive entries are cursor-gated with no rule clause at all, so nothing
        // there can be superseded by one — the reporter is for the DEFAULT form.
        if (!entryScorer && !llmReadEntry) {
          supersededEntries = makeSupersededEntries(entries, resolveCursor);
        }
        if (entryScorer) scoreEntries = makeScoreEntries(entries, skillsById, entryScorer);
        // The turn-routing plan (SG-C): candidates, tier-1 rules, tie policy —
        // projected ONCE, so the router, the menu and the audit read one shape.
        turnRouting = buildTurnRoutingPlan({
          entries,
          describeFor: (id) => skillsById.get(id)?.description,
          policy: resolveRoutingPolicy(classifyPolicy),
          ...(classifyScorer && { scorer: classifyScorer }),
        });
        // `scopeTools: true` (flat) — the WIRED skills, i.e. everything an entry or a
        // route mentions. Stamped exactly as the tree stamps its leaves: a graph-level
        // DEFAULT (`existingAuto ?? …`), never an override of a skill's own declaration.
        // A listed-but-unwired skill stays additive — the graph does not route it, so
        // the graph does not scope it (it remains an OPEN, read_skill-reachable skill).
        // Default `false` preserves additive behavior; scoping stays explicit.
        const scopedIds =
          opts.scopeTools === true
            ? new Set([...entries.map((e) => e.id), ...routes.flatMap((r) => [r.fromId, r.toId])])
            : undefined;
        for (const [id, skill] of skillsById) {
          const trigger = deriveTrigger(
            id,
            skill,
            entries,
            routes,
            nextSkillForTriggers,
            entryScorer !== undefined || llmReadEntry,
          );
          const routing = routingFor(id, entries, routes);
          const existingAuto = (skill.metadata as { autoActivate?: string } | undefined)
            ?.autoActivate;
          const autoActivate = existingAuto ?? (scopedIds?.has(id) ? 'currentSkill' : undefined);
          skills.push({
            ...skill,
            ...(trigger && { trigger }),
            metadata: {
              ...skill.metadata,
              [SKILL_GRAPH_METADATA_KEY]: routing,
              ...(autoActivate && { autoActivate }),
            },
          });
          nodes.push({ id, kind: 'skill', label: id });
        }
        edges.push(
          ...entries.map(
            (e): SkillEdge => ({
              from: null,
              to: e.id,
              kind: 'entry',
              label: e.label,
              ...(e.match && { match: e.match }),
            }),
          ),
          ...routes.map((r): SkillEdge => {
            // A guard composed with onToolReturn/onToolStatus keeps that kind
            // (the guard rides beside it as data, like `match` on an entry);
            // a guard ALONE is its own kind — it is deterministic routing,
            // and calling it 'model' (no trigger) or 'predicate' (opaque
            // code) would both be false.
            const kind: SkillEdgeKind = r.onToolStatus
              ? 'on-tool-status'
              : r.onToolReturn
              ? 'on-tool-return'
              : r.guard
              ? 'guard'
              : r.when
              ? 'predicate'
              : 'model';
            // The derived caption folds the guard clause in ("… when
            // riskLevel ≥ high") wherever a tool/status part is already
            // derived here; a guard-ONLY edge stores no label and toMermaid
            // captions it from the data (the entry-`match` precedent, which
            // keeps the mermaid escaping in one place).
            const guardSuffix = r.guard ? ` when ${plainGuardCaption(r.guard.data)}` : '';
            return {
              from: r.fromId,
              to: r.toId,
              kind,
              label:
                r.label ??
                (r.onToolStatus
                  ? `on ${
                      r.onToolReturn !== undefined ? `${String(r.onToolReturn)} ` : ''
                    }status=${statusesOf(r.onToolStatus).join('|')}${guardSuffix}`
                  : r.onToolReturn
                  ? `on ${String(r.onToolReturn)}${guardSuffix}`
                  : undefined),
              ...(r.guard && { guard: r.guard.data }),
            };
          }),
        );
      }

      // Run the check-up per the `check` mode: 'throw' fails loud on an error; 'warn'
      // prints in dev mode only (quiet in prod / tests) and NEVER throws; 'off' skips.
      //
      // The default is `'throw'` since 8.7.0, matching the object-literal form. It was
      // `'warn'`, which meant a fluent graph with `no-entry` or `unknown-skill` — a
      // graph that cannot start a turn at all — built in silence outside dev mode and
      // surfaced as a run that entered no skill. An explicit `check: 'warn'` still
      // never throws, so the opt-down survives with its name intact.
      const check = opts.check ?? 'throw';
      // Without `knownTools`, the body-contract checks (`body-foreign-tool` /
      // `body-unknown-tool`) cannot tell a typo from a baseline tool the agent
      // registers later — the graph builds before `.tool()` runs. So this PASS
      // defers them (reports nothing it cannot prove) and leaves a
      // `deferredBodyContract` note in TWO places that say the same thing: on the
      // graph, and on each compiled skill's metadata — because skills reach an
      // agent through more than one door (`.skillGraph(graph)` sees the graph;
      // `.skills({ list: () => graph.skills })` sees only the skills). Agent build
      // collects the note from its final injection list and runs the checks exactly
      // once against the full tool registry, whichever door was used. With
      // `knownTools` given, the author supplied the full picture and the checks run
      // right here, as always — no note anywhere, and the agent never re-runs them
      // (one problem, one report). `graph.checkup()` is untouched either way: the
      // explicit lint call always runs every check over what it can see.
      const deferBodyContract = check !== 'off' && opts.knownTools === undefined;
      const deferredNote: DeferredBodyContract | undefined = deferBodyContract
        ? { mode: check as 'throw' | 'warn' }
        : undefined;
      if (check !== 'off') {
        const result = checkup({ ...(opts.knownTools && { knownTools: opts.knownTools }) });
        const reported = deferBodyContract
          ? {
              ok: result.ok, // body-contract problems are warnings — they never decide `ok`
              problems: result.problems.filter(
                (p) => p.code !== 'body-foreign-tool' && p.code !== 'body-unknown-tool',
              ),
              // A deferred pass filters PROBLEMS, never the report's statement
              // about its own reach — dropping the notes here would make the
              // build-time surface quieter than `graph.checkup()` about exactly
              // the thing a clean report must not be read as.
              ...(result.notes && { notes: result.notes }),
            }
          : result;
        if (check === 'throw' && !reported.ok) {
          throw new Error(`skillGraph: build-time check-up failed:\n${formatCheckup(reported)}`);
        }
        if (reported.problems.length > 0) {
          devWarn(`skillGraph: build-time check-up found problems:\n${formatCheckup(reported)}`);
        }
      }

      return {
        // Deferring? The note rides each skill too (dedup at agent build is by id,
        // so the double stamp can never double-report). No deferral → the exact
        // same objects as always: zero cost when unused.
        skills: deferredNote
          ? skills.map((s) => ({
              ...s,
              metadata: { ...s.metadata, [SKILL_GRAPH_DEFERRED_CONTRACT_KEY]: deferredNote },
            }))
          : skills,
        edges,
        nodes,
        ...(deferredNote && { deferredBodyContract: deferredNote }),
        toMermaid: () => renderMermaid(nodes, edges),
        // `nextSkill` is the `.to` PROJECTION of the one resolver, not a second
        // implementation — the two cannot answer differently.
        nextSkill: (ctx: InjectionContext) => resolveCursor(ctx).to,
        explainNextSkill: (ctx: InjectionContext) => resolveCursor(ctx),
        supersededEntries: (ctx: InjectionContext) => supersededEntries(ctx),
        reachableSkills: (currentSkillId?: string) => reachableSkills(currentSkillId),
        checkup: (options?: CheckupOptions) => checkup(options),
        ...(scoreEntries && { scoreEntries }),
        ...(turnRouting && { turnRouting }),
        ...(classifyScorer
          ? { entrySelection: 'classify' as const }
          : entryScorer
          ? { entrySelection: 'scorer' as const }
          : entryByReadFlag
          ? { entrySelection: 'model-read' as const }
          : {}),
        ...(classifyScorer && {
          checkupIntents: (signal?: AbortSignal) =>
            runCheckupIntents({
              entries,
              scorer: classifyScorer!,
              policy: resolveRoutingPolicy(classifyPolicy),
              ...(signal && { signal }),
            }),
        }),
      };
    },
  };

  // Object-literal form → translate to the fluent calls + build. Listing skills
  // independently of the wiring is what lets the check-up flag a listed-but-unwired
  // skill (every config skill is registered, even if no edge references it).
  if (config) {
    // `tree` and `start`/`steps` are two ways to declare the routing and only one
    // compiles. The TYPE already refuses the pair (SkillGraphConfig is a union with
    // `tree?: never` on the flat arm), so this is the runtime half of the same
    // refusal — for JavaScript callers and for a config assembled through `any`.
    // Until 8.4.0 `start` was skipped by an `else if` and `steps` were compiled into
    // routes the tree branch then ignored: both vanished without a word.
    const overruled = [
      ...(config.start !== undefined ? ['start'] : []),
      ...(config.steps !== undefined ? ['steps'] : []),
    ];
    if (config.tree !== undefined && overruled.length > 0) {
      const quoted = overruled.map((k) => `\`${k}\``).join(' and ');
      const one = overruled.length === 1;
      throw new Error(
        `skillGraph({ tree, ${overruled.join(', ')} }): ${quoted} declare${one ? 's' : ''} the ` +
          `routing that \`tree\` already owns, so ${one ? 'it' : 'they'} would be silently ` +
          'ignored — a tree routes by predicate on every iteration and has no entry menu ' +
          `and no cursor. Remove ${quoted}, or drop \`tree\` and route with the flat form.`,
      );
    }
    for (const s of config.skills) remember(s);
    const resolve = (id: string): Injection => {
      const s = skillsById.get(id);
      if (!s) throw new Error(`skillGraph: config references skill "${id}" not in skills[].`);
      return s;
    };
    if (config.tree) {
      // `scopeTools` reaches the compiler here since 8.7.0 — the fluent form's
      // `.tree(root, { scopeTools: false })` had no object-form twin, so this arm
      // silently forced every leaf to `autoActivate: 'currentSkill'`.
      builder.tree(config.tree, {
        ...(config.scopeTools !== undefined && { scopeTools: config.scopeTools }),
      });
    } else if (config.start !== undefined) {
      const start = config.start;
      if (typeof start === 'string') builder.entry(resolve(start));
      else if ('use' in start) builder.entry(resolve(start.use));
      else if ('rules' in start) {
        // (a) rule-id-exists — validate EVERY rule's target before compiling any of
        // them, so the refusal lists every bad id at once (not just the first) and
        // names what IS allowed. An unknown id cannot compile into an entry at all,
        // so this refuses under every `check` mode — a rule silently dropped under
        // `check: 'warn'` would be the accepted-and-silently-wrong build.
        const missing = start.rules
          .map((r, i) => ({ use: r.use, i }))
          .filter(({ use }) => !skillsById.has(use));
        if (missing.length > 0) {
          const known = [...skillsById.keys()].map((k) => `"${k}"`).join(', ');
          const problems: GraphProblem[] = missing.map(({ use, i }) => ({
            kind: 'error',
            code: 'rule-id-exists',
            message:
              `start.rules[${i}] routes to skill "${use}", which is not in skills[]. ` +
              `Known skill ids: ${known || '(none)'}. Fix the rule's \`use\`, or add the ` +
              `skill to skills[].`,
            skill: use,
          }));
          throw new Error(
            `skillGraph: build-time check-up failed:\n${formatCheckup({ ok: false, problems })}`,
          );
        }
        for (const [i, r] of start.rules.entries()) {
          // Exactly one of `match`/`when` per rule. The type already says so
          // (`SkillStartRule` is a union with `never` on the other arm); this is the
          // runtime half, for JavaScript callers and configs assembled through `any`.
          // "Neither" is refused too — a rule exists to be conditional; the
          // unconditional start is `start: 'id'` / `{ use }`, and saying so beats
          // compiling a rule that would swallow every turn.
          const use = r.use; // read before the narrowing checks — TS collapses the
          // union to `never` inside the refusal branch (the type says it can't happen;
          // this is the runtime half for callers the compiler never saw).
          const both = r.when !== undefined && r.match !== undefined;
          const neither = r.when === undefined && r.match === undefined;
          if (both || neither) {
            throw new Error(
              `skillGraph: start.rules[${i}] (use: "${use}") ${
                both ? 'sets both `match` and `when`' : 'sets neither `match` nor `when`'
              } — a rule takes exactly one condition. Say when it applies with \`match\` ` +
                `(a RegExp, { keywords: [...] } or { all: [...] } tested against the user ` +
                `message) or \`when\` (a predicate over the iteration context). For an ` +
                `unconditional start, use \`start: '${use}'\` instead of a rule.`,
            );
          }
          builder.entry(resolve(r.use), {
            ...(r.when && { when: r.when }),
            ...(r.match !== undefined && { match: r.match }),
            ...(r.examples !== undefined && { examples: r.examples }),
          });
        }
        // The classifier + its tie policy (SG-C) — the rules form is where
        // intents live, so this is where the judge is declared.
        if (start.classify) builder.classify(start.classify, start.routing);
        else if (start.routing !== undefined) {
          throw new Error(
            'skillGraph: start.routing is the tie policy of the classifier and means nothing ' +
              'without one — declare `classify` beside it (the one-dial-one-home rule: the ' +
              'policy lives where the scorer it governs is declared).',
          );
        }
      } else {
        for (const id of start.entries) builder.entry(resolve(id));
        // scoredBy (any scorer) > byRelevance (embedder sugar) > entryByRead (LLM picks).
        if (start.scoredBy) builder.entryBy(start.scoredBy);
        else if (start.byRelevance) builder.entryByRelevance(start.byRelevance);
        else builder.entryByRead();
      }
    }
    // The negative rows (graph level, like the skills list itself — a phrase
    // that must route nowhere belongs to no skill and to no `start` arm).
    // Declared BEFORE `build()` so the tree refusal fires there, in one place,
    // for both forms.
    if (config.neverRoutes !== undefined) builder.neverRoutes(config.neverRoutes);
    for (const step of config.steps ?? []) {
      builder.route(resolve(step.from), resolve(step.to), {
        ...(step.when && { when: step.when }),
        ...(step.onToolReturn && { onToolReturn: step.onToolReturn }),
        ...(step.onToolStatus !== undefined && { onToolStatus: step.onToolStatus }),
        ...(step.guard !== undefined && { guard: step.guard }),
        ...(step.label && { label: step.label }),
      });
    }
    return builder.build({
      check: config.check ?? 'throw',
      ...(config.knownTools && { knownTools: config.knownTools }),
      // The FLAT arm's tool-scoping dial rides through to the one compiler below.
      // (The tree arm's `scopeTools` was already handed to `.tree()` above — passing
      // it here too would trip build()'s one-dial-one-home refusal.)
      ...(config.tree === undefined &&
        config.scopeTools !== undefined && { scopeTools: config.scopeTools }),
    });
  }

  return builder;
}

/**
 * The official vocabulary (9.51.0): you declare the **SkillMap**; the agent
 * is the **SkillWalker**; the recording carries both.
 *
 * `defineSkillMap` is a PERMANENT thin alias of {@link skillGraph} — the same
 * function object (reference-equal), same overloads, both names exported
 * forever; neither is a rename of the other. Use whichever reads better:
 * `defineSkillMap({...})` beside `defineSkill({...})` says what you are
 * doing; `skillGraph()` says what you get.
 *
 * There is deliberately NO `SkillWalker` export. The walker is not a thing
 * you construct — it is the agent itself (`.skillGraph(map)` mounts the map;
 * the agent walks it), moving the cursor by exactly three movers, every move
 * on the record as `cursorMove`:
 *
 *   • **llm**    — the model picks via `read_skill`, bounded by the gate
 *                  (`by: 'model-pick'`; refusals are `skill.rejected`);
 *   • **guard**  — your DATA decides: a `when`/`onToolReturn`/`onToolStatus`/
 *                  `guard:` edge fires, evidence recorded (`by: 'route'`,
 *                  with `cursorMove.guard` when a data guard judged it);
 *   • **linear** — no choice: a bare hand-off that fires every time its
 *                  source finishes (an `onToolReturn` edge with one target —
 *                  the degenerate guard).
 */
export const defineSkillMap = skillGraph;
