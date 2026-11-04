import type { InjectionContext } from '../types.js';
import type { SkillMatch, SkillMatchData, RouteWitness } from '../skillMatch.js';
import type { ToolResultStatus } from '../../semantics/toolOutcome.js';
import type { SkillGuard, SkillGuardData, CompiledGuard } from '../skillGuard.js';

/**
 * One start rule: route the turn's start to `use` when the rule matches.
 * Exactly ONE of `match` (data) / `when` (code) per rule — the union enforces it
 * at the keystroke and the build refuses it for everyone else. A rule exists to
 * be conditional; for an unconditional start use `start: 'id'` / `{ use }`.
 */
export type SkillStartRule =
  | {
      readonly use: string;
      /** The code form — an opaque predicate over the iteration context. */
      readonly when: (ctx: InjectionContext) => boolean;
      readonly match?: never;
      /** The phrasings this rule claims — build-time TEST material. See
       *  {@link SkillEntryOptions.examples}. */
      readonly examples?: readonly string[];
    }
  | {
      readonly use: string;
      /** The data form — comparable, drawable, stored. See {@link SkillMatch}. */
      readonly match: SkillMatch;
      readonly when?: never;
      /** The phrasings this rule claims — build-time TEST material. See
       *  {@link SkillEntryOptions.examples}. */
      readonly examples?: readonly string[];
    };

/** Deterministic routing into a skill, keyed on the last tool result. */
export interface SkillRouteOptions {
  /** Predicate on the previous iteration's tool result → activate the target
   *  on the next iteration. The common, controllable edge. `status` is
   *  present when the tool declared one on its result envelope (9.19.0).
   *
   *  `result` is the string the MODEL read — which artifact placement can
   *  replace with a claim ticket, so an operator raising or lowering
   *  `artifacts.placement.maxInlineChars` can change whether a text-matching
   *  edge fires. See {@link InjectionContext.lastToolResult}; route on
   *  `onToolReturn` / `onToolStatus` for a guard placement cannot move. */
  readonly when?: (result: {
    readonly toolName: string;
    readonly result: string;
    readonly status?: ToolResultStatus;
  }) => boolean;
  /** Sugar for "activate whenever this tool returns (any result)". String is an
   *  exact match; RegExp is tested against the tool name. */
  readonly onToolReturn?: string | RegExp;
  /**
   * Route on the result's declared OUTCOME, not its prose (9.19.0) — the
   * data half of the outcome-status normalization: a `'denied'` call must
   * never route like a `'success'`. Matches when a tool result of the batch
   * carries one of the named statuses on its envelope; a result with NO
   * declared status can never match (an undeclared outcome is not
   * evidence). Compose with `onToolReturn` to pin the tool too ("when
   * `refund` returns `'denied'`"); alone, any tool's matching status fires.
   * Data — comparable, drawable (`toMermaid()` captions it), stored. At
   * most one of `when` / `onToolStatus`: code or data, never both.
   */
  readonly onToolStatus?: ToolResultStatus | ReadonlyArray<ToolResultStatus>;
  /**
   * The DATA form of `when` (9.51.0) — the edge's condition declared as
   * comparable, drawable, recordable conditions instead of an opaque
   * predicate: `{ key: { eq | ne | gt | gte | lt | lte | in | notIn: value } }`,
   * every condition ANDed (the operator grammar deliberately mirrors
   * footprintjs's `WhereFilter` — see {@link SkillGuard}). This is the
   * SkillWalker's guard mover as data: the map is data, entry matchers are
   * data, `onToolStatus` arms are data — the guard was the last opaque
   * function on a route edge.
   *
   * Judged per tool result of the previous iteration's batch, exactly where a
   * `when` runs. Six hop keys read the hop directly (`toolName`, `result`,
   * `status`, `iteration`, `userMessage`, `currentSkillId`); any OTHER key
   * reads the top-level field of that name from the RESULT parsed as JSON —
   * `guard: { riskLevel: { gte: 'high' } }` routes on a tool that returned
   * `{"riskLevel":"high"}`. Being data buys four things a `when` can never
   * have: the check-up proves contradictions (`guard-unsatisfiable`),
   * `toMermaid()` captions the edge ("when riskLevel ≥ high"),
   * `skill.graph_declared` carries it into every recording, and each
   * evaluation that DECIDES a hop — taken or refused — leaves per-condition
   * evidence on `cursorMove.guard` / `cursorMove.guardsClosed`.
   *
   * COMPOSES with `onToolReturn` / `onToolStatus` ("this tool, this outcome,
   * AND these conditions"). At most one of `when` / `guard`: code or data,
   * never both — to combine declared conditions with extra logic, fold the
   * checks into your `when` predicate.
   */
  readonly guard?: SkillGuard;
  /** Caption rendered on the edge. Defaults to a derived label. */
  readonly label?: string;
}

/** Where a turn starts. `when` (optional) makes entry intent-conditional. */
export interface SkillEntryOptions {
  /**
   * Which entry the turn STARTS on — a predicate over the iteration context
   * (e.g. `ctx.userMessage`). The first entry whose `when` passes wins the
   * cold-start cursor.
   *
   * **It decides the start; it does not keep the skill on the wire (8.15.0).**
   * A conditional entry is active exactly while the cursor is on it — a route out
   * of it ends its turn, and its rule cannot bring it back while the graph is
   * somewhere else. Before 8.15.0 the rule re-activated it on every iteration, so an
   * entry that routed onward stayed loaded beside its own successor.
   *
   * Omit `when` → the skill is `always` active: a persistent base procedure, on
   * beside whatever the cursor is on. That is the declared way to ask for an
   * always-on skill; `when: () => true` is NOT the same thing any more. For "on
   * whenever this matches, wherever the graph is", use the flavor built for it —
   * `.steering(...)` / `.skill(...)` with its own `rule` trigger — rather than an
   * entry, which is a position in a state machine.
   */
  readonly when?: (ctx: InjectionContext) => boolean;
  /**
   * The DATA form of `when` — a declared matcher over the user's message instead
   * of a predicate (see {@link SkillMatch}): comparable by the check-up, captioned
   * by `toMermaid()`, stored on the compiled skill's provenance. Same start
   * semantics as `when` in every other way. At most ONE of `match`/`when` — both
   * set is refused at build time. Omitting both keeps this an `always` entry,
   * exactly as before.
   */
  readonly match?: SkillMatch;
  /**
   * The phrasings this rule CLAIMS — real messages a user would type that
   * should start the turn here. Optional, additive, and **fed to nothing at
   * run time**: the check-up reads them at build time and the routing never
   * sees them, so a rule with examples routes byte-identically to the same
   * rule without them.
   *
   * Things become PROVABLE once a phrase is declared, by RUNNING the compiled
   * matchers rather than comparing them:
   *
   *   • `example-misses-own-rule` — this rule does not claim its own example.
   *     An ERROR for a data `match` (it reads the user message and nothing
   *     else, so the no-match holds under every context) or for a predicate
   *     that THREW; a WARNING for an opaque `when` that returned false, which
   *     may be gated on conversation state and claim the phrase on a later
   *     turn (see the context note below);
   *   • `example-shadowed-by-earlier` (error) — an EARLIER rule claims the
   *     phrase first, so the turn starts somewhere your own example denies.
   *     This is the one `rules-shadowed-by-order` must stay silent about when
   *     the two rules use different regexes (intersection is not decided
   *     anywhere in this library) — a witness phrase decides it instead;
   *   • `example-shadowed-by-default` (warning) — the earlier claimant is an
   *     UNCONDITIONAL entry. The declaration-order cold start stops at a
   *     default; the turn-start cascade (a classifier, or `continuity:
   *     'conversation'`) reads the conditional rules only and skips it — and
   *     which one applies is decided at AGENT MOUNT, so the report names both
   *     readings instead of asserting one against the router;
   *   • `example-unclaimed` (warning) — NO rule claims the phrase, so the turn
   *     falls through to the model tier. Absence, which no matcher-vs-matcher
   *     analysis can catch.
   *
   * **The context they are judged on.** Every condition here runs on ONE
   * context — iteration 1, the phrase as `userMessage`, empty `history`, no
   * cursor — the context a turn's FIRST iteration hands a start rule. Turn 2 of
   * a conversation also starts cold in cursor terms while CARRYING history, so
   * a `when` gated on conversation state may claim the phrase on a turn this
   * check cannot run. That is why its no-match is a warning, and why every
   * message names the context it judged under.
   *
   * **Tier difference, and it matters.** In `match: { intent, examples }`
   * (tier 2) the examples are SCORING material: the classifier reads them at
   * RUN time to judge new messages. Here (tier 1) they are TEST material only.
   * The author-facing meaning is the same — "the phrasings this rule claims" —
   * the runtime role is not, and a rule may not carry both lists (refused at
   * build, naming the difference).
   *
   * The boundary: these checks prove things about the phrases you declared and
   * nothing about phrases nobody wrote. No warning is not proof of coverage —
   * `graph.checkup().notes` says so on the report itself.
   *
   * @example
   *   .entry(arrayInventory, {
   *     match: /\b(array|volume|pool)\b/i,
   *     examples: ["what's running on shpstrprncl101"],
   *   })
   */
  readonly examples?: readonly string[];
  readonly label?: string;
}

export type SkillEdgeKind =
  | 'entry'
  | 'predicate'
  | 'on-tool-return'
  | 'on-tool-status'
  | 'guard'
  | 'model';

export interface SkillEdge {
  /** Source skill id, or `null` for the synthetic START (an entry edge). */
  readonly from: string | null;
  readonly to: string;
  readonly kind: SkillEdgeKind;
  readonly label?: string;
  /** The DATA matcher on an entry edge, when the rule was declared as data
   *  (`match:`). `toMermaid()` captions the edge with it when no explicit
   *  `label` was given. */
  readonly match?: SkillMatchData;
  /** The DATA guard on a route edge, when one was declared (9.51.0) — rides
   *  additively beside the kind exactly as `match` rides entry edges (a
   *  guard composed with `onToolReturn`/`onToolStatus` keeps that kind; a
   *  guard alone is kind `'guard'`). `toMermaid()` captions a guard-only
   *  edge with it when no explicit `label` was given, and
   *  `skill.graph_declared` carries it into every recording. */
  readonly guard?: SkillGuardData;
}

/** A node in the drawn graph — a `predicate` diamond or a `skill` box. */
export interface SkillNode {
  readonly id: string;
  readonly kind: 'predicate' | 'skill';
  readonly label?: string;
}

/** One predicate on a skill's root→leaf decision path, and the branch taken. */
export interface SkillRoutingStep {
  /** The predicate's caption (the `decide(...)` label). */
  readonly label: string;
  /** Which side of the predicate leads to this skill. */
  readonly branch: 'yes' | 'no';
}

/**
 * The routing PROVENANCE stamped onto a compiled skill's `metadata.skillGraph`
 * — *why* this skill is reachable. It rides through to the `context.evaluated`
 * event when the skill activates, so commentary + the lens can narrate the real
 * routing (not just "a skill activated"). Observability only; the trigger logic
 * is unchanged.
 */
export interface SkillRouting {
  /** How the skill is reached: a decision `tree` leaf, a flat `entry`, a
   *  deterministic `route` edge, or `model` (read_skill-reachable). */
  readonly via: 'tree' | 'entry' | 'route' | 'model';
  /** Decision path (tree only): the predicates from root→leaf + branch taken.
   *  For a skill used as MULTIPLE tree leaves this is the FIRST path; all
   *  paths are in `paths`. */
  readonly path?: readonly SkillRoutingStep[];
  /** All decision paths reaching this skill (tree only; present when the same
   *  skill is the leaf of more than one branch — the compiler merges repeated
   *  leaves into ONE injection whose trigger ORs the path predicates). */
  readonly paths?: ReadonlyArray<readonly SkillRoutingStep[]>;
  /** Entry/route edge caption. */
  readonly label?: string;
  /** Source skill id (route only). */
  readonly from?: string;
  /** The compiled trigger kind for a route (`rule` / `on-tool-return`). */
  readonly triggerKind?: string;
  /** The DATA matcher that routes here (entry only, when declared as `match:`) —
   *  serializable, so commentary/lens can say WHICH pattern chose the skill. */
  readonly match?: SkillMatchData;
  /** The DATA guard on the first deterministic edge in (route only, when
   *  declared as `guard:`, 9.51.0) — serializable, the `match` twin. */
  readonly guard?: SkillGuardData;
}

export interface EntryDecl {
  readonly id: string;
  /** The condition (compiled from `match` when the rule was declared as data). */
  readonly when?: (ctx: InjectionContext) => boolean;
  /** The serializable matcher behind `when`, when declared as data — what the
   *  check-up compares, `toMermaid()` captions, and the provenance stores. */
  readonly match?: SkillMatchData;
  /** The same compilation's EVIDENCE extractor (9.28.0) — what text in the user
   *  message made `when` true. Present only for the data forms; a `when`
   *  predicate is opaque code and has none. Called ONLY on the rule that won. */
  readonly witness?: (ctx: InjectionContext) => RouteWitness | undefined;
  /** The phrasings this rule claims (validated at declaration). Build-time TEST
   *  material — never read by the resolver, never on the wire. */
  readonly examples?: readonly string[];
  readonly label?: string;
}

export interface RouteDecl {
  readonly fromId: string;
  readonly toId: string;
  readonly when?: SkillRouteOptions['when'];
  readonly onToolReturn?: string | RegExp;
  readonly onToolStatus?: SkillRouteOptions['onToolStatus'];
  /** The compiled guard (9.51.0): predicate + data + evidence evaluator, one
   *  compilation (see skillGuard.ts). */
  readonly guard?: CompiledGuard;
  readonly label?: string;
}
