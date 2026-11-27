import type { DeclaredToolFailureRecord } from '../../../../../provider-contract/toolResultRecord.js';
import { coverageWordFragment } from '../../../../../semantics/coverage/items.js';
import { isPlaceholder } from '../../../../../redaction/marker.js';
import { namedCalls } from '../../../../../lib/displayName.js';

type Advice = DeclaredToolFailureRecord['tryInstead'];

function matchingAdvice(admitted: Advice, retained: Advice): Advice {
  if (typeof admitted === 'string') return retained === admitted ? retained : undefined;
  return admitted?.omitted === true && typeof retained === 'object' && retained.omitted === true
    ? retained
    : undefined;
}

export function retainedDeclaredFailure(
  admitted: DeclaredToolFailureRecord | undefined,
  retained: DeclaredToolFailureRecord | undefined,
): DeclaredToolFailureRecord | undefined {
  if (admitted === undefined || retained?.declaredCategory !== admitted.declaredCategory)
    return undefined;
  const notChecked = matchingAdvice(admitted.notChecked, retained.notChecked);
  const tryInstead = matchingAdvice(admitted.tryInstead, retained.tryInstead);
  return {
    origin: 'declared',
    declaredCategory: admitted.declaredCategory,
    ...(notChecked !== undefined && { notChecked }),
    ...(tryInstead !== undefined && { tryInstead }),
  };
}

const KIND = {
  timeout: 'a timeout',
  'rate-limited': 'a rate limit',
  server: 'a server error',
  network: 'a network error',
  auth: 'an access failure',
  permanent: 'a non-retryable failure',
  unknown: 'a failure without a known category',
} satisfies Record<DeclaredToolFailureRecord['declaredCategory'], string>;

function adviceText(advice: Advice): string | undefined {
  if (typeof advice !== 'string' || isPlaceholder(advice)) return undefined;
  return coverageWordFragment(advice);
}

export function declaredFailureClauses(
  calls: readonly {
    readonly toolName: string;
    readonly declaredFailure?: DeclaredToolFailureRecord;
  }[],
  evicted: readonly DeclaredToolFailureRecord[],
  nameOf: (tool: string) => string | undefined,
): string[] {
  const clauses: string[] = [];
  let adviceUsed = false;
  for (const category of Object.keys(KIND) as (keyof typeof KIND)[]) {
    const named = calls.filter((call) => call.declaredFailure?.declaredCategory === category);
    const unplaced = evicted.filter((fact) => fact.declaredCategory === category);
    if (named.length + unplaced.length === 0) continue;
    const who =
      namedCalls(named, unplaced.length, nameOf) ??
      (named.length + unplaced.length === 1 ? 'a call' : 'calls');
    clauses.push(`${who} reported ${KIND[category]}`);
    if (adviceUsed) continue;
    // Advice belongs to one call. Keep one short clause, with its own display name.
    const advised = named.find(
      ({ declaredFailure }) =>
        declaredFailure !== undefined &&
        (adviceText(declaredFailure.notChecked) !== undefined ||
          adviceText(declaredFailure.tryInstead) !== undefined),
    );
    const detail = advised?.declaredFailure;
    if (detail === undefined || advised === undefined) continue;
    const source = nameOf(advised.toolName) ?? 'a call that reported the failure';
    const unchecked = adviceText(detail.notChecked);
    const retry = adviceText(detail.tryInstead);
    const advice = [
      unchecked === undefined ? undefined : `did not check ${unchecked}`,
      retry === undefined ? undefined : `suggested ${retry}`,
    ].filter(Boolean);
    if (advice.length > 0) {
      clauses.push(`${source} ${advice.join(' and ')}`);
      adviceUsed = true;
    }
  }
  return clauses;
}
