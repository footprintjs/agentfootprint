/**
 * agentfootprint/maps — the mount kernel's vocabulary.
 *
 * An agent can be fed by more than one WALKABLE MAP: the skill map (which
 * skill is active) today, an application's screen map (which page the person
 * is on) next. Each map owns its own cursor and never surrenders it. What no
 * map may own is the axis this door names: ENGAGEMENT — whether a map's
 * contributions (prompt fragment, tools) ride the next model call at all.
 *
 * The kernel's law, in one sentence: an engagement founded on a guess (a
 * regex, a classifier) is renewed only by concrete evidence — the map's own
 * tool called, a declared route fired, the model asking by name — and
 * without corroboration it is PARKED, its cursor untouched, until evidence
 * re-engages it.
 *
 * Mount it with `Agent.create(...).skillGraph(map).maps()`. Everything here
 * is plain data and pure functions, exported so a consumer can (a) type the
 * `agentfootprint.map.*` event payloads it observes, (b) reason about or
 * test the lease law directly, and (c) build honest values with `Claim<T>`.
 *
 * @example
 *   import { advanceEngagement } from 'agentfootprint/maps';
 *
 *   const plan = { maps: [{ id: 'skill-map', memberIds: ['audit'], toolNames: ['get_zones'] }], renewalGrace: 3 };
 *   let state;
 *   // iteration 1: an entry regex placed the cursor — a lexical guess
 *   ({ next: state } = advanceEngagement(plan, state, {
 *     iteration: 1, currentNode: 'audit', moveBy: 'entry', witness: 'zone',
 *     toolResults: [], acceptedSkillPicks: [], servedLastPass: [],
 *   }));
 *   // iterations 2..4: the model works elsewhere; on the 4th pass the map parks
 *
 * The two per-pass feeds are the 9.59.0 shape and both matter: `acceptedSkillPicks`
 * is THIS pass's accepted `read_skill` picks (turn-cumulative evidence renewed a
 * guess forever), and `servedLastPass` is what actually reached the wire last pass
 * (a contribution that never rode cannot have been ignored).
 */

export {
  known,
  unknown,
  notApplicable,
  isKnown,
  valueOr,
  describeClaim,
  type Claim,
} from '../lib/claim/claim.js';

export type {
  EvidenceStrength,
  EngagementStanding,
  MountedMap,
  MapEngagementRecord,
  MapEngagement,
  EngagementPlan,
  EngagementChange,
  MapsOptions,
} from '../maps/engagement/types.js';

export { advanceEngagement, type EngagementAdvance } from '../maps/engagement/lease.js';

export {
  renewalEvidenceOf,
  strengthOfMove,
  strengthOfEvidence,
  strongestOf,
  isTentative,
  type EngagementPass,
  type RenewalEvidence,
} from '../maps/engagement/evidence.js';
