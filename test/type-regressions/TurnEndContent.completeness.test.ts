/**
 * Compile-level completeness, then one turn through every exporter that passes
 * `agent.turn_end` on: every field of the payload is classified as content or
 * record, and a content field reaches an exporter's output ONLY where that
 * exporter is declared to carry it.
 *
 * Content is what a person, the model, a tool or the data wrote: the answer,
 * a tool's coverage sentences, a value an `assume` rule filled, a negative's
 * statement. Record is the library's own words, counts and ids, and the names
 * an app declared.
 *
 * `{ [K in keyof AgentTurnEndPayload]-?: … }` is exhaustive by type: a field
 * added to `turn_end` later is a compile error here (`npm run test:types`)
 * until it is classified. A content field then needs a canary (`CANARY_OF`),
 * and the run below fails for every exporter that passes it on without
 * bounding it — so a new content field cannot slip through unbounded.
 *
 * Two content fields hold the record's own words beside the content: a typed
 * answer's limits (`answerCoverage`) and its negatives (`answerNegatives`).
 * They are classified one level down, shape by shape, each table exhaustive
 * by type the same way. Their canary fills EVERY content leaf (each leaf its
 * own canary, under the field's), and the audit chain must keep every record
 * leaf exactly as it was.
 *
 * The exporters that pass `turn_end` on: the audit chain in its default
 * `payloadMode: 'bounded'` (`adapters/observability/audit.ts` ·
 * `BOUND_FIELDS`), OpenTelemetry with and without `captureContent`, X-Ray, the
 * AG-UI serializer and the bug-report transcript. The audit chain's
 * `payloadMode: 'verbatim'`, the file sink and the CloudWatch and AgentCore
 * sinks ship every payload whole by contract (each says so in its header) and
 * bound nothing, so they are not listed.
 */
import { describe, expect, it } from 'vitest';

import { auditExport } from '../../src/adapters/observability/audit';
import {
  otelObservability,
  type OtelAttributeValue,
  type OtelTracerLike,
} from '../../src/adapters/observability/otel';
import { xrayObservability } from '../../src/adapters/observability/xray';
import { agUiSerializer } from '../../src/ag-ui/serializer';
import { deriveTranscript } from '../../src/bug-report/transcript';
import type { RuntimeNegativeRow } from '../../src/core/agent/negativeClaims/delivery';
import type {
  AgentTurnEndPayload,
  AnswerNegativesPayload,
  CoverageItemPayload,
  DeliveredNegative,
} from '../../src/events/payloads';
import type { AgentfootprintEvent } from '../../src/events/registry';
import type { AnswerCoverage, AnswerInProgress, InProgressItem } from '../../src/index';

export type FieldKind = 'content' | 'record';

/** Every field of `T`, classified — a field added to `T` is a compile error until it is. */
type Classified<T> = { readonly [K in keyof T]-?: FieldKind };

export const TURN_END_FIELDS = {
  turnIndex: 'record',
  finalContent: 'content',
  totalInputTokens: 'record',
  totalOutputTokens: 'record',
  iterationCount: 'record',
  durationMs: 'record',
  stoppedEarly: 'record',
  // A tool's coverage sentences, the instants a period declared, and the
  // argument values an `assume` rule filled — beside ids, names and counts.
  answerCoverage: 'content',
  // "never a value or a quote": the standing, its reason kinds and checks.
  answerAssessment: 'record',
  // The app's declared display names.
  standingLineNames: 'record',
  // Statements naming the population a search covered — beside codes and ids.
  answerNegatives: 'content',
  refused: 'record',
} as const satisfies Classified<AgentTurnEndPayload>;

// ── One level down: the shapes inside `answerCoverage` ──────────────────────

/** One declared period, as a typed answer's limits carry it. */
type AnswerPeriod = NonNullable<AnswerCoverage['periods']>[number];
/** One value an `assume` rule filled. */
type AssumedValue = NonNullable<AnswerCoverage['assumed']>[number];

/** `checked` / `notChecked` / `cannotCover`: the tool author's prose, and its kind. */
export const COVERAGE_ITEM_FIELDS = {
  what: 'content',
  why: 'content',
  short: 'content',
  kind: 'record',
} as const satisfies Classified<CoverageItemPayload>;

/** `periods`: the tool and its call, and the instants the tool declared. `held`
 *  may also be the library's word `'unknown'`, which is record. */
export const PERIOD_FIELDS = {
  toolName: 'record',
  toolCallId: 'record',
  queried: 'content',
  held: 'content',
  readAt: 'content',
} as const satisfies Classified<AnswerPeriod>;

/** `inProgress`: the tool and its call, and what its read found still running. */
export const IN_PROGRESS_FIELDS = {
  toolName: 'record',
  toolCallId: 'record',
  items: 'content',
} as const satisfies Classified<AnswerInProgress>;

/** One in-progress item: the tool author's prose, and how many things it stands for. */
export const IN_PROGRESS_ITEM_FIELDS = {
  what: 'content',
  why: 'content',
  short: 'content',
  count: 'record',
} as const satisfies Classified<InProgressItem>;

/** `assumed`: the tool and the argument NAME are record; the value it filled is content. */
export const ASSUMED_FIELDS = {
  toolName: 'record',
  argument: 'record',
  value: 'content',
  hidden: 'record',
} as const satisfies Classified<AssumedValue>;

// ── One level down: the shapes inside `answerNegatives` ─────────────────────

/** One check row as it rides: the payload's fields, and the runtime row's
 *  `staleSince` (when the cited read ran — the library's own clock). */
type NegativeCheck = AnswerNegativesPayload['checks'][number] & RuntimeNegativeRow;

/** The negatives themselves: the answer field's declared name, codes, verdicts and lists. */
export const ANSWER_NEGATIVES_FIELDS = {
  field: 'record',
  version: 'record',
  delivery: 'record',
  claims: 'content',
  checks: 'record',
  coverage: 'record',
  actions: 'record',
} as const satisfies Classified<AnswerNegativesPayload>;

/** One delivered negative: its statement and the population it is about are content. */
export const NEGATIVE_CLAIM_FIELDS = {
  kind: 'record',
  about: 'content',
  restsOn: 'record',
  statement: 'content',
  delivery: 'record',
  version: 'record',
} as const satisfies Classified<DeliveredNegative>;

/** One check row: identities and codes only (the typed row's own contract). */
export const NEGATIVE_CHECK_FIELDS = {
  id: 'record',
  path: 'record',
  index: 'record',
  kind: 'record',
  notes: 'record',
  code: 'record',
  disposition: 'record',
  tools: 'record',
  results: 'record',
  staleSince: 'record',
} as const satisfies Classified<NegativeCheck>;

type ContentField = {
  [K in keyof typeof TURN_END_FIELDS]: (typeof TURN_END_FIELDS)[K] extends 'content' ? K : never;
}[keyof typeof TURN_END_FIELDS];

/** One leaf's canary: the field's canary, then where the leaf sits. */
const leaf = (canary: string, at: string): string => `${canary}/${at}`;

/** Every field of one coverage item; its content holds `canary`. */
const coverageItem = (canary: string, list: string): Required<CoverageItemPayload> => ({
  what: leaf(canary, `${list}[].what`),
  why: leaf(canary, `${list}[].why`),
  short: leaf(canary, `${list}[].short`),
  kind: 'scope',
});

/** Every field of every shape a typed answer's limits hold; the content holds `canary`. */
function coverageWith(canary: string): Required<AnswerCoverage> {
  const period: Required<AnswerPeriod> = {
    toolName: 'orders_search',
    toolCallId: 'call-1',
    queried: {
      from: leaf(canary, 'periods[].queried.from'),
      to: leaf(canary, 'periods[].queried.to'),
    },
    held: { from: leaf(canary, 'periods[].held.from'), to: leaf(canary, 'periods[].held.to') },
    readAt: leaf(canary, 'periods[].readAt'),
  };
  const item: Required<InProgressItem> = {
    what: leaf(canary, 'inProgress[].items[].what'),
    why: leaf(canary, 'inProgress[].items[].why'),
    short: leaf(canary, 'inProgress[].items[].short'),
    count: 96,
  };
  const inProgress: Required<AnswerInProgress> = {
    toolName: 'orders_search',
    toolCallId: 'call-1',
    items: [item],
  };
  const assumed: AssumedValue = {
    toolName: 'orders_search',
    argument: 'region',
    value: leaf(canary, 'assumed[].value'),
    hidden: false,
  };
  return {
    checked: [coverageItem(canary, 'checked')],
    notChecked: [coverageItem(canary, 'notChecked')],
    cannotCover: [coverageItem(canary, 'cannotCover')],
    periods: [period],
    inProgress: [inProgress],
    assumed: [assumed],
  };
}

/** Every field of every shape the negatives hold; the content holds `canary`. */
function negativesWith(canary: string): Required<AnswerNegativesPayload> {
  const claim: Required<DeliveredNegative> = {
    kind: 'none',
    about: leaf(canary, 'claims[].about'),
    restsOn: ['r1'],
    statement: leaf(canary, 'claims[].statement'),
    delivery: 'record-composed',
    version: '2',
  };
  const check: Required<NegativeCheck> = {
    id: 'agent:negative-claims:negatives#0',
    path: 'negatives[0]',
    index: 0,
    kind: 'none',
    notes: ['absence-kind-normalized'],
    code: 'stale-turn',
    disposition: 'unreachable',
    tools: ['orders_search'],
    results: ['claim-result/ns/run-1/1'],
    staleSince: { turn: 1, readAt: '2026-10-29T09:00:00.000Z' },
  };
  return {
    field: 'negatives',
    version: '2',
    delivery: 'recorded',
    claims: [claim],
    checks: [check],
    coverage: [{ tool: 'orders_search', checked: 1 }],
    actions: [{ tool: 'refund_order', outcome: 'not-run' }],
  };
}

/** A value of each content field with `canary` where its content sits. */
const CANARY_OF: {
  readonly [K in ContentField]-?: (canary: string) => NonNullable<AgentTurnEndPayload[K]>;
} = {
  finalContent: (canary) => `The total is ${canary}.`,
  answerCoverage: coverageWith,
  answerNegatives: negativesWith,
};

const CONTENT_FIELDS = Object.keys(CANARY_OF) as ContentField[];
const canaryOf = (field: ContentField): string => `CANARY-${field}-7f3a`;

/** Every leaf canary one turn carries, by field. */
function leafCanaries(field: ContentField): string[] {
  const text = JSON.stringify(CANARY_OF[field](canaryOf(field)));
  const pattern = new RegExp(`${canaryOf(field)}[^"]*`, 'g');
  return [...new Set(text.match(pattern) ?? [])];
}

let clock = 1_000;
function event(type: string, payload: Record<string, unknown>): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: clock++,
      runOffsetMs: 0,
      runtimeStageId: 'stage#1',
      subflowPath: [],
      compositionPath: [],
      runId: 'run-content-1',
    },
  } as unknown as AgentfootprintEvent;
}

/** One turn whose `turn_end` holds every content field, each with its own canary. */
function oneTurn(): readonly AgentfootprintEvent[] {
  const content = Object.fromEntries(
    CONTENT_FIELDS.map((field) => [field, CANARY_OF[field](canaryOf(field))]),
  );
  return [
    event('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: 'total?' }),
    event('agentfootprint.agent.turn_end', {
      turnIndex: 0,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      iterationCount: 1,
      durationMs: 3,
      ...content,
    }),
  ];
}

function tracer(spans: unknown[]): OtelTracerLike {
  return {
    startSpan(name, options) {
      const span = {
        name,
        attributes: { ...(options?.attributes ?? {}) } as Record<string, OtelAttributeValue>,
        events: [] as unknown[],
      };
      spans.push(span);
      return {
        setAttribute: (key, value) => {
          span.attributes[key] = value;
          return undefined;
        },
        setStatus: () => undefined,
        end: () => undefined,
        spanContext: () => ({ traceId: 't', spanId: `s${spans.length}`, traceFlags: 1 }),
        addEvent: (eventName, attributes) => {
          span.events.push({ name: eventName, attributes });
          return undefined;
        },
      };
    },
  };
}

interface Exporter {
  readonly name: string;
  /** The content fields its output carries — each with the reason it may. */
  readonly carries: readonly ContentField[];
  /** Everything it wrote for the turn, as one string. */
  readonly output: (events: readonly AgentfootprintEvent[]) => Promise<string>;
}

/** The bounded audit chain's whole bundle for `events`. */
function auditBundle(events: readonly AgentfootprintEvent[]) {
  const audit = auditExport();
  for (const e of events) audit.exportEvent(e);
  return audit.bundle();
}

const EXPORTERS: readonly Exporter[] = [
  {
    name: 'audit chain (bounded)',
    // Every content field is bounded: the answer whole, a typed answer's
    // limits and negatives at each content leaf.
    carries: [],
    output: async (events) => JSON.stringify(auditBundle(events)),
  },
  {
    name: 'OpenTelemetry',
    carries: [],
    output: async (events) => {
      const spans: unknown[] = [];
      const strategy = otelObservability({ serviceName: 'svc', tracer: tracer(spans) });
      for (const e of events) strategy.exportEvent(e);
      return JSON.stringify(spans);
    },
  },
  {
    name: 'OpenTelemetry (captureContent)',
    // The turn's answer is the output `captureContent` opts into.
    carries: ['finalContent'],
    output: async (events) => {
      const spans: unknown[] = [];
      const strategy = otelObservability({
        serviceName: 'svc',
        tracer: tracer(spans),
        captureContent: true,
      });
      for (const e of events) strategy.exportEvent(e);
      return JSON.stringify(spans);
    },
  },
  {
    name: 'X-Ray',
    carries: [],
    output: async (events) => {
      const documents: string[] = [];
      const strategy = xrayObservability({
        serviceName: 'svc',
        flushIntervalMs: 0,
        _client: {
          putTraceSegments: async (input) => {
            documents.push(...(input as { TraceSegmentDocuments: string[] }).TraceSegmentDocuments);
          },
        },
      });
      for (const e of events) strategy.exportEvent(e);
      await strategy.flush?.();
      return documents.join('\n');
    },
  },
  {
    name: 'AG-UI serializer',
    // The answer is what the stream shows a person.
    carries: ['finalContent'],
    output: async (events) => {
      const serializer = agUiSerializer({ threadId: 'thread-1', runId: 'ag-run' });
      const out = events.flatMap((e) => serializer.event(e));
      return JSON.stringify([...out, ...serializer.settle({ kind: 'finished' })]);
    },
  },
  {
    name: 'bug-report transcript',
    // The conversation as it was: the answer is the turn's last word.
    carries: ['finalContent'],
    output: async (events) => JSON.stringify(deriveTranscript(events) ?? null),
  },
];

/** `'[N chars]'` — the audit chain's marker for a string of `text`'s length. */
const chars = (text: string): string => `[${text.length} chars]`;

/** The leaves of `value` whose table says content hold `canary`; its record leaves do not. */
function expectClassified(
  value: object,
  table: Readonly<Record<string, FieldKind>>,
  canary: string,
): void {
  expect(Object.keys(value).sort()).toEqual(Object.keys(table).sort());
  for (const [field, kind] of Object.entries(table)) {
    const text = JSON.stringify((value as Record<string, unknown>)[field]);
    if (kind === 'content') expect(text, field).toContain(canary);
    else expect(text, field).not.toContain(canary);
  }
}

describe('turn_end content reaches an exporter only where it is declared to', () => {
  it('every content field has a canary, and the turn carries each one', () => {
    expect(CONTENT_FIELDS.sort()).toEqual(
      Object.entries(TURN_END_FIELDS)
        .filter(([, kind]) => kind === 'content')
        .map(([field]) => field)
        .sort(),
    );
    const turnEnd = JSON.stringify(oneTurn()[1]!.payload);
    for (const field of CONTENT_FIELDS) expect(turnEnd).toContain(canaryOf(field));
  });

  it('the canary of a typed answer’s limits and negatives fills every content leaf, and no record leaf', () => {
    const canary = canaryOf('answerCoverage');
    const limits = coverageWith(canary);
    for (const list of [limits.checked, limits.notChecked, limits.cannotCover])
      expectClassified(list[0]!, COVERAGE_ITEM_FIELDS, canary);
    expectClassified(limits.periods[0]!, PERIOD_FIELDS, canary);
    expectClassified(limits.inProgress[0]!, IN_PROGRESS_FIELDS, canary);
    expectClassified(limits.inProgress[0]!.items[0]!, IN_PROGRESS_ITEM_FIELDS, canary);
    expectClassified(limits.assumed[0]!, ASSUMED_FIELDS, canary);

    const other = canaryOf('answerNegatives');
    const negatives = negativesWith(other);
    expectClassified(negatives, ANSWER_NEGATIVES_FIELDS, other);
    expectClassified(negatives.claims[0]!, NEGATIVE_CLAIM_FIELDS, other);
    expectClassified(negatives.checks[0]!, NEGATIVE_CHECK_FIELDS, other);
  });

  it.each(EXPORTERS.map((exporter) => [exporter.name, exporter] as const))(
    '%s',
    async (_name, exporter) => {
      const output = await exporter.output(oneTurn());
      // The exporter saw the turn: its output is not empty.
      expect(output.length).toBeGreaterThan(20);
      const carried = CONTENT_FIELDS.filter((field) => output.includes(canaryOf(field)));
      expect(carried.sort()).toEqual([...exporter.carries].sort());
      // Named leaf by leaf, so a leak says where it came from.
      const leaked = CONTENT_FIELDS.filter((field) => !exporter.carries.includes(field)).flatMap(
        (field) => leafCanaries(field).filter((canary) => output.includes(canary)),
      );
      expect(leaked).toEqual([]);
    },
  );

  it('the audit chain bounds every sentence and value in a typed answer’s limits, and keeps their structure', () => {
    const record = auditBundle(oneTurn()).records.find(
      (r) => r.eventType === 'agentfootprint.agent.turn_end',
    );
    const at = (where: string) => chars(leaf(canaryOf('answerCoverage'), where));
    const item = (list: string) => ({
      what: at(`${list}[].what`),
      why: at(`${list}[].why`),
      short: at(`${list}[].short`),
      kind: 'scope',
    });
    expect((record?.payload as { answerCoverage?: unknown }).answerCoverage).toEqual({
      checked: [item('checked')],
      notChecked: [item('notChecked')],
      cannotCover: [item('cannotCover')],
      periods: [
        {
          toolName: 'orders_search',
          toolCallId: 'call-1',
          queried: { from: at('periods[].queried.from'), to: at('periods[].queried.to') },
          held: { from: at('periods[].held.from'), to: at('periods[].held.to') },
          readAt: at('periods[].readAt'),
        },
      ],
      inProgress: [
        {
          toolName: 'orders_search',
          toolCallId: 'call-1',
          items: [
            {
              what: at('inProgress[].items[].what'),
              why: at('inProgress[].items[].why'),
              short: at('inProgress[].items[].short'),
              count: 96,
            },
          ],
        },
      ],
      assumed: [
        {
          toolName: 'orders_search',
          argument: 'region',
          value: at('assumed[].value'),
          hidden: false,
        },
      ],
    });
  });

  it('the audit chain bounds a negative’s statement and subject, and keeps its codes, ids and counts', () => {
    const record = auditBundle(oneTurn()).records.find(
      (r) => r.eventType === 'agentfootprint.agent.turn_end',
    );
    const at = (where: string) => chars(leaf(canaryOf('answerNegatives'), where));
    const { claims: _claims, ...recordFields } = negativesWith(canaryOf('answerNegatives'));
    expect((record?.payload as { answerNegatives?: unknown }).answerNegatives).toEqual({
      ...recordFields,
      claims: [
        {
          kind: 'none',
          about: at('claims[].about'),
          restsOn: ['r1'],
          statement: at('claims[].statement'),
          delivery: 'record-composed',
          version: '2',
        },
      ],
    });
  });
});
