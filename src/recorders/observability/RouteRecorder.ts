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
 * Role:    Tier-3 /observe recorder — `Agent.create(...).recorder(routeRecorder())`.
 *          Powers the lens, the "Why this skill?" panel, and paper route figures.
 */

import type { EmitEvent } from 'footprintjs';
import { SequenceStore } from 'footprintjs/trace';

interface RunBoundaryEvent {
  readonly traversalContext?: { readonly runId?: string };
}

/** How the graph arrived at a skill on a hop. */
export type RouteOutcome = 'entry' | 'route' | 'stay' | 'rejected';

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

  const reset = (): void => {
    store.clear();
    trips.length = 0;
    transitions.length = 0;
    cursor = undefined;
    lastTool = undefined;
    consecutiveRejected = 0;
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
          const outcome: RouteOutcome =
            cursor === undefined ? 'entry' : cur.id !== cursor ? 'route' : 'stay';
          const hop: RouteHop = {
            runtimeStageId: event.runtimeStageId,
            iteration,
            ...(from !== undefined ? { fromSkill: from } : {}),
            toSkill: cur.id,
            outcome,
            why: '',
            ...(cur.label !== undefined ? { edgeLabel: cur.label } : {}),
            ...(outcome === 'route' && lastTool !== undefined ? { lastTool } : {}),
          };
          const finished = { ...hop, why: formatRouteHop(hop) };
          store.push(finished);
          if (outcome !== 'stay') {
            transitions.push(cur.id);
            detectPingPong(iteration);
          }
          cursor = cur.id;
          consecutiveRejected = 0; // a successful evaluation breaks a rejection run
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
          if (
            consecutiveRejected >= maxRejectedRetries &&
            !trips.some((t) => t.kind === 'rejected-cap' && t.iteration === iteration)
          ) {
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
