/**
 * hostContract — THE BOUNDARY between the skill-graph runtime and whatever
 * runs it (9.34.0).
 *
 * The skill graph is a pure decision layer: given an `InjectionContext` it
 * says which skill the cursor is in, which skills are reachable from there,
 * and which injections are active. It does not call a model, does not own a
 * loop, and does not know what a `Tool` is in any particular framework. This
 * module is the small set of shapes that statement needs to be TRUE:
 *
 *   • {@link SkillToolSchema} / {@link SkillTool} — the narrow shape a skill's
 *     tools must have for the graph to reason about them (a name, a
 *     description, an input schema, something to run). agentfootprint's own
 *     `Tool` structurally satisfies it; so would any other framework's.
 *   • {@link SkillToolDescriptor} — a PLAIN description of a tool the graph
 *     needs to exist (`read_skill` above all, which is how the model moves
 *     the cursor). The graph describes it; the host constructs it in its own
 *     tool type.
 *   • {@link SkillCachePolicy} — the cache directive that rides the
 *     `ActiveInjection` projection across the host boundary.
 *   • {@link SkillGraphHost} — the obligations a host must meet for the graph
 *     to route correctly. Documentation as a type.
 *
 * WHY STRUCTURAL COPIES. `SkillToolSchema` and `SkillCachePolicy` are
 * field-for-field mirrors of `adapters/types.ts#LLMToolSchema` and
 * `cache/types.ts#CachePolicy`. Mirroring them is what lets a foreign host
 * satisfy the boundary without importing an adapter layer it does not use;
 * TypeScript's structural typing then makes the two spellings mutually
 * assignable, so nothing inside agentfootprint changed shape. The mirrors are
 * PINNED against their originals by
 * `test/lib/injection-engine/skill-graph-fence.test.ts`, which fails on drift
 * in either direction.
 *
 * Zone: PURE CORE. Zero imports, by construction.
 */

// ─── Tools, as the graph needs to see them ─────────────────────────────

/**
 * A tool's LLM-facing declaration — name, description, input schema.
 *
 * Structural mirror of `LLMToolSchema` (`src/adapters/types.ts`). Anything
 * that satisfies one satisfies the other.
 */
export interface SkillToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

/**
 * The NARROW tool shape a skill carries in `InjectionContent.tools`.
 *
 * Two required members — a schema and something to run — because those are
 * the only two the graph, the contract checker and the vocabulary checker
 * ever read. agentfootprint's `Tool` adds credentials, artifact wants,
 * check-in demands, capabilities and result ceilings on top; every one of
 * them is optional, so a `Tool` IS a `SkillTool` and a `SkillTool` is
 * accepted everywhere a `Tool` is. That is the point: a host on another
 * framework hands its own tool objects straight in.
 *
 * `execute`'s context is deliberately `unknown` here — it is the HOST's
 * execution context, and the graph never calls the tool.
 */
export interface SkillTool<TArgs = Record<string, unknown>, TResult = unknown> {
  readonly schema: SkillToolSchema;
  execute(args: TArgs, ctx: unknown): Promise<TResult> | TResult;
}

/**
 * A tool the graph DESCRIBES but does not construct.
 *
 * `read_skill` is the load-bearing one: it is how the model asks to move the
 * cursor, so the graph has to be able to say what that tool looks like —
 * which ids are on the enum, which are reachable from here, what the menu
 * offers this turn, what the result says. What it must NOT do is build the
 * host's tool object, because that would drag a framework's tool factory
 * (and everything that factory pulls in) into a pure decision layer.
 *
 * So the graph emits this POJO and the host adapts it:
 *
 * @example agentfootprint's own adapter (`skillTools.ts`)
 *   const d = readSkillDescriptor(skills, offer);
 *   return d && defineTool({ name: d.name, description: d.description,
 *                            inputSchema: d.inputSchema, execute: d.execute });
 *
 * @example another framework
 *   const d = readSkillDescriptor(skills);
 *   myFramework.tool(d.name, d.description, d.inputSchema, d.execute);
 */
export interface SkillToolDescriptor<TArgs = Record<string, unknown>, TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Pure: same args in, same string out. No host context is passed. */
  execute(args: TArgs): TResult;
}

// ─── The cache directive that rides the projection ─────────────────────

/**
 * Read-only snapshot a {@link SkillCachePolicy} predicate inspects.
 * Structural mirror of `CachePolicyContext` (`src/cache/types.ts`).
 */
export interface SkillCachePolicyContext {
  readonly iteration: number;
  readonly iterationsRemaining: number;
  readonly userMessage: string;
  readonly lastToolName?: string;
  readonly cumulativeInputTokens: number;
}

/**
 * Whether an injection's content may be marked as a cacheable prefix.
 * Structural mirror of `CachePolicy` (`src/cache/types.ts`) — carried
 * across the boundary by `ActiveInjection.cache`, where a host that has no
 * prefix cache at all can simply ignore it.
 */
export type SkillCachePolicy =
  | 'always'
  | 'never'
  | 'while-active'
  | { readonly until: (ctx: SkillCachePolicyContext) => boolean };

// ─── What a host owes the graph ────────────────────────────────────────

/**
 * The obligations a host must meet to run a skill graph CORRECTLY.
 *
 * This is documentation as a type, not a runtime abstraction. Nothing in
 * agentfootprint constructs one, nothing consumes one, and implementing it
 * does not start a run — the package has exactly one run door and this is
 * not a second one. It exists so the contract that was previously spread
 * across four call sites in three files can be READ in one place, and so a
 * host on another framework can typecheck its own wiring against it.
 *
 * `buildInjectionEngineSubflow.ts` + `core/agent/stages/toolCalls.ts` are the
 * reference implementation of every clause below.
 *
 * @example checking a foreign host against the contract
 *   const host: SkillGraphHost = {
 *     advanceCursor: (ctx) => graph.explainNextSkill(ctx).to,
 *     acceptSkillPick: (id, cursor) => graph.reachableSkills(cursor).includes(id),
 *     …
 *   };
 */
export interface SkillGraphHost {
  /**
   * **Obligation 1 — one cursor advance per iteration, off the SAME ctx.**
   *
   * Build the iteration's `InjectionContext` ONCE, ask the graph where the
   * cursor goes with that exact object, and evaluate every trigger with that
   * exact object. Route triggers are compiled as `nextSkill(ctx) === id`, so
   * an active set derived from a different ctx than the stored cursor can
   * disagree with it — the skill the loop thinks it is in and the body it
   * actually injects come apart. This is the keystone; everything else here
   * is bookkeeping around it.
   *
   * Reference: `buildInjectionEngineSubflow.ts` — `baseCtx` is built, handed
   * to `explainNextSkill`, then handed to `evaluateInjections`.
   */
  advanceCursor(ctx: SkillGraphIterationContext): string | undefined;

  /**
   * **Obligation 2 — enforce reachability at PICK time.**
   *
   * When the model calls `read_skill(id)`, the host must check `id` against
   * `graph.reachableSkills(cursor)` BEFORE treating the pick as real, and
   * refuse teachingly when it is not reachable. The graph cannot enforce
   * this itself: it never sees the tool call. A host that skips the gate
   * turns every declared edge into a suggestion.
   *
   * Reference: `toolCalls.ts` — `deps.allowedSkillIds(currentSkillId)`.
   */
  acceptSkillPick(skillId: string, currentSkillId: string | undefined): boolean;

  /**
   * **Obligation 3 — publish an ACCEPTED pick, and only an accepted one.**
   *
   * `InjectionContext.pendingSkillPick` is the model's validated volunteer
   * hop. Set it only after obligation 2 has said yes (a refused pick must
   * never move the cursor), and clear it at the top of every iteration so it
   * names a pick made just now rather than a stale one.
   *
   * Reference: `toolCalls.ts` — cleared once per iteration, then set only on
   * the accepted-hop path.
   */
  publishAcceptedPick(skillId: string | undefined): void;

  /**
   * **Obligation 4 — carry the cursor across iterations.**
   *
   * The value obligation 1 produced becomes the NEXT iteration's
   * `currentSkillId`. One run's worth: a skill graph declares how one turn
   * is routed, so a fresh run starts at the entry, not where the last one
   * stopped. A host that wants continuity persists the id itself and starts
   * the next turn's graph from it.
   *
   * Reference: `buildInjectionEngineSubflow.ts` writes the advanced cursor
   * to a distinct output key; the mount mappers map it onto the parent's
   * `currentSkillId` for the next iteration.
   */
  carryCursor(nextSkillId: string | undefined): void;

  /**
   * **Obligation 5 — say what happened, out loud.**
   *
   * Every routing decision the graph makes is evidence, and evidence that is
   * not emitted did not happen as far as any observer is concerned. A host
   * should surface at minimum: a skill becoming active or inactive, a pick
   * REFUSED by the gate, and a batch whose edges disagreed. agentfootprint
   * spells these `agentfootprint.skill.activated` / `.deactivated` /
   * `.rejected` / `.escalated` / `.route_conflict` / `.reroute_superseded` /
   * `.turn_routed`; a foreign host may name them whatever it likes, but a
   * refusal the operator cannot see is the one this contract cares about.
   */
  emitSkillEvent(name: string, payload: Readonly<Record<string, unknown>>): void;
}

/**
 * The per-iteration context obligation 1 reads. Kept structural (rather than
 * naming `InjectionContext`) so this module stays a zero-import leaf; the
 * real `InjectionContext` satisfies it.
 */
export interface SkillGraphIterationContext {
  readonly iteration: number;
  readonly userMessage: string;
  readonly currentSkillId?: string;
  readonly pendingSkillPick?: string;
}
