import type { RouteDecl, SkillRouteOptions } from './graphRoutes.js';
import type { Injection } from '../types.js';
import type { ToolResultStatus } from '../../semantics/toolOutcome.js';

/** A route edge that fires on its own evidence — `when` code, a tool-name
 *  match, a declared status, or a data guard. NOT a model edge. The ONE
 *  predicate every determinism filter shares (9.19.0 folded four replicas
 *  into it when `onToolStatus` joined the family; `guard` joined in 9.51.0). */
export function isDeterministicRoute(r: RouteDecl): boolean {
  return (
    r.when !== undefined ||
    r.onToolReturn !== undefined ||
    r.onToolStatus !== undefined ||
    r.guard !== undefined
  );
}

/** The declared status set, normalized to an array. */
export function statusesOf(
  onToolStatus: NonNullable<SkillRouteOptions['onToolStatus']>,
): ReadonlyArray<string> {
  return Array.isArray(onToolStatus) ? onToolStatus : [onToolStatus as string];
}

function toolMatcher(toolName: string | RegExp): (name: string) => boolean {
  return typeof toolName === 'string' ? (n) => n === toolName : (n) => toolName.test(n);
}

/** How a skill is identified back to its author in a refusal — the description is
 *  what tells two same-id skills apart (mirrors skillsFromDir naming both files). */
export function describe(skill: Injection): string {
  return skill.description ?? '(no description)';
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Does a single route edge fire for ONE tool result of the batch?
 *  `onToolStatus` matches the result's DECLARED status (composed with the
 *  tool name when `onToolReturn` is also set — a result with no status can
 *  never match a status edge); `onToolReturn` alone matches the tool NAME;
 *  `when` runs the predicate over the result (same `{ toolName, result }`
 *  shape it has always received, plus `status` when declared). The caller
 *  walks the batch in call order (9.16.0) — before that, only
 *  `ctx.lastToolResult` was ever offered here. */
export function routeMatches(
  r: RouteDecl,
  res: {
    readonly toolName: string;
    readonly result: string;
    readonly status?: ToolResultStatus;
  },
): boolean {
  if (!edgePreconditionsPass(r, res)) return false;
  if (r.onToolStatus !== undefined || r.onToolReturn !== undefined) return true;
  return r.when ? r.when(res) : false;
}

/** The tool/status PRECONDITIONS of one edge against one result — the part a
 *  `guard` is judged AFTER (9.51.0). True when the edge declares neither.
 *  Split out of `routeMatches` because the resolver dispatches guard edges
 *  itself: the guard's evidence must be collected at the very statement that
 *  decides the hop, and "the guard decided" is only true once these passed. */
export function edgePreconditionsPass(
  r: RouteDecl,
  res: {
    readonly toolName: string;
    readonly status?: ToolResultStatus;
  },
): boolean {
  if (r.onToolStatus !== undefined) {
    if (res.status === undefined || !statusesOf(r.onToolStatus).includes(res.status)) {
      return false;
    }
    return r.onToolReturn ? toolMatcher(r.onToolReturn)(res.toolName) : true;
  }
  if (r.onToolReturn) return toolMatcher(r.onToolReturn)(res.toolName);
  return true;
}
