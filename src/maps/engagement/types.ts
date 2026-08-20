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
 * `lexical` and `semantic` engagements are guesses and expire without
 * corroboration; `structural` and `explicit` ones stand until released.
 *
 * - `explicit`   — the model (or a person) asked for this map by name.
 * - `structural` — a declared edge fired, a tool proposed the transition, or
 *                  the map's own tool was invoked: the system, not prose.
 * - `semantic`   — a classifier or scorer judged the person's words.
 * - `lexical`    — a pattern matched the person's words. A regex hit is a
 *                  guess about intent, never a commitment.
 */
export type EvidenceStrength = 'explicit' | 'structural' | 'semantic' | 'lexical';

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

/** One map's engagement record — the kernel's state for it, per run. */
export interface MapEngagementRecord {
  readonly mapId: string;
  readonly standing: EngagementStanding;
  /** Strength of the evidence the CURRENT standing rests on. */
  readonly by: EvidenceStrength;
  /** Iteration the current standing began. */
  readonly since: number;
  /**
   * Consecutive passes in which this map's contributions were served, none
   * of its tools was called, and the model called something else instead —
   * the measured precondition of the recorded 30-call stuck turn.
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
}
