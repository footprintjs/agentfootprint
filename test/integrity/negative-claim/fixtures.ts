/**
 * Synthetic fixtures for the negative-claim checker — the design note's § 3.1 tool
 * (`list_incidents`), its § 3.2 composed rows, a sibling tool (`list_changes`) and an
 * `among` inventory tool (`get_capacity`). Every value here is invented.
 *
 * The turn's clock is 2026-10-22T10:00:00Z, so the `2h` default window is 08:00–10:00Z. The rows
 * are #199's `ComposedCoverage`, field for field: a period item carries the span the window
 * resolved to at DISPATCH (`time/range.ts` · `lookbackRange`, half-open), beside its spelling.
 */
import type {
  ComposedCoverage,
  ComposedItem,
  CoverageGap,
} from '../../../src/semantics/coverage/composedCoverage.js';
import type {
  SearchTool,
  TurnCall,
  TurnRecord,
} from '../../../src/integrity/negative-claim/types.js';
import { lookbackRange } from '../../../src/time/range.js';

export const CLOCK = '2026-10-22T10:00:00Z';

export const EMAIL_GAP: CoverageGap = {
  kind: 'scope',
  what: 'incidents filed by email',
  why: 'they never enter the store',
  bears: 'source',
};

/** § 3.1, field for field (the words the checker reads). */
export const LIST_INCIDENTS: SearchTool = {
  name: 'list_incidents',
  search: {
    source: { what: 'the incident store', said: ['the incident store', 'the store'] },
    subject: { what: 'incidents', said: ['incident', 'incidents'] },
    fixed: [{ name: 'status', value: 'open', said: ['open'] }],
    arguments: [
      { name: 'service', role: 'population' },
      {
        name: 'severity',
        role: 'filter',
        whenOmitted: { any: true },
        said: { critical: ['critical', 'sev1'] },
      },
      { name: 'window', role: 'period', whenOmitted: '2h' },
      { name: 'limit', role: 'cap', whenOmitted: 200 },
      { name: 'page', role: 'page' },
      { name: 'format', role: 'inert' },
    ],
    complete: 'within-arguments',
  },
};

/** A sibling tool on the same population and a different subject. */
export const LIST_CHANGES: SearchTool = {
  name: 'list_changes',
  search: {
    source: { what: 'the change log', said: ['the change log'] },
    subject: { what: 'changes', said: ['change', 'changes'] },
    arguments: [{ name: 'service', role: 'population' }],
    complete: 'within-arguments',
  },
};

/** An inventory the `among` door reads (§ 3.3). */
export const GET_CAPACITY: SearchTool = {
  name: 'get_capacity',
  search: {
    source: { what: 'the array inventory export', said: ['the inventory export'] },
    subject: { what: 'arrays', said: ['array', 'arrays'] },
    arguments: [{ name: 'array_id', role: 'population' }],
    complete: 'within-arguments',
  },
};

export const TOOLS: Readonly<Record<string, SearchTool>> = {
  list_incidents: LIST_INCIDENTS,
  list_changes: LIST_CHANGES,
  get_capacity: GET_CAPACITY,
};

const RESOLVED_PAYMENTS = { id: 'payments', name: 'Payments', aliases: ['pay-svc'] };

export interface IncidentRowOptions {
  readonly id?: string;
  readonly service?: string;
  readonly severity?: string;
  readonly window?: string;
  readonly kind?: 'absence' | 'ledger';
  readonly composed?: 'local' | 'remote';
  readonly complete?: boolean;
  readonly gaps?: readonly CoverageGap[];
  readonly held?: { from: string; to: string } | 'unknown' | 'none';
  readonly overclaim?: readonly string[];
  /** The page the call asked for — an argument; #199 composes no page item. */
  readonly page?: number;
  readonly runId?: string;
  /** When the call ran — its window's span is resolved there. */
  readonly dispatchedAt?: string;
}

/** § 3.2's row for `list_incidents` (#199's `ComposedCoverage`), with the options a test varies. */
export function incidentRow(options: IncidentRowOptions = {}): ComposedCoverage {
  const service = options.service ?? 'payments';
  const window = options.window ?? '2h';
  const id = options.id ?? 'c1';
  const checked: ComposedItem[] = [
    { what: 'incidents', facet: 'subject', from: 'tool', said: ['incident', 'incidents'] },
    {
      what: 'the incident store',
      facet: 'source',
      from: 'tool',
      said: ['the incident store', 'the store'],
    },
    {
      what: 'status: open',
      facet: 'filter',
      argument: 'status',
      value: 'open',
      from: 'fixed',
      said: ['open'],
    },
    {
      what: `service: ${service}`,
      facet: 'population',
      argument: 'service',
      value: service,
      from: 'call',
      quote: true,
      ...(service === 'payments'
        ? { resolved: RESOLVED_PAYMENTS }
        : { resolved: { id: service, name: service } }),
    },
    options.severity === undefined
      ? { what: 'severity: any', facet: 'filter', argument: 'severity', any: true, from: 'default' }
      : {
          what: `severity: ${options.severity}`,
          facet: 'filter',
          argument: 'severity',
          value: options.severity,
          from: 'call',
          quote: true,
          ...(options.severity === 'critical' ? { said: ['critical', 'sev1'] } : {}),
        },
    {
      what: `window: ${window}`,
      facet: 'period',
      argument: 'window',
      value: window,
      from: options.window === undefined ? 'default' : 'call',
      span: lookbackRange(options.dispatchedAt ?? CLOCK, window, 'mhdw'),
    },
  ];
  const queried =
    window === '7d'
      ? { from: '2026-10-15T10:00:00Z', to: CLOCK }
      : { from: '2026-10-22T08:00:00Z', to: CLOCK };
  const held =
    options.held === undefined ? { from: '2026-09-22T10:00:00Z', to: CLOCK } : options.held;
  return {
    kind: options.kind ?? 'absence',
    toolName: 'list_incidents',
    toolCallId: id,
    iteration: 1,
    composed: options.composed ?? 'local',
    resultId: rid(id, options.runId),
    handle: `r${ordinalOf(id)}`,
    lookedFor: `open incidents on ${service}`,
    checked,
    notChecked: [],
    cannotCover: [],
    complete: options.complete ?? true,
    gaps: options.gaps ?? [EMAIL_GAP],
    ...(held === 'none' ? {} : { period: { queried, held } }),
    ...(options.overclaim === undefined ? {} : { overclaim: options.overclaim }),
  };
}

export const NAMESPACE = 'bench-ns';
export const RUN = 'run-1';

/**
 * The library-minted result identity of a fixture call (`claim-result/<ns>/<runId>/<ordinal>`),
 * from its short name: `c1` → ordinal 1, `k1` → 101, `w1` → 201, `d1` → 301.
 */
export function rid(id: string, runId = RUN): string {
  return `claim-result/${NAMESPACE}/${runId}/${ordinalOf(id)}`;
}

/** The ordinal behind {@link rid}; also each fixture call's own batch unless a test says otherwise. */
export function ordinalOf(id: string): number {
  const offset: Record<string, number> = { c: 0, k: 100, w: 200, d: 300 };
  return (offset[id[0] ?? 'c'] ?? 400) + Number(id.slice(1));
}

export interface CallOptions extends IncidentRowOptions {
  readonly outcome?: TurnCall['outcome'];
  readonly emptiness?: TurnCall['emptiness'];
  readonly rows?: number;
  readonly rowsRead?: TurnCall['rowsRead'];
  readonly turn?: number;
  readonly runId?: string;
  readonly batch?: number;
  readonly dispatched?: boolean;
  readonly noRow?: boolean;
  readonly noScope?: boolean;
  readonly keptOut?: boolean;
  readonly readAt?: string;
  /** The caller's effect class for the call; `null` leaves it undeclared. */
  readonly effect?: 'read' | 'not-read' | null;
}

/** One `list_incidents` call as the record holds it. */
export function incidentCall(options: CallOptions = {}): TurnCall {
  const id = options.id ?? 'c1';
  const args: Record<string, unknown> = { service: options.service ?? 'payments' };
  if (options.severity !== undefined) args.severity = options.severity;
  if (options.window !== undefined) args.window = options.window;
  if (options.page !== undefined) args.page = options.page;
  const outcome = options.outcome ?? 'ok';
  const emptiness = outcome === 'ok' ? options.emptiness ?? 'declared-absent' : undefined;
  const read = outcome === 'ok' && options.noRow !== true;
  const scope = incidentRow({ ...options, id }).checked;
  return {
    resultId: rid(id, options.runId),
    toolCallId: id,
    toolName: 'list_incidents',
    turn: options.turn ?? 1,
    ...(options.effect === null ? {} : { effect: options.effect ?? 'read' }),
    batch: options.batch ?? ordinalOf(id),
    dispatched: options.dispatched ?? outcome !== 'not-run',
    outcome,
    arguments: args,
    ...(emptiness === undefined ? {} : { emptiness }),
    ...(options.rows === undefined ? {} : { rows: options.rows }),
    ...(options.rowsRead === undefined ? {} : { rowsRead: options.rowsRead }),
    ...(read || options.noScope === true ? {} : { scope }),
    ...(read
      ? {
          row: incidentRow({
            ...options,
            id,
            kind: emptiness === 'non-empty' ? 'ledger' : options.kind ?? 'absence',
          }),
        }
      : {}),
    ...(options.keptOut === true ? { keptOut: true as const } : {}),
    ...(options.readAt === undefined ? {} : { readAt: options.readAt }),
  };
}

/** A `list_changes(payments)` call that returned rows. */
export function changesCall(id = 'k1', turn = 1): TurnCall {
  return {
    resultId: rid(id),
    toolCallId: id,
    toolName: 'list_changes',
    turn,
    effect: 'read',
    batch: ordinalOf(id),
    dispatched: true,
    outcome: 'ok',
    arguments: { service: 'payments' },
    emptiness: 'non-empty',
    rows: 2,
    row: {
      kind: 'ledger',
      toolName: 'list_changes',
      toolCallId: id,
      iteration: 1,
      composed: 'local',
      resultId: rid(id),
      handle: `r${ordinalOf(id)}`,
      notChecked: [],
      cannotCover: [],
      checked: [
        { what: 'changes', facet: 'subject', from: 'tool', said: ['change', 'changes'] },
        { what: 'the change log', facet: 'source', from: 'tool', said: ['the change log'] },
        {
          what: 'service: payments',
          facet: 'population',
          argument: 'service',
          value: 'payments',
          from: 'call',
          quote: true,
          resolved: RESOLVED_PAYMENTS,
        },
      ],
      complete: true,
      gaps: [],
    },
  };
}

/** An `among` absence (§ 3.3): the name resolved to nothing in a 14-name export. */
export function amongCall(
  options: { id?: string; authoritative?: boolean; name?: string } = {},
): TurnCall {
  const id = options.id ?? 'c4';
  const name = options.name ?? 'ARRAY-X9';
  const source = 'the array inventory export';
  return {
    resultId: rid(id),
    toolCallId: id,
    toolName: 'get_capacity',
    turn: 1,
    effect: 'read',
    batch: ordinalOf(id),
    dispatched: true,
    outcome: 'ok',
    arguments: { array_id: name },
    emptiness: 'declared-absent',
    row: {
      kind: 'absence',
      toolName: 'get_capacity',
      toolCallId: id,
      iteration: 1,
      composed: 'local',
      resultId: rid(id),
      handle: `r${ordinalOf(id)}`,
      notChecked: [],
      cannotCover: [],
      lookedFor: name,
      checked: [
        { what: 'arrays', facet: 'subject', from: 'tool', said: ['array', 'arrays'] },
        { what: source, facet: 'source', from: 'tool', said: ['the inventory export'] },
        {
          what: `array_id: ${name}`,
          facet: 'population',
          argument: 'array_id',
          value: name,
          from: 'call',
          quote: true,
        },
        {
          what: 'array names',
          facet: 'names',
          count: 14,
          source,
          measuredAt: '2026-10-22T09:14:00Z',
          from: 'result',
        },
      ],
      complete: true,
      gaps:
        options.authoritative === true
          ? []
          : [{ kind: 'scope', what: `names outside ${source}`, bears: 'source' }],
    },
  };
}

/**
 * A call the caller does not classify as a read — the agent filed an incident. Its effect class
 * is left undeclared, which counts as `not-read`. `dispatched` says whether it was handed to
 * `execute` (a schema refusal never was).
 */
export function writeCall(
  id = 'w1',
  options: {
    outcome?: TurnCall['outcome'];
    turn?: number;
    dispatched?: boolean;
    batch?: number;
  } = {},
): TurnCall {
  const outcome = options.outcome ?? 'ok';
  return {
    resultId: rid(id),
    toolCallId: id,
    toolName: 'create_incident',
    turn: options.turn ?? 1,
    batch: options.batch ?? ordinalOf(id),
    dispatched: options.dispatched ?? outcome !== 'not-run',
    outcome,
    arguments: { service: 'payments' },
  };
}

/** The turn's record around some calls. */
export function turnRecord(
  calls: readonly TurnCall[],
  options: { turn?: number; ledgerComplete?: boolean; clock?: string; runId?: string } = {},
): TurnRecord {
  return {
    leg: { namespace: NAMESPACE, runId: options.runId ?? RUN },
    turn: options.turn ?? 1,
    clock: options.clock ?? CLOCK,
    calls,
    ledgerComplete: options.ledgerComplete ?? true,
    tools: TOOLS,
  };
}
