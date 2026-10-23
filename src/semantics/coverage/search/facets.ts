/**
 * search/facets — the `checked` items one call's search covered.
 *
 * Pattern: one pure composer per list; this one is `checked`.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * A facet enters `checked` from exactly these places, and nowhere else:
 *
 *   • the declared source (`from: 'tool'`) — or, when a `source` argument is
 *     in effect, that argument: a sent value REPLACES the declared source and
 *     keeps the declared words only when it equals the declared default;
 *   • a declared fixed qualifier (`from: 'fixed'`);
 *   • a value the call sent (`from: 'call'`), or a declared default the call
 *     left out (`from: 'default'`, the value or `any`);
 *   • an argument the host filled from the run's identity (`from: 'host'`,
 *     its value by reference);
 *   • the result's own `period.queried`, when no period argument is in effect
 *     (`from: 'result'`).
 *
 * `cap`, `page`, `inert` and credential-filled arguments name no ground and
 * compose no item; an unsent argument composes a gap instead (`gaps.ts`).
 */

import type { ComposedItem, ComposedSpan } from '../composedCoverage.js';
import type { DeclaredPeriod } from '../period.js';
import { resolvedFor } from './binding.js';
import type { ArgumentReading } from './inEffect.js';
import type { ResolvedDeclaration } from './resultFacts.js';
import { relativeSpan, resultSpan } from './span.js';
import type { SearchArgument, ToolSearch } from './types.js';
import type { PeriodShapes } from '../../../time/periodForm.js';

/** What the facet composer reads. */
export interface FacetInput {
  readonly search: ToolSearch;
  /** Each classified argument with its reading, in declaration order. */
  readonly readings: ReadonlyArray<readonly [SearchArgument, ArgumentReading]>;
  readonly resolved?: readonly ResolvedDeclaration[];
  readonly resultPeriod?: DeclaredPeriod;
  readonly period?: PeriodShapes;
  readonly turnNow?: string;
}

/**
 * A value as composed text — a string as written, a number or boolean as
 * printed, anything else as its JSON. Never spread into the item.
 */
export function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Deep equality for the plain values a default may be. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  return Object.is(a, b);
}

const ROLE_FACET = { population: 'population', filter: 'filter', period: 'period' } as const;

/** The source item, or `undefined` when the source in effect is not known. */
function sourceItem(input: FacetInput): ComposedItem | undefined {
  const { search } = input;
  const declared = { what: search.source.what, facet: 'source' as const, said: search.source.said };
  const entry = input.readings.find(([a]) => a.role === 'source');
  if (entry === undefined) return { ...declared, from: 'tool' };
  const [arg, reading] = entry;
  const isDefault = (v: unknown): boolean =>
    arg.whenOmitted !== undefined && sameValue(v, arg.whenOmitted);
  switch (reading.kind) {
    case 'sent': {
      if (isDefault(reading.value)) {
        return { ...declared, argument: arg.name, value: reading.value, from: 'call', quote: true };
      }
      const words = arg.said?.[valueText(reading.value)];
      return {
        what: `${arg.name}: ${valueText(reading.value)}`,
        facet: 'source',
        argument: arg.name,
        value: reading.value,
        from: 'call',
        quote: true,
        ...(words !== undefined && { said: [...words] }),
      };
    }
    case 'default':
      return { ...declared, argument: arg.name, value: reading.value, from: 'default' };
    case 'any':
      return { ...declared, from: 'tool' };
    case 'host':
      return hostItem(arg.name, reading.identity);
    default:
      // unsent (a gap) or credential-filled (names no ground)
      return undefined;
  }
}

function hostItem(argument: string, identity: string): ComposedItem {
  return {
    what: `${argument}: the caller's ${identity}`,
    facet: 'filter',
    argument,
    value: { identity },
    from: 'host',
  };
}

/** The items one non-source argument composes — none, one, or one per list value. */
function argumentItems(
  arg: SearchArgument,
  reading: ArgumentReading,
  input: FacetInput,
): readonly ComposedItem[] {
  if (reading.kind === 'host') return [hostItem(arg.name, reading.identity)];
  if (arg.role !== 'population' && arg.role !== 'filter' && arg.role !== 'period') return [];
  const facet = ROLE_FACET[arg.role];
  if (reading.kind === 'any') {
    return [{ what: `${arg.name}: any`, facet, argument: arg.name, any: true, from: 'default' }];
  }
  if (reading.kind !== 'sent' && reading.kind !== 'default') return [];
  const from = reading.kind === 'sent' ? ('call' as const) : ('default' as const);
  const values =
    arg.role === 'population' && Array.isArray(reading.value) ? reading.value : [reading.value];
  return values.map((value: unknown): ComposedItem => {
    const words = arg.role === 'filter' ? arg.said?.[valueText(value)] : undefined;
    const resolved =
      arg.role === 'population' ? resolvedFor(arg.name, value, input.resolved) : undefined;
    const span: ComposedSpan | undefined =
      arg.role === 'period'
        ? relativeSpan(arg.name, value, input.period, input.turnNow)
        : undefined;
    return {
      what: `${arg.name}: ${valueText(value)}`,
      facet,
      argument: arg.name,
      value,
      from,
      ...((from === 'call' || resolved !== undefined) && { quote: true as const }),
      ...(resolved !== undefined && { resolved }),
      ...(words !== undefined && { said: [...words] }),
      ...(span !== undefined && { span }),
    };
  });
}

/** The period facet the RESULT declared, when no period argument is in effect. */
function resultPeriodItem(input: FacetInput): ComposedItem | undefined {
  const period = input.resultPeriod;
  if (period === undefined) return undefined;
  if (input.readings.some(([a]) => a.role === 'period')) return undefined;
  const span = resultSpan(period);
  return {
    what: `period: ${period.queried.from} to ${period.queried.to}`,
    facet: 'period',
    from: 'result',
    quote: true,
    ...(span !== undefined && { span }),
  };
}

/**
 * The `checked` items, in a fixed order: the source, the fixed qualifiers,
 * then each argument in declaration order, then a result-declared period.
 */
export function composeChecked(input: FacetInput): readonly ComposedItem[] {
  const items: ComposedItem[] = [];
  const source = sourceItem(input);
  if (source !== undefined) items.push(source);
  for (const q of input.search.fixed ?? []) {
    items.push({
      what: `${q.name}: ${valueText(q.value)}`,
      facet: 'filter',
      argument: q.name,
      value: q.value,
      from: 'fixed',
      said: [...q.said],
    });
  }
  for (const [arg, reading] of input.readings) {
    if (arg.role === 'source') continue;
    items.push(...argumentItems(arg, reading, input));
  }
  const fromResult = resultPeriodItem(input);
  if (fromResult !== undefined) items.push(fromResult);
  return items;
}
