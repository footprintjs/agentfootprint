/**
 * Engagement — the kernel-owned axis, orthogonal to every map's own cursor.
 *
 * Pattern: plain data. Everything here is a POJO that survives
 *          `structuredClone`, because engagement state rides chart scope
 *          across iterations.
 * Role:    the vocabulary of the mount kernel. A MAP (a skill map today; a
 *          screen map next) owns its cursor and never surrenders it; the
 *          KERNEL owns whether that map's contributions ride the next call.
 *          Parking a map never moves its cursor — that is the whole design.
 */

/**
 * How strong the evidence behind an engagement is. The ladder decides decay:
 * `assumed`, `lexical` and `semantic` engagements are guesses and expire
 * without corroboration; `structural` and `explicit` ones stand until
 * released.
 *
 * - `explicit`   — the model (or a person) asked for this map by name.
 * - `structural` — a declared edge fired, a tool proposed the transition, or
 *                  the map's own tool was invoked: the system, not prose.
 * - `semantic`   — a classifier or scorer judged the person's words.
 * - `lexical`    — a pattern matched the person's words. A regex hit is a
 *                  guess about intent, never a commitment.
 * - `assumed`    — NOBODY SAID WHY (9.59.0). The cursor is inside the map and
 *                  no clause explains how it got there: the graph cannot
 *                  explain its moves, the cause was a `'stay'` or `'none'`
 *                  (which are not moves), or this is a later turn and the
 *                  founding evidence belongs to an earlier run. Weakest rung,
 *                  and tentative — an unknown cause must never inherit the
 *                  strength of a known one. Before 9.59.0 all three of those
 *                  cases were written down as `structural`, the strongest
 *                  non-decaying category, which laundered turn one's regex
 *                  guess into a permanent warrant on turn two.
 */
export type EvidenceStrength = 'explicit' | 'structural' | 'semantic' | 'lexical' | 'assumed';

/** Where a map stands with the kernel. (Bids add `candidate` in a later release.) */
export type EngagementStanding = 'engaged' | 'parked';

/**
 * The build-time card for one map the kernel manages: which injection ids
 * are its contribution surface (what parking suppresses) and which tool
 * names it contributes (what the renewal feed joins tool calls against).
 */
export interface MountedMap {
  /** Plain identifier, unique among mounted maps. */
  readonly id: string;
  /** The injection ids this map contributes through — parking suppresses exactly these. */
  readonly memberIds: readonly string[];
  /** Tool names contributed by this map's members — a call to one renews the lease. */
  readonly toolNames: readonly string[];
  /** A mandatory map (a policy map) may never be parked. */
  readonly nonParkable?: boolean;
}

/**
 * Every member id of every map the kernel currently holds PARKED.
 *
 * The one thing the engine asks the kernel (9.59.0), and deliberately a pure
 * function over plain data: `src/maps/**` still imports nothing from the
 * engine — the engine imports this. The `read_skill` gate needs it to tell a
 * cursor move from a RE-ENGAGEMENT: a pick of a parked map's member is a
 * request for that map's contribution to ride again, which changes engagement
 * and not position, so the "you are already there" refusal (correct for a
 * move) is wrong for it.
 */
export function parkedMemberIds(
  plan: EngagementPlan,
  engagement: MapEngagement | undefined,
): ReadonlySet<string> {
  const out = new Set<string>();
  if (engagement === undefined) return out;
  const parked = new Set(
    engagement.filter((r) => r.standing === 'parked').map((r) => r.mapId),
  );
  for (const map of plan.maps) {
    if (parked.has(map.id)) for (const id of map.memberIds) out.add(id);
  }
  return out;
}

/**
 * One map's engagement record — the kernel's state for it, per run.
 *
 * ── THREE DISTINCT FACTS, NOT ONE STANDING (9.59.0) ───────────────────
 * Until 9.59.0 a single `by` answered three different questions at once, and
 * conflating them is what let one accepted pick justify a whole turn:
 *
 *   1. ENGAGEMENT provenance — *why is this map participating at all?*
 *      {@link MapEngagementRecord.foundedBy} / `foundedAt` / `foundedOn`.
 *      Written ONCE and never rewritten. "At iteration 3 the user explicitly
 *      activated audit" stays true forever, whatever happens later.
 *
 *   2. POSITION evidence — *why is the cursor on THIS member?*
 *      {@link MapEngagementRecord.at} / `atBy` / `atSince`. A declared route
 *      firing is NOT a user request: when an explicit pick of `A` is followed
 *      by a declared edge to `B`, `B`'s position rests on `structural` with
 *      its own iteration. Letting `B` inherit `explicit` would destroy the
 *      causal record, which is the thing this framework sells.
 *
 *   3. CONTRIBUTION eligibility — *why is THIS member's contribution being
 *      served right now?* {@link MapEngagementRecord.by}. RECOMPUTED every
 *      pass from renewals, leases and the CURRENT tenant. This is the only
 *      one that may weaken, and it weakens when the SUBJECT changes (the
 *      cursor moved to a member nobody asked for), never merely because time
 *      passed.
 *
 * The kernel observes position; it never sets it. Recording where the cursor
 * was is not owning it.
 */
export interface MapEngagementRecord {
  readonly mapId: string;
  readonly standing: EngagementStanding;
  /**
   * FACT 3 — CONTRIBUTION eligibility: the strength justifying the
   * contribution being served RIGHT NOW. Recomputed each pass.
   *
   * It rises on corroboration (an upgrade) and it is RE-DERIVED when the
   * cursor moves to a different member of the map, because the thing being
   * justified is then a different contribution. It is never lowered because
   * time passed — that is what {@link MapEngagementRecord.idle} is for.
   */
  readonly by: EvidenceStrength;
  /** Iteration the current standing began. */
  readonly since: number;
  /**
   * FACT 1 — ENGAGEMENT provenance. The strength the engagement was FOUNDED
   * on, the iteration it was founded, and the member it was founded on
   * (9.59.0). Never overwritten, and never downgraded because time passed.
   *
   * `by` is upgraded in place when real evidence corroborates a guess, and
   * before this trio existed that overwrite erased the only answer to the
   * question an incident review actually asks — *was this founded on a
   * guess?* A record founded `lexical` on iteration 1 and confirmed by an
   * owned-tool call on iteration 2 read `structural since 1`: the feature's
   * own disease, inside the feature.
   */
  readonly foundedBy: EvidenceStrength;
  readonly foundedAt: number;
  /** The member the cursor stood on when the engagement was founded. Immutable. */
  readonly foundedOn?: string;
  /**
   * FACT 2 — POSITION evidence: the member the cursor occupies, the strength
   * of the clause that put it there, and the iteration it arrived (9.59.0).
   *
   * Observed, never set. `atBy` is the strength of THIS move, not an
   * inheritance: a declared route into a member carries `structural` even
   * inside a map whose engagement origin was `explicit`.
   */
  readonly at?: string;
  readonly atBy?: EvidenceStrength;
  readonly atSince?: number;
  /**
   * Consecutive passes in which this map's contribution WAS SERVED on the
   * previous pass, none of its tools was called, and the model called
   * something else instead — the measured precondition of the recorded
   * 30-call stuck turn.
   *
   * All three clauses are checked (9.59.0). The served clause reads the
   * previous pass's per-slot active set, which the Evaluate stage already
   * holds; before that it was documented and not implemented, and the skip
   * reason written onto the record asserted it anyway.
   */
  readonly idle: number;
  /** The text that engaged it, when the engagement was a guess (bounded upstream). */
  readonly witness?: string;
}

/**
 * The kernel's whole engagement state — one record per managed map.
 *
 * A TOP-LEVEL ARRAY on purpose (the StepPointerCarrier law): footprintjs's
 * smart merge replaces a top-level array under `arrayMerge: Replace`, but an
 * array NESTED inside a bare object is appended across iterations — five
 * passes would leave five records for one map, and the oldest would be the
 * one a reader finds first.
 */
export type MapEngagement = readonly MapEngagementRecord[];

/** What the kernel was mounted with. */
export interface EngagementPlan {
  readonly maps: readonly MountedMap[];
  /**
   * How many corroboration-free passes a tentative (lexical/semantic)
   * engagement survives before it is parked. Default 3 — calibrated on the
   * recorded failure corpus, where the stuck turn would have parked on call
   * four; re-baseline after the 9.55–9.57 window fixes before trusting the
   * number further.
   */
  readonly renewalGrace: number;
}

/** One standing change, for the record — the event payloads are built from these. */
export type EngagementChange =
  | {
      readonly kind: 'engaged';
      readonly mapId: string;
      readonly iteration: number;
      readonly by: EvidenceStrength;
      readonly witness?: string;
      /** True when this engagement recovered a parked map. */
      readonly reengaged?: true;
      /**
       * True when real evidence UPGRADED a standing that already existed
       * (9.59.0) — the guess was corroborated. Carries the cause it was
       * founded on, so the record keeps both halves of the story.
       */
      readonly upgraded?: true;
      /**
       * True when the CURSOR MOVED to a different member of an already-engaged
       * map (9.59.0) — a tenant change. Eligibility was re-derived from the new
       * position's own evidence instead of inherited from the old tenant's, so
       * a declared edge out of an explicitly-requested skill does not hand the
       * next skill a user request it never received.
       *
       * The change is on the record because the rule is that everything the
       * kernel decides reaches the record, including that eligibility changed
       * and why.
       */
      readonly tenantChanged?: true;
      /** The member the cursor moved to, on a `tenantChanged` change. */
      readonly at?: string;
      /** The founding cause, on an `upgraded` or `tenantChanged` change. */
      readonly foundedBy?: EvidenceStrength;
    }
  | {
      readonly kind: 'parked';
      readonly mapId: string;
      readonly iteration: number;
      /** Strength of the evidence the parked engagement had rested on. */
      readonly by: EvidenceStrength;
      /** How many corroboration-free passes it survived before parking. */
      readonly idleCalls: number;
      readonly witness?: string;
    };

/** Options for `Agent.create(...).maps()` — mounting the kernel. */
export interface MapsOptions {
  /**
   * Corroboration-free passes a tentative engagement survives before it is
   * parked. Default 3 (see {@link EngagementPlan.renewalGrace} for the
   * calibration caveat). Must be an integer ≥ 1.
   */
  readonly renewalGrace?: number;
  /**
   * Mount the map as MANDATORY — it is never parked, whatever the idle count
   * (9.59.0). For a policy map, a compliance map, a safety brief: content
   * whose absence is a defect even when the turn never touches it.
   *
   * Per-MAP in the kernel's data model ({@link MountedMap.nonParkable}) and
   * agent-level here only because exactly one map mounts today (the skill
   * map). When the second tenant lands this grows a per-map form; the option
   * name is chosen to survive that.
   *
   * Note what it does NOT do: a non-parkable map still accrues `idle`, and a
   * tentative standing still reads tentative. It suppresses the park, not the
   * measurement — so the record still shows you a map riding every call
   * unused.
   */
  readonly nonParkable?: boolean;
}
