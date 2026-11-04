import type { EntryDecl, RouteDecl, SkillRouting } from './graphRoutes.js';
import { isDeterministicRoute } from './routePredicates.js';

/** Routing provenance for a flat entry/route skill (the v1 model). */
export function routingFor(
  id: string,
  entries: readonly EntryDecl[],
  routes: readonly RouteDecl[],
): SkillRouting {
  const entry = entries.find((e) => e.id === id);
  if (entry)
    return {
      via: 'entry',
      ...(entry.label && { label: entry.label }),
      ...(entry.match && { match: entry.match }),
    };

  const incoming = routes.filter(isDeterministicRoute).filter((r) => r.toId === id);
  const first = incoming[0];
  if (first) {
    return {
      via: 'route',
      from: first.fromId,
      ...(first.label && { label: first.label }),
      triggerKind: first.onToolReturn && !first.onToolStatus ? 'on-tool-return' : 'rule',
      ...(first.guard && { guard: first.guard.data }),
    };
  }
  return { via: 'model' }; // model-reachable via read_skill
}
