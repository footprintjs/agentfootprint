import type { EntryDecl, RouteDecl } from './graphRoutes.js';

// FOLD · the one owner of the skills reachable from where the cursor stands (declared successors ∪ entries, minus the cursor)
// consumers read this and never re-derive it: the read_skill offer builder (Agent.ts · readSkillOfferFor), the
// injection-engine config's `reachableSkills` and the read_skill gate's `allowedSkillIds` (both Agent.ts) — which
// toolCalls reads back as deps.allowedSkillIds at the propose-transition judge and at the gate itself
// (toolCalls.ts · "── Skill-graph read_skill GATE").
// detached: yes — dedupe builds a fresh array per call; the declarations never leave.
/**
 * The reachable-set resolver (the read_skill gate's allowed set). Pure +
 * deterministic over the build-time entries/routes:
 *   • cold start (cursor undefined) → the entry skills (you enter via entries);
 *   • otherwise → the cursor's direct successors (ANY declared edge out of it,
 *     deterministic OR bare/model) ∪ the entry skills, minus the cursor itself.
 *
 * That last exclusion is about MOVEMENT and nothing else: there is nowhere to
 * move to. It is NOT a statement that the cursor is unavailable, and five
 * consumers read it as one until {@link classifySkillTarget} was given the
 * question — read its doc comment before writing a `requested === cursor`
 * check anywhere. Declaration order preserved; ids de-duplicated.
 */
export function makeReachableSkills(
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
): (currentSkillId?: string) => readonly string[] {
  const entryIds = entries.map((e) => e.id);
  return (cur) => {
    const ids = cur === undefined ? [...entryIds] : [...successorsOf(cur, routes), ...entryIds];
    return dedupe(cur === undefined ? ids : ids.filter((id) => id !== cur));
  };
}

/**
 * WHICH CLASS OF TARGET a `read_skill` id is, from one cursor — the ONE owner
 * of the question every gate, description and refusal used to answer for
 * itself (9.86.0).
 *
 * ── THE LAW ───────────────────────────────────────────────────────────────
 *
 *   THE CURSOR IS A LEGITIMATE TARGET OF A READ (a stay), NEVER OF A MOVE.
 *
 * {@link makeReachableSkills} filters the cursor out of its own successor set,
 * and that is correct for a MOVE: there is nowhere to move to. It was then read
 * by five different consumers as "not available", which is a different claim and
 * a false one — the cursor's body is in the prompt and its tools are on the wire.
 * Each consumer that noticed wrote its own `requested === cursor` check; the two
 * that did not (the tool-effects `propose-transition` judge and the `skill_read`
 * permission gate) refused a stay as if it were a move.
 *
 * Four classes, in the order the gate must consider them:
 *
 *   • `'self'`        — the cursor itself. A stay: nothing activates, nothing
 *                       moves, nothing is read that was not already sent.
 *   • `'hop'`         — a declared successor of the cursor. The one class that
 *                       MOVES the cursor.
 *   • `'open'`        — a skill the graph wires no edge into (a `.selfExplain()`
 *                       skill, a `.skill()` registered beside the graph). It
 *                       activates and never moves the cursor.
 *   • `'unreachable'` — everything else.
 *
 * `'hop'` beats `'open'` when an id is in both sets: the move is the stronger
 * fact, and a caller that reports the id as merely open would lose it.
 *
 * Pure and total: no cursor (cold start) simply means nothing can be `'self'`.
 */
export type SkillTargetClass = 'self' | 'hop' | 'open' | 'unreachable';

// FOLD · the one owner of which class a read_skill target falls in from one cursor: 'self' | 'hop' | 'open' | 'unreachable'
// consumers read this and never re-derive it: skillToolDescriptors.ts · grantableRows and skillToolDescriptors.ts ·
// classOf · toolCalls.ts · atMountedCursor, the propose-transition judge (toolCalls.ts · "── A PROPOSAL TO THE
// CURSOR'S OWN SKILL IS A STAY") and the read_skill gate (toolCalls.ts · "── Skill-graph read_skill GATE") ·
// re-exported for consumers at doors/skill-graph.ts.
// detached: yes — a string literal over readonly inputs the caller already owns.
/**
 * Classify one `read_skill` target against one cursor. See
 * {@link SkillTargetClass} for the law this function owns.
 *
 * @example
 * ```ts
 * classifySkillTarget({ cursor: 'billing', target: 'billing' });               // 'self'
 * classifySkillTarget({ cursor: 'billing', target: 'refunds', hops: ['refunds'] }); // 'hop'
 * classifySkillTarget({ cursor: 'billing', target: 'debug', open: ['debug'] });     // 'open'
 * classifySkillTarget({ cursor: 'billing', target: 'vault' });                 // 'unreachable'
 * ```
 */
export function classifySkillTarget(args: {
  /** Where the cursor stands. `undefined` = cold start (nothing is a stay). */
  readonly cursor?: string;
  /** The id the model asked for. */
  readonly target: string;
  /** Declared successors of the cursor — `reachableSkills(cursor)`. */
  readonly hops?: readonly string[];
  /** Skills the graph wires no edge into. */
  readonly open?: readonly string[];
}): SkillTargetClass {
  const { cursor, target, hops, open } = args;
  if (cursor !== undefined && target === cursor) return 'self';
  if (hops?.includes(target) === true) return 'hop';
  if (open?.includes(target) === true) return 'open';
  return 'unreachable';
}

/** Direct successors of `from` — every declared route edge out of it (any kind). */
function successorsOf(from: string, routes: readonly RouteDecl[]): string[] {
  return routes.filter((r) => r.fromId === from).map((r) => r.toId);
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
