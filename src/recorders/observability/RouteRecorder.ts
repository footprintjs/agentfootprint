/**
 * routeRecorder — records the skill-graph route a run actually took.
 *
 * A passive observer that reconstructs, hop by hop, which skill the agent was in,
 * where it went next, and WHY — by COMPOSING already-shipped events (no engine
 * change): `agentfootprint.context.evaluated` (its `routing[]` carries via/from/
 * label per active skill-graph injection) + `agentfootprint.skill.rejected` (an
 * out-of-reach read_skill) + `stream.tool_start` (the tool that drove a hop).
 *
 * Also folds in the GREY-AREA GOVERNORS (observability tier): it detects
 * oscillation (A→B→A→B within `pingPongWindow`) and a run of consecutive rejected
 * `read_skill` jumps (`maxRejectedRetries`), reported via `getTrips()`. These LABEL
 * the trace (`onTrip:'stay'` semantics) — the hard "always stops" guarantee remains
 * the agent's iteration cap; a runtime force-stop is a deferred follow-on.
 *
 * Pattern: CombinedRecorder (Convention 1 — single purpose: route evidence). Owns a
 *          `SequenceStore<RouteHop>`. Convention 4: resets on a new `runId`.
 * Role:    Tier-3 /observe recorder — `Agent.create(...).watch(routeRecorder())`.
 *          Powers the lens, the "Why this skill?" panel, and paper route figures.
 */

import type { EmitEvent } from 'footprintjs';
import { SequenceStore } from 'footprintjs/trace';

interface RunBoundaryEvent {
  readonly traversalContext?: { readonly runId?: string };
}

/**
 * How the graph arrived at a skill on a hop.
 *
 * `'model-pick'` joined the union in 8.5.0 — a `read_skill` the gate accepted, which
 * moved the cursor because no declared edge fired. It used to be recorded as a
 * `'route'`, borrowing the label of whatever edge happened to point at the same
 * skill, so the trace asserted that an edge fired when it had not. The cause now
 * comes from the graph's own resolver (`cursorMove.by`), not from the drawn
 * build-time provenance.
 *
 * `'intent'` and `'continuity'` joined in 9.17.0 (SG-C): the turn-start
 * cascade's tier-2 scorer decisively routed the turn, and the inherited
 * conversation cursor held it, respectively — both reported by the resolver
 * on iteration 1, numbers on `agentfootprint.skill.turn_routed`.
 *
 * `'tool-proposal'` and `'decider'` joined in 9.19.0: an accepted
 * `propose-transition` tool effect moved the cursor (deterministic tool
 * evidence — outranked only by a declared edge), and the configured tier-3
 * decider resolved an outstanding turn-start menu out-of-band, respectively.
 */
export type RouteOutcome =
  | 'entry'
  | 'route'
  | 'model-pick'
  | 'tool-proposal'
  | 'intent'
  | 'continuity'
  | 'decider'
  | 'stay'
  | 'rejected';

/** One hop of the route — the skill the graph was in at one iteration + how. */
export interface RouteHop {
  /** runtimeStageId of the iteration (the SequenceStore key). */
  readonly runtimeStageId: string;
  readonly iteration: number;
  /** The skill before this hop (undefined at cold start). */
  readonly fromSkill?: string;
  /** The skill after this hop (undefined for a pure rejection). */
  readonly toSkill?: string;
  readonly outcome: RouteOutcome;
  /** A human-readable reason for this hop (see `formatRouteHop`). */
  readonly why: string;
  /** The route edge's caption, when one drove the hop. */
  readonly edgeLabel?: string;
  /** The tool whose result drove the hop (most recent tool_start). */
  readonly lastTool?: string;
  /** Rejection only — the skill the model tried to jump to. */
  readonly requestedSkill?: string;
  /** Rejection only — the reachable set it was bounded to. */
  readonly reachable?: readonly string[];
}

/** A governor trip — the route is misbehaving. */
export type RouteTripKind = 'ping-pong' | 'rejected-cap';
export interface RouteTrip {
  readonly kind: RouteTripKind;
  readonly iteration: number;
  readonly skills: readonly string[];
  readonly detail: string;
}

export interface RouteRecorderOptions {
  readonly id?: string;
  /** Window for oscillation detection (a [X,Y,X,Y] pattern trips). Default 4. */
  readonly pingPongWindow?: number;
  /** Consecutive rejected read_skill jumps before a `rejected-cap` trip. Default 3. */
  readonly maxRejectedRetries?: number;
}

export interface RouteRecorderHandle {
  readonly id: string;
  /** The distinct skill sequence the run moved through (the "route"). */
  getPath(): readonly string[];
  /** Every hop, in order. */
  getHops(): readonly RouteHop[];
  /** The rejected read_skill attempts (out-of-reach jumps). */
  getRejections(): readonly RouteHop[];
  /** Governor trips (oscillation / rejected-retry cap). */
  getTrips(): readonly RouteTrip[];
  clear(): void;
  // CombinedRecorder hooks (routed by method-shape detection):
  onEmit(event: EmitEvent): void;
  onRunStart(event: RunBoundaryEvent): void;
}

/** A human-readable one-line reason for a hop. Exported (pure). */
export function formatRouteHop(hop: RouteHop): string {
  switch (hop.outcome) {
    case 'entry':
      return `entered "${hop.toSkill}"`;
    case 'route':
      return `"${hop.fromSkill}" → "${hop.toSkill}"${hop.edgeLabel ? ` (${hop.edgeLabel})` : ''}${
        hop.lastTool ? ` on ${hop.lastTool}` : ''
      }`;
    case 'model-pick':
      // Deliberately carries no edge caption: no declared edge fired, and lending it
      // one is the exact misattribution this outcome exists to end.
      return hop.fromSkill === undefined
        ? `read_skill("${hop.toSkill}") accepted at cold start`
        : `read_skill("${hop.toSkill}") accepted from "${hop.fromSkill}"`;
    case 'tool-proposal':
      // Same no-caption rule as model-pick: no declared edge fired — a tool's
      // accepted propose-transition effect moved the cursor.
      return hop.fromSkill === undefined
        ? `a tool's transition proposal accepted at cold start → "${hop.toSkill}"`
        : `a tool's transition proposal moved "${hop.fromSkill}" → "${hop.toSkill}"`;
    case 'intent':
      // The turn-start classifier's decisive win — the numbers ride turn_routed.
      return hop.fromSkill === undefined
        ? `the message decisively matched "${hop.toSkill}" (turn-start classifier)`
        : `"${hop.fromSkill}" → "${hop.toSkill}" (the message decisively matched it)`;
    case 'continuity':
      return `carried from last turn — still in "${hop.toSkill}"`;
    case 'decider':
      return `the routing decider read the menu and chose "${hop.toSkill}"`;
    case 'stay':
      return `stayed in "${hop.toSkill}"`;
    case 'rejected':
      return `read_skill("${hop.requestedSkill}") rejected from "${
        hop.fromSkill ?? 'cold start'
      }" — reachable: ${(hop.reachable ?? []).join(', ') || '(none)'}`;
  }
}

interface RoutingProjection {
  readonly injectionId?: unknown;
  readonly via?: unknown;
  readonly from?: unknown;
  readonly label?: unknown;
}

/**
 * The hop's cause as the GRAPH reported it (`context.evaluated`'s `cursorMove.by`,
 * 8.5.0) — or `undefined` when the event carries none, so the caller can fall back
 * to inferring it from the destination.
 *
 * `'none'` maps to `undefined` on purpose: it means the graph has no cursor at all
 * this iteration, which is not a hop cause. A decision `tree()` reports it every
 * iteration, and there the inferred outcome (entry, then stay) is the right story:
 * a tree really does re-route by predicate rather than move a cursor.
 */
function causeOf(cursorMove: unknown): RouteOutcome | undefined {
  if (cursorMove === null || typeof cursorMove !== 'object') return undefined;
  const by = (cursorMove as { by?: unknown }).by;
  switch (by) {
    case 'entry':
    case 'route':
    case 'model-pick':
    case 'tool-proposal':
    case 'intent':
    case 'continuity':
    case 'decider':
    case 'stay':
      return by;
    default:
      return undefined;
  }
}

/** The current cursor skill from a `context.evaluated` routing[] — prefer a
 *  transitioned-into route target, then an entry, then a tree leaf, then model. */
function cursorFromRouting(
  routing: readonly RoutingProjection[],
): { id: string; from?: string; label?: string } | undefined {
  for (const via of ['route', 'entry', 'tree', 'model']) {
    const e = routing.find((r) => r.via === via && typeof r.injectionId === 'string');
    if (e) {
      return {
        id: e.injectionId as string,
        ...(typeof e.from === 'string' ? { from: e.from } : {}),
        ...(typeof e.label === 'string' ? { label: e.label } : {}),
      };
    }
  }
  return undefined;
}

/** Build the route recorder. */
export function routeRecorder(options: RouteRecorderOptions = {}): RouteRecorderHandle {
  const pingPongWindow = options.pingPongWindow ?? 4;
  const maxRejectedRetries = options.maxRejectedRetries ?? 3;
  const store = new SequenceStore<RouteHop>();
  const trips: RouteTrip[] = [];
  const transitions: string[] = []; // toSkill of 'route'/'entry' hops, for oscillation
  let lastRunId: string | undefined;
  let cursor: string | undefined;
  let lastTool: string | undefined;
  let consecutiveRejected = 0;
  let trippedRejectedCap = false;

  const reset = (): void => {
    store.clear();
    trips.length = 0;
    transitions.length = 0;
    cursor = undefined;
    lastTool = undefined;
    consecutiveRejected = 0;
    trippedRejectedCap = false;
  };

  const detectPingPong = (iteration: number): void => {
    if (transitions.length < pingPongWindow) return;
    const recent = transitions.slice(-pingPongWindow);
    const distinct = new Set(recent);
    // [X,Y,X,Y,...]: exactly two skills, strictly alternating across the window.
    if (distinct.size === 2 && recent.every((s, i) => s === recent[i % 2])) {
      const skills = [...distinct];
      if (!trips.some((t) => t.kind === 'ping-pong' && t.iteration === iteration)) {
        trips.push({
          kind: 'ping-pong',
          iteration,
          skills,
          detail: `oscillating between "${skills[0]}" and "${skills[1]}" over the last ${pingPongWindow} hops`,
        });
      }
    }
  };

  return {
    id: options.id ?? 'route',

    onEmit(event): void {
      const payload = event.payload;
      if (payload === null || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;

      switch (event.name) {
        case 'agentfootprint.stream.tool_start': {
          if (typeof p.toolName === 'string') lastTool = p.toolName;
          break;
        }
        case 'agentfootprint.context.evaluated': {
          const routing = Array.isArray(p.routing) ? (p.routing as RoutingProjection[]) : [];
          const cur = cursorFromRouting(routing);
          if (cur === undefined) break; // no skill-graph routing this iteration
          const iteration = Number(p.iteration ?? 0);
          const from = cursor;
          // The CAUSE, from the graph's own resolver when it reported one (8.5.0).
          // Falling back to inferring it from the destination — what this recorder
          // did before — is kept for a graph too old to explain itself, and is the
          // only path that can still mistake a model pick for a declared edge.
          const cause = causeOf(p.cursorMove);
          const outcome: RouteOutcome =
            cause ?? (cursor === undefined ? 'entry' : cur.id !== cursor ? 'route' : 'stay');
          // An edge caption belongs to a hop a declared EDGE drove. On a model pick
          // the caption is the label of an edge that did not fire.
          const wearsEdgeLabel = outcome === 'route' || outcome === 'entry';
          const hop: RouteHop = {
            runtimeStageId: event.runtimeStageId,
            iteration,
            ...(from !== undefined ? { fromSkill: from } : {}),
            toSkill: cur.id,
            outcome,
            why: '',
            ...(wearsEdgeLabel && cur.label !== undefined ? { edgeLabel: cur.label } : {}),
            ...(outcome === 'route' && lastTool !== undefined ? { lastTool } : {}),
          };
          const finished = { ...hop, why: formatRouteHop(hop) };
          store.push(finished);
          const moved = outcome !== 'stay';
          if (moved) {
            transitions.push(cur.id);
            detectPingPong(iteration);
          }
          cursor = cur.id;
          // Only a CURSOR MOVE breaks a rejection run (8.5.0). Resetting on every
          // evaluation made `maxRejectedRetries` untrippable: one evaluation fires
          // between every pair of rejections, so the count never passed 1 and a model
          // could re-ask for the same out-of-reach skill until the iteration cap. A
          // 'stay' is precisely the case where the model asked and got nowhere.
          if (moved) {
            consecutiveRejected = 0;
            trippedRejectedCap = false;
          }
          break;
        }
        case 'agentfootprint.skill.rejected': {
          const iteration = Number(p.iteration ?? 0);
          const hop: RouteHop = {
            runtimeStageId: event.runtimeStageId,
            iteration,
            ...(typeof p.currentSkillId === 'string' ? { fromSkill: p.currentSkillId } : {}),
            outcome: 'rejected',
            why: '',
            ...(typeof p.requestedId === 'string' ? { requestedSkill: p.requestedId } : {}),
            reachable: Array.isArray(p.allowed) ? (p.allowed as string[]) : [],
          };
          store.push({ ...hop, why: formatRouteHop(hop) });
          consecutiveRejected += 1;
          // ONE trip per run of rejections, re-armed when the cursor next moves.
          // The old guard was per-ITERATION, so once the count passed the cap every
          // further iteration pushed another identical trip.
          if (consecutiveRejected >= maxRejectedRetries && !trippedRejectedCap) {
            trippedRejectedCap = true;
            trips.push({
              kind: 'rejected-cap',
              iteration,
              skills: typeof p.currentSkillId === 'string' ? [p.currentSkillId] : [],
              detail: `${consecutiveRejected} consecutive out-of-reach read_skill jumps`,
            });
          }
          break;
        }
        default:
          break;
      }
    },

    // Convention 4 — reset on a new run.
    onRunStart(event): void {
      const runId = event.traversalContext?.runId;
      if (runId !== undefined && runId !== lastRunId) {
        reset();
        lastRunId = runId;
      }
    },

    getPath(): readonly string[] {
      const path: string[] = [];
      for (const hop of store.getAll()) {
        if (hop.toSkill !== undefined && hop.toSkill !== path[path.length - 1])
          path.push(hop.toSkill);
      }
      return path;
    },

    getHops(): readonly RouteHop[] {
      return store.getAll();
    },

    getRejections(): readonly RouteHop[] {
      return store.getAll().filter((h) => h.outcome === 'rejected');
    },

    getTrips(): readonly RouteTrip[] {
      return [...trips];
    },

    clear(): void {
      reset();
    },
  };
}
