// ─── Map engagement (9.58.0) — the mount kernel's standing changes ──────

/** A mounted map's contributions are riding the calls again (or for the
 *  first time). `by` is the strength of the evidence the standing rests on
 *  — `assumed`/`lexical`/`semantic` engagements decay without corroboration;
 *  `structural`/`explicit` ones stand. `reengaged` marks a recovery from a
 *  park; `upgraded` marks a guess that real evidence confirmed. The map's own
 *  cursor is never touched by any of this: engagement is the kernel's axis,
 *  position is the map's. */
export interface MapEngagedPayload {
  readonly mapId: string;
  readonly iteration: number;
  readonly by: 'explicit' | 'structural' | 'semantic' | 'lexical' | 'assumed';
  /** The matched text that founded a guessed engagement (bounded upstream). */
  readonly witness?: string;
  readonly reengaged?: true;
  /** The standing was UPGRADED in place by corroborating evidence (9.59.0).
   *  Emitted so the record shows the moment a guess became a fact instead of
   *  silently rewriting `by` and leaving a reviewer to believe it was always
   *  that strong. */
  readonly upgraded?: true;
  /** On an `upgraded` or `tenantChanged` change: the cause the engagement was
   *  FOUNDED on, which never changes for the life of the record. */
  readonly foundedBy?: 'explicit' | 'structural' | 'semantic' | 'lexical' | 'assumed';
  /** The CURSOR moved to a different member of an already-engaged map (9.59.0)
   *  — a TENANT CHANGE. Eligibility was re-derived from the new member's own
   *  evidence rather than inherited from the old one's: a declared edge out of
   *  an explicitly-requested skill does not hand the next skill a user request
   *  it never received. `by` is the new member's strength; `foundedBy` still
   *  names how the engagement began. */
  readonly tenantChanged?: true;
  /** The member the cursor moved to, on a `tenantChanged` change. */
  readonly at?: string;
}

/** A mounted map was PARKED: its contribution was served for `idleCalls`
 *  consecutive passes in which none of its tools was called while the turn
 *  went elsewhere — the measured shape of the recorded 30-call stuck turn,
 *  and all three of those clauses are checked (9.59.0). Its prompt and tools
 *  stop riding; its cursor stays exactly where the map put it; explicit or
 *  structural evidence — including the model picking one of its skills by
 *  name — re-engages it. */
export interface MapParkedPayload {
  readonly mapId: string;
  readonly iteration: number;
  /** Strength of the evidence the parked engagement had rested on. */
  readonly by: 'explicit' | 'structural' | 'semantic' | 'lexical' | 'assumed';
  readonly idleCalls: number;
  readonly witness?: string;
}
