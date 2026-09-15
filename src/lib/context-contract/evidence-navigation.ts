/** An application-declared evidence gap, not a model claim or a diagnosis. */
export interface EvidenceNeed {
  readonly id: string;
  readonly description: string;
}
/** A potential destination. Registration is neither access permission nor proof of data availability. */
export interface EvidenceRoute {
  readonly id: string;
  readonly need: string;
  readonly destination: string;
  readonly description: string;
  readonly requiredInputs: readonly string[];
}
export interface EvidenceNeedResolution {
  readonly need: EvidenceNeed;
  readonly status: 'not_configured' | 'no_matching_route' | 'matched';
  readonly routes: readonly (EvidenceRoute & {
    readonly status: 'needs_input' | 'proposed';
    readonly missingInputs: readonly string[];
  })[];
}

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new TypeError(
      'Evidence declarations require nonempty strings of at most 512 characters.',
    );
  }
}
function names(value: readonly string[]): void {
  if (!Array.isArray(value) || value.length > 16 || new Set(value).size !== value.length) {
    throw new TypeError('Evidence input names must be a unique array of at most 16 strings.');
  }
  value.forEach(text);
}

/**
 * Pure, opt-in exact-ID lookup over trusted application declarations. No I/O,
 * semantic matching, authorization, source probing, execution or recovery loop.
 * The app validates which input names are actually satisfied for the current
 * scope. Missing configuration is not evidence of absence outside this map.
 */
export function resolveEvidenceNeed(
  need: EvidenceNeed,
  routes?: readonly EvidenceRoute[],
  availableInputs: readonly string[] = [],
): EvidenceNeedResolution {
  text(need?.id);
  text(need?.description);
  names(availableInputs);
  if (routes !== undefined && (!Array.isArray(routes) || routes.length > 16)) {
    throw new TypeError('An evidence route map contains at most 16 declarations.');
  }
  const ids = new Set<string>();
  for (const route of routes ?? []) {
    text(route?.id);
    text(route?.need);
    text(route?.destination);
    text(route?.description);
    names(route.requiredInputs);
    if (ids.has(route.id)) throw new TypeError('Evidence route IDs must be unique.');
    ids.add(route.id);
  }
  const matching = (routes ?? [])
    .filter((route) => route.need === need.id)
    .map((route) => {
      const missingInputs = Object.freeze(
        route.requiredInputs.filter((name: string) => !availableInputs.includes(name)),
      );
      return Object.freeze({
        id: route.id,
        need: route.need,
        destination: route.destination,
        description: route.description,
        requiredInputs: Object.freeze([...route.requiredInputs]),
        missingInputs,
        status: missingInputs.length ? ('needs_input' as const) : ('proposed' as const),
      });
    });
  return Object.freeze({
    need: Object.freeze({ id: need.id, description: need.description }),
    status:
      routes === undefined ? 'not_configured' : matching.length ? 'matched' : 'no_matching_route',
    routes: Object.freeze(matching),
  });
}
