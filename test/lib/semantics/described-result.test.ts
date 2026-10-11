/**
 * Canonical authoring, unchanged recorded wire.
 *
 * The legacy fixture was captured independently from pristine 30f7a415 before
 * removing semantic(). It is historical evidence, not regenerated output.
 * Six complete envelopes/model projections plus 3,000 ordered outcomes pin
 * existing bytes and refusals without retaining a second authoring door.
 * Unit, functional, integration, property and regression checks remain here.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  Agent,
  defineTool,
  describedResult,
  readSemantics,
  explainSemantics,
  SEMANTICS_NOTE,
  semanticsForModel,
  type DescribedResultDeclaration,
} from '../../../src/index.js';
import { checkSemantics } from '../../../src/lib/semantics/index.js';
import { REFUSED_PREFIX } from '../../../src/core/agent/coverage/refusal.js';
import type { LLMMessage, LLMRequest } from '../../../src/adapters/types.js';
import { mock } from '../../../src/llm-providers.js';

const legacy = JSON.parse(
  readFileSync(new URL('./fixtures/legacy-wire.json', import.meta.url), 'utf8'),
) as {
  cases: Array<{ name: string; envelope: unknown; modelView: unknown }>;
  property: {
    seed: number;
    count: number;
    minted: number;
    refused: number;
    serializedUtf8Bytes: number;
    outcomeSequenceSha256: string;
  };
};
const recordedCase = (name: string) => {
  const saved = legacy.cases.find((entry) => entry.name === name);
  if (!saved) throw new Error('Missing independently captured legacy case: ' + name);
  return saved;
};

// ── Toolkit ──────────────────────────────────────────────────────────────

/** A declaration as JSON hands it over — untyped, so the compiler is out of
 *  the picture exactly as it is for a plain-JS or JSON-fed author. */
const fromJson = (text: string): never => JSON.parse(text) as never;

/** The message a door threw, or a failure when it minted. */
const refusalOf = (mint: () => unknown): string => {
  try {
    mint();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal, and the door minted');
};

/** The six names whose declaration and wire spelling differ, camelCase → wire. */
const SPELLED: ReadonlyArray<readonly [camel: string, snake: string]> = [
  ['isCounter', 'is_counter'],
  ['measuredAt', 'measured_at'],
  ['ageSeconds', 'age_seconds'],
  ['sourceExportDate', 'source_export_date'],
  ['filterNote', 'filter_note'],
  ['chartHint', 'chart_hint'],
];

/** Normalize a canonical refusal into the historical spelling captured in the
 *  independent digest. This exact normalization predates the removal: the old
 *  declaration had no period field. Never use this on recorded data itself. */
const inWireWords = (message: string): string =>
  [
    ...SPELLED,
    ['notCovered', 'not_covered'] as const,
    ['describedResult()', 'semantic()'] as const,
    ['provenance, period, coverage', 'provenance, coverage'] as const,
  ].reduce((text, [camel, snake]) => text.split(camel).join(snake), message);

/** Canonical declarations for the independently captured legacy cases.
 *  The values come from the data, as a tool's would. */
const exportRows = [
  { vm: 'vm-01', datastore: 'ds-7', sizeTb: 12 },
  { vm: 'vm-02', datastore: 'ds-9', sizeTb: 3.5 },
];
const exportedAt = '2026-09-19T02:00:00Z'; // the export's own timestamp
const samples = [
  { time: '2026-09-19T01:30:00Z', port: 'fc1/3', iops: 18450 },
  { time: '2026-09-19T02:00:00Z', port: 'fc1/3', iops: 17200 },
];
const newestSample = samples.reduce((a, b) => (a.time > b.time ? a : b)).time;

interface Case {
  readonly name: string;
  readonly camel: DescribedResultDeclaration;
}

const CASES: readonly Case[] = [
  {
    name: 'facts from an export',
    camel: {
      facts: exportRows.map((r) => ({ entity: r.vm, datastore: r.datastore, size_tb: r.sizeTb })),
      provenance: {
        measuredAt: exportedAt,
        source: 'RVTools export',
        sourceExportDate: '2026-09-19',
      },
    },
  },
  {
    name: 'a series with grain — measuredAt is the newest sample',
    camel: {
      series: samples.map((s) => ({
        t: s.time,
        entity: s.port,
        metric: 'avg_iops',
        value: s.iops,
      })),
      grain: { interval: '30m', aggregation: 'avg', isCounter: false, collapsed: 'per-port' },
      provenance: { measuredAt: newestSample, ageSeconds: 600, source: 'InfluxDB SwitchPortStats' },
    },
  },
  {
    name: 'edges — no provenance needed',
    camel: { edges: exportRows.map((r) => ({ from: r.vm, to: r.datastore, kind: 'rides' })) },
  },
  {
    name: 'clarify-only — two matches, which one?',
    camel: {
      clarify: {
        question: 'Two customers match "Acme" — which one?',
        candidates: ['Acme Ltd', 'Acme Inc'],
      },
    },
  },
  {
    name: 'a stated clarify: null beside facts',
    camel: {
      facts: [{ entity: 'vm-01', size_tb: 12 }],
      provenance: { measuredAt: exportedAt, source: 'RVTools export' },
      clarify: null,
    },
  },
  {
    name: 'render hints and coverage — every spelled field at once',
    camel: {
      series: samples.map((s) => ({
        t: s.time,
        entity: s.port,
        metric: 'frames_total',
        value: s.iops,
      })),
      grain: { interval: '30m', aggregation: 'count', isCounter: true },
      provenance: {
        measuredAt: newestSample,
        ageSeconds: 30000,
        source: 'nightly RVTools export',
        sourceExportDate: '2026-09-18',
      },
      coverage: {
        checked: ['shq-fab-a: all 48 FC ports'],
        notChecked: [{ what: 'the peer fabric', why: 'this collector is scoped to one fabric' }],
        cannotCover: [
          { what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' },
        ],
      },
      render: {
        default: 'table',
        columns: ['entity', 'value'],
        sort: 'value desc',
        filterNote: 'replicas excluded',
        chartHint: 'line per entity',
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Unit — one wire: the camelCase declaration mints semantic()'s bytes
// ─────────────────────────────────────────────────────────────────────────

describe('unit: canonical declarations retain independently captured legacy wire, byte for byte', () => {
  it.each(CASES)('$name', ({ name, camel }) => {
    const described = describedResult(camel);
    expect(JSON.stringify(described)).toBe(JSON.stringify(recordedCase(name).envelope));
    expect(readSemantics(recordedCase(name).envelope)).toBe(recordedCase(name).envelope);
    expect(described.note).toBe(SEMANTICS_NOTE);
    // The model's view is the same projection, byte for byte, too.
    expect(JSON.stringify(semanticsForModel(described))).toBe(
      JSON.stringify(recordedCase(name).modelView),
    );
  });

  it('pins the wire — snake_case on the envelope whatever the declaration said', () => {
    const minted = describedResult(CASES[5]!.camel);
    const { note: _note, ...rest } = minted;
    expect(JSON.stringify(rest)).toBe(
      '{"af_semantics":true,"series":[{"t":"2026-09-19T01:30:00Z","entity":"fc1/3","metric":' +
        '"frames_total","value":18450},{"t":"2026-09-19T02:00:00Z","entity":"fc1/3","metric":' +
        '"frames_total","value":17200}],"grain":{"interval":"30m","aggregation":"count",' +
        '"is_counter":true},"provenance":{"measured_at":"2026-09-19T02:00:00Z","age_seconds":' +
        '30000,"source":"nightly RVTools export","source_export_date":"2026-09-18"},"coverage":' +
        '{"checked":[{"what":"shq-fab-a: all 48 FC ports"}],"not_checked":[{"what":"the peer ' +
        'fabric","why":"this collector is scoped to one fabric"}],"cannot_cover":[{"what":' +
        '"host-side multipathing","why":"no collector runs on the ESX hosts"}]},"not_covered":' +
        '["the peer fabric — this collector is scoped to one fabric","host-side multipathing — ' +
        'no collector runs on the ESX hosts"],"render":{"default":"table","columns":["entity",' +
        '"value"],"sort":"value desc","filter_note":"replicas excluded","chart_hint":"line per ' +
        'entity"}}',
    );
  });

  it("keeps the author's key order inside each object, as semantic() always did", () => {
    const minted = describedResult({
      facts: [{ entity: 'x' }],
      provenance: {
        source: 'RVTools export',
        sourceExportDate: '2026-09-18',
        measuredAt: exportedAt,
      },
    });
    expect(Object.keys(minted.provenance ?? {})).toEqual([
      'source',
      'source_export_date',
      'measured_at',
    ]);
  });

  it('never passes measuredAt through a parser — "last year, roughly" is the author\'s own words', () => {
    const minted = describedResult({
      facts: [{ entity: 'vm-01' }],
      provenance: { measuredAt: 'last year, roughly', source: 'a spreadsheet someone sent' },
    });
    expect(minted.provenance?.measured_at).toBe('last year, roughly');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unit — one spelling per door
// ─────────────────────────────────────────────────────────────────────────

describe('unit: declarations and saved records enforce their own spelling', () => {
  /** A declaration carrying `key` inside the object that holds it, valid otherwise. */
  const carrying = (key: string): Record<string, unknown> => {
    const facts = [{ entity: 'vm-01' }];
    if (['is_counter', 'isCounter'].includes(key))
      return { edges: [{ from: 'a', to: 'b', kind: 'k' }], grain: { [key]: true } };
    if (['filter_note', 'filterNote', 'chart_hint', 'chartHint'].includes(key))
      return {
        edges: [{ from: 'a', to: 'b', kind: 'k' }],
        render: { default: 'table', [key]: 'x' },
      };
    return { facts, provenance: { source: 'RVTools export', [key]: exportedAt } };
  };
  const at = (key: string): string =>
    ['is_counter', 'isCounter'].includes(key)
      ? 'grain'
      : ['filter_note', 'filterNote', 'chart_hint', 'chartHint'].includes(key)
      ? 'render'
      : 'provenance';

  it.each(SPELLED)(
    'describedResult() takes `%s` and refuses `%s`, naming the one it takes',
    (camel, snake) => {
      const message = refusalOf(() => describedResult(carrying(snake) as never));
      expect(message).toMatch(
        new RegExp(`^${REFUSED_PREFIX}'${at(snake)}\\.${snake}' is not a field`),
      );
      expect(message).toContain(`did you mean \`${camel}\`?`);
    },
  );

  it.each(SPELLED)(
    'stored wire refuses declaration-only `%s` instead of treating it as `%s`',
    (camel) => {
      const record = { af_semantics: true, ...carrying(camel), note: SEMANTICS_NOTE };
      expect(readSemantics(record)).toBeUndefined();
      const message =
        explainSemantics(record)?.find((issue) => issue.field === at(camel) + '.' + camel)
          ?.message ?? '';
      expect(message).toBe(
        `\`${at(camel)}.${camel}\` is not a ${at(camel)} ${
          at(camel) === 'render' ? 'hint' : 'field'
        }.`,
      );
    },
  );

  it('neither the authoring door nor recorded wire takes both spellings at once', () => {
    const both = {
      facts: [{ entity: 'vm-01' }],
      provenance: { measuredAt: exportedAt, measured_at: exportedAt, source: 'RVTools export' },
    };
    expect(refusalOf(() => describedResult(both as never))).toMatch(
      /'provenance\.measured_at' is not a field[\s\S]*did you mean `measuredAt`\?/,
    );
    const record = { af_semantics: true, ...both, note: SEMANTICS_NOTE };
    expect(readSemantics(record)).toBeUndefined();
    expect(explainSemantics(record)?.[0]?.message).toBe(
      '`provenance.measuredAt` is not a provenance field.',
    );
  });

  it("lists the fields in the door's own spelling", () => {
    expect(refusalOf(() => describedResult(carrying('age_seconds') as never))).toMatch(
      /The fields of `provenance` are: measuredAt, ageSeconds, source, sourceExportDate\.$/,
    );
    expect(refusalOf(() => describedResult(carrying('chart_hint') as never))).toMatch(
      /The fields of `render` are: default, columns, sort, filterNote, chartHint\.$/,
    );
    expect(refusalOf(() => describedResult(carrying('is_counter') as never))).toMatch(
      /The fields of `grain` are: interval, aggregation, isCounter, collapsed\.$/,
    );
  });

  it('coverage declarations refuse wire spelling; stored records retain it', () => {
    const decl = fromJson(
      JSON.stringify({
        edges: [{ from: 'a', to: 'b', kind: 'k' }],
        coverage: { not_checked: ['x'] },
      }),
    );
    expect(refusalOf(() => describedResult(decl))).toMatch(/did you mean `notChecked`\?/);
    const record = {
      af_semantics: true,
      edges: [{ from: 'a', to: 'b', kind: 'k' }],
      coverage: { not_checked: [{ what: 'x' }] },
      note: SEMANTICS_NOTE,
    };
    expect(readSemantics(record)).toBe(record);
  });

  it('a hand-written not-covered list is refused as derived, quoting the key written', () => {
    expect(
      refusalOf(() => describedResult(fromJson('{"facts":[{"entity":"x"}],"notCovered":["y"]}'))),
    ).toMatch(/^refused: `notCovered` is derived, never declared/);
    expect(
      refusalOf(() => describedResult(fromJson('{"facts":[{"entity":"x"}],"not_covered":["y"]}'))),
    ).toMatch(/^refused: `not_covered` is derived, never declared/);
  });
});

describe('unit: an object that is not an object is named for what it is', () => {
  // Malformed declaration objects and malformed saved objects are refused;
  // neither path repairs them into a seemingly valid record.
  const edges = [{ from: 'vm-01', to: 'ds-7', kind: 'rides' }];

  it('describedResult(): provenance null, grain a string, render an array', () => {
    expect(
      refusalOf(() => describedResult(fromJson('{"facts":[{"entity":"x"}],"provenance":null}'))),
    ).toBe(
      'refused: `provenance` must be an object ({ measuredAt, source, ageSeconds?, ' +
        'sourceExportDate? }). (field: provenance)',
    );
    expect(refusalOf(() => describedResult({ edges, grain: 'avg' as never }))).toBe(
      'refused: `grain` must be an object ({ interval?, aggregation?, isCounter?, collapsed? }). ' +
        '(field: grain)',
    );
    expect(refusalOf(() => describedResult({ edges, render: ['table'] as never }))).toBe(
      'refused: `render` must be an object ({ default, columns?, sort?, filterNote?, ' +
        'chartHint? }). (field: render)',
    );
  });

  it('a malformed saved object is refused without modifying the recorded value', () => {
    for (const [field, value] of [
      ['provenance', null],
      ['grain', 'avg'],
      ['render', ['table']],
    ] as const) {
      const record = { af_semantics: true, edges, [field]: value, note: SEMANTICS_NOTE };
      const before = JSON.stringify(record);
      expect(readSemantics(record)).toBeUndefined();
      expect(explainSemantics(record)?.[0]?.field).toBe(field);
      expect(JSON.stringify(record)).toBe(before);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — every rule refuses in the author's own words
// ─────────────────────────────────────────────────────────────────────────

describe('functional: a refusal names the field as the author spelled it', () => {
  const facts = [{ entity: 'vm-01' }];
  const point = [{ t: exportedAt, entity: 'fc1/3', metric: 'frames', value: 1 }];
  const cases: ReadonlyArray<readonly [string, () => unknown, RegExp]> = [
    [
      'no provenance',
      () => describedResult({ facts } as never),
      /^refused: this result carries series\/facts with no `provenance` — `provenance\.measuredAt` and `provenance\.source` are required[\s\S]*\(field: provenance\)$/,
    ],
    [
      'a blank measuredAt',
      () => describedResult({ facts, provenance: { measuredAt: ' ', source: 's' } }),
      /^refused: `provenance\.measuredAt` must say when the WORLD was measured[\s\S]*\(field: provenance\.measuredAt\)$/,
    ],
    [
      'a negative ageSeconds',
      () =>
        describedResult({
          facts,
          provenance: { measuredAt: exportedAt, source: 's', ageSeconds: -1 },
        }),
      /^refused: `provenance\.ageSeconds` must be a finite number ≥ 0 or omitted\. \(field: provenance\.ageSeconds\)$/,
    ],
    [
      'a blank sourceExportDate',
      () =>
        describedResult({
          facts,
          provenance: { measuredAt: exportedAt, source: 's', sourceExportDate: '' },
        }),
      /^refused: `provenance\.sourceExportDate` must be a non-empty string or omitted\. \(field: provenance\.sourceExportDate\)$/,
    ],
    [
      'a counter-looking aggregation with isCounter unstated',
      () =>
        describedResult({
          series: point,
          grain: { interval: 'daily', aggregation: 'count' },
          provenance: { measuredAt: exportedAt, source: 's' },
        }),
      /is counter-looking, and `isCounter` is not stated[\s\S]*state `isCounter: true` or `isCounter: false`\. \(field: grain\.isCounter\)$/,
    ],
    [
      'isCounter as prose',
      () =>
        describedResult({
          series: point,
          grain: { isCounter: 'yes' as never },
          provenance: { measuredAt: exportedAt, source: 's' },
        }),
      /^refused: `grain\.isCounter` must be a boolean[\s\S]*\(field: grain\.isCounter\)$/,
    ],
    [
      'a grain that says nothing',
      () =>
        describedResult({
          series: point,
          grain: {},
          provenance: { measuredAt: exportedAt, source: 's' },
        }),
      /^refused: `grain` says nothing — state at least one of interval, aggregation, isCounter, collapsed/,
    ],
    [
      'a blank filterNote',
      () =>
        describedResult({
          facts,
          provenance: { measuredAt: exportedAt, source: 's' },
          render: { default: 'table', filterNote: '' },
        }),
      /^refused: `render\.filterNote` must be a non-empty string or omitted\. \(field: render\.filterNote\)$/,
    ],
    [
      'a blank chartHint',
      () =>
        describedResult({
          facts,
          provenance: { measuredAt: exportedAt, source: 's' },
          render: { default: 'chart', chartHint: ' ' },
        }),
      /^refused: `render\.chartHint` must be a non-empty string or omitted\. \(field: render\.chartHint\)$/,
    ],
    [
      'a series with no grain',
      () => describedResult({ series: point, provenance: { measuredAt: exportedAt, source: 's' } }),
      /^refused: this result carries `series` with no `grain`/,
    ],
    [
      'a declaration that declares nothing',
      () => describedResult({}),
      /^refused: this result declares nothing/,
    ],
    [
      'not a declaration at all',
      () => describedResult(null as never),
      /^refused: describedResult\(\) takes a declaration — \{ series\?, facts\?/,
    ],
  ];

  it.each(cases)('%s', (_label, mint, expected) => {
    const message = refusalOf(mint);
    expect(message).toMatch(expected);
    expect(message.startsWith(REFUSED_PREFIX)).toBe(true);
    // The camelCase author never reads a snake_case field name back.
    for (const [, snake] of SPELLED) expect(message).not.toContain(snake);
  });

  it('not a declaration at all: the canonical door names all its fields', () => {
    expect(refusalOf(() => describedResult(null as never))).toBe(
      'refused: describedResult() takes a declaration — { series?, facts?, edges?, grain?, ' +
        'provenance?, period?, coverage?, clarify?, render? } with at least one of ' +
        'series/facts/edges/clarify.',
    );
  });

  it('authoring and historical-record reading apply the same provenance rule', () => {
    for (const { name, camel } of CASES) {
      // Strip provenance from every data case: mint and reader refuse with one rule.
      if (!('facts' in camel || 'series' in camel)) continue;
      const { provenance: _p1, ...camelBare } = camel as Record<string, unknown>;
      const { provenance: _p2, ...snakeBare } = recordedCase(name).envelope as Record<
        string,
        unknown
      >;
      expect(inWireWords(refusalOf(() => describedResult(camelBare as never)))).toBe(
        `${REFUSED_PREFIX}${explainSemantics(snakeBare)?.[0]?.message} (field: provenance)`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — the real loop: what the model reads, what the record keeps
// ─────────────────────────────────────────────────────────────────────────

describe('integration: through the real loop', () => {
  /** Run one tool and return the tool message the MODEL was sent, the
   *  recorded envelope, and the answer. */
  const runOnce = async (execute: () => unknown) => {
    const requests: LLMRequest[] = [];
    const recorded: Array<Record<string, unknown>> = [];
    let calls = 0;
    const agent = Agent.create({
      provider: mock({
        respond: (req) => {
          requests.push(req);
          calls += 1;
          return calls === 1
            ? {
                content: '',
                toolCalls: [{ id: 't1', name: 'vm_inventory', args: {} }],
                stopReason: 'tool_use' as const,
              }
            : { content: 'Two VMs, 15.5 TB between them.' };
        },
      }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('You answer questions about a VMware estate.')
      .tool(
        defineTool({
          name: 'vm_inventory',
          description: 'Every VM in the latest export',
          inputSchema: { type: 'object', properties: {} },
          execute,
        }),
      )
      .watch({
        id: 'capture-semantics',
        onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
          if (e.name === 'agentfootprint.tools.semantics_declared') recorded.push(e.payload ?? {});
        },
      })
      .build();
    const answer = await agent.run({ message: 'How much space do the VMs use?' });
    const tool = requests[1]?.messages.find((m: LLMMessage) => m.role === 'tool');
    const text = typeof tool?.content === 'string' ? tool.content : JSON.stringify(tool?.content);
    return { text, recorded, answer: String(answer) };
  };

  it('the model reads unchanged bytes when a saved legacy result is played through the real loop', async () => {
    const full = CASES[5]!;
    const viaDescribed = await runOnce(() => describedResult(full.camel));
    const viaSemantic = await runOnce(() => structuredClone(recordedCase(full.name).envelope));
    expect(viaDescribed.text).toBe(viaSemantic.text);
    // The projection: data + grain + provenance + composed not_covered + the note;
    // never the marker, the render hints or the checked list.
    expect(viaDescribed.text).toContain('"is_counter":true');
    expect(viaDescribed.text).toContain('"measured_at":"2026-09-19T02:00:00Z"');
    expect(viaDescribed.text).toContain('the peer fabric — this collector is scoped to one fabric');
    expect(viaDescribed.text).not.toContain('af_semantics');
    expect(viaDescribed.text).not.toContain('replicas excluded');
    expect(viaDescribed.text).not.toContain('shq-fab-a: all 48 FC ports');
    expect(viaDescribed.text).not.toContain('measuredAt');
  });

  it('the record keeps the whole envelope, snake_case — render, coverage and all', async () => {
    const { recorded } = await runOnce(() => describedResult(CASES[5]!.camel));
    expect(recorded).toHaveLength(1);
    const env = recorded[0]!.semantics as Record<string, unknown>;
    expect(env.af_semantics).toBe(true);
    expect(env.render).toEqual({
      default: 'table',
      columns: ['entity', 'value'],
      sort: 'value desc',
      filter_note: 'replicas excluded',
      chart_hint: 'line per entity',
    });
    expect((env.coverage as Record<string, unknown>).checked).toEqual([
      { what: 'shq-fab-a: all 48 FC ports' },
    ]);
  });

  it('a fact with no source: the model reads the refusal, in camelCase, and the run continues', async () => {
    const { text, recorded, answer } = await runOnce(() =>
      describedResult(
        fromJson('{"facts":[{"entity":"vm-01","size_tb":12}],"provenance":{"measuredAt":"now"}}'),
      ),
    );
    expect(text).toMatch(/^refused: `provenance\.source` must name the system of record/);
    expect(text).not.toContain('size_tb');
    expect(recorded).toHaveLength(0);
    expect(answer).toBe('Two VMs, 15.5 TB between them.');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property — seeded declarations against independently captured legacy outcomes
// ─────────────────────────────────────────────────────────────────────────

describe('property: canonical results preserve the independently captured legacy outcome sequence', () => {
  let seed = 20260926;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const maybe = (p = 0.5): boolean => rnd() < p;

  type Row = [snake: string, camel: string, value: unknown];
  /** One object in both spellings, same key order, same values. */
  const both = (rows: Row[]): [Record<string, unknown>, Record<string, unknown>] => {
    const order = rows.sort(() => rnd() - 0.5);
    return [
      Object.fromEntries(order.map(([s, , v]) => [s, v])),
      Object.fromEntries(order.map(([, c, v]) => [c, v])),
    ];
  };

  /** Original pre-removal generator, kept in both spellings for a stable seed. */
  const validPair = (): [Record<string, unknown>, Record<string, unknown>] => {
    const s: Record<string, unknown> = {};
    const c: Record<string, unknown> = {};
    const put = (k: string, sv: unknown, cv: unknown = sv): void => {
      s[k] = sv;
      c[k] = cv;
    };
    const shape = pick(['facts', 'series', 'edges', 'clarify', 'everything']);
    const t = pick([exportedAt, 'last year, roughly', 1790000000]);
    if (shape === 'series' || shape === 'everything') {
      put('series', [{ t, entity: 'fc1/3', metric: 'avg_iops', value: pick([1, null, 'n/a']) }]);
      const agg = pick(['avg', 'sum', 'count', undefined]);
      const rows: Row[] = [['interval', 'interval', pick(['30m', 'daily'])]];
      if (agg !== undefined) rows.push(['aggregation', 'aggregation', agg]);
      if (agg === 'sum' || agg === 'count' || maybe())
        rows.push(['is_counter', 'isCounter', maybe()]);
      if (maybe(0.3)) rows.push(['collapsed', 'collapsed', 'per-port rows collapsed']);
      put('grain', ...both(rows));
    }
    if (shape === 'facts' || shape === 'everything')
      put('facts', [{ entity: 'vm-01', size_tb: 12 }]);
    if (shape === 'edges' || shape === 'everything')
      put('edges', [{ from: 'vm-01', to: 'ds-7', kind: 'rides' }]);
    if (shape === 'clarify' || maybe(0.2))
      put(
        'clarify',
        maybe(0.8) ? { question: 'Which one?', candidates: pick([['a', 'b'], []]) } : null,
      );
    if (shape === 'facts' || shape === 'series' || shape === 'everything' || maybe(0.3)) {
      const rows: Row[] = [
        ['measured_at', 'measuredAt', String(t)],
        ['source', 'source', 'RVTools export'],
      ];
      if (maybe()) rows.push(['age_seconds', 'ageSeconds', pick([0, 600, 86400.5])]);
      if (maybe()) rows.push(['source_export_date', 'sourceExportDate', '2026-09-18']);
      put('provenance', ...both(rows));
    }
    if (maybe(0.4))
      put('coverage', {
        checked: ['every VM in the export'],
        ...(maybe() && { notChecked: [{ what: 'the live vCenter', why: 'export only' }] }),
        ...(maybe() && { cannotCover: [{ what: 'AIX LPARs', why: 'RVTools sees VMware only' }] }),
      });
    if (maybe(0.4)) {
      const rows: Row[] = [['default', 'default', pick(['table', 'chart'])]];
      if (maybe()) rows.push(['filter_note', 'filterNote', 'replicas excluded']);
      if (maybe()) rows.push(['chart_hint', 'chartHint', 'line per entity']);
      if (maybe()) rows.push(['columns', 'columns', ['entity', 'size_tb']]);
      if (maybe()) rows.push(['sort', 'sort', 'size_tb desc']);
      put('render', ...both(rows));
    }
    const keys = Object.keys(s).sort(() => rnd() - 0.5);
    return [
      Object.fromEntries(keys.map((k) => [k, s[k]])),
      Object.fromEntries(keys.map((k) => [k, c[k]])),
    ];
  };

  /** One fault, applied the same way to both spellings. */
  const mutated = ([s, c]: [Record<string, unknown>, Record<string, unknown>]): [
    unknown,
    unknown,
  ] => {
    type Obj = Record<string, Record<string, unknown>>;
    const each = (edit: (o: Obj, wire: boolean) => void): [unknown, unknown] => {
      edit(s as Obj, true);
      edit(c as Obj, false);
      return [s, c];
    };
    const fault = pick([
      'no provenance',
      'blank measured',
      'negative age',
      'blank export date',
      'counter unstated',
      'counter as prose',
      'blank render note',
      'empty coverage',
      'derived list',
      'unknown key',
      'row with no entity',
      'no grain',
    ]);
    switch (fault) {
      case 'no provenance':
        return each((o) => delete o.provenance);
      case 'blank measured':
        return each(
          (o, w) => o.provenance && (o.provenance[w ? 'measured_at' : 'measuredAt'] = ' '),
        );
      case 'negative age':
        return each(
          (o, w) => o.provenance && (o.provenance[w ? 'age_seconds' : 'ageSeconds'] = -1),
        );
      case 'blank export date':
        return each(
          (o, w) =>
            o.provenance && (o.provenance[w ? 'source_export_date' : 'sourceExportDate'] = ''),
        );
      case 'counter unstated':
        return each((o, w) => {
          if (o.grain) {
            o.grain.aggregation = 'sum';
            delete o.grain[w ? 'is_counter' : 'isCounter'];
          }
        });
      case 'counter as prose':
        return each((o, w) => o.grain && (o.grain[w ? 'is_counter' : 'isCounter'] = 'yes'));
      case 'blank render note':
        return each((o, w) => o.render && (o.render[w ? 'filter_note' : 'filterNote'] = ''));
      case 'empty coverage':
        return each((o) => {
          o.coverage = {};
        });
      case 'derived list':
        return each((o, w) => {
          (o as Record<string, unknown>)[w ? 'not_covered' : 'notCovered'] = ['x'];
        });
      case 'unknown key':
        return each((o) => {
          (o as Record<string, unknown>).tables = 1;
        });
      case 'row with no entity':
        return each((o) => {
          (o as Record<string, unknown>).facts = [{ size_tb: 1 }];
        });
      default:
        return each((o) => delete o.grain);
    }
  };

  const declarationPair = (): [unknown, unknown] => {
    const pair = validPair();
    return maybe() ? pair : mutated(pair);
  };

  const outcome = (mint: () => unknown): string => {
    try {
      return `minted ${JSON.stringify(mint())}`;
    } catch (err) {
      return `refused ${(err as Error).message}`;
    }
  };

  it('3,000 declarations retain every ordered wire byte and normalized refusal', () => {
    let minted = 0;
    let refused = 0;
    const outcomes: string[] = [];
    expect(seed).toBe(legacy.property.seed);
    for (let i = 0; i < legacy.property.count; i++) {
      const [, camel] = declarationPair();
      const viaDescribed = outcome(() => describedResult(structuredClone(camel) as never));
      outcomes.push(inWireWords(viaDescribed));
      if (viaDescribed.startsWith('minted')) minted += 1;
      else refused += 1;
    }
    const serialized = JSON.stringify(outcomes);
    expect(minted).toBe(legacy.property.minted);
    expect(refused).toBe(legacy.property.refused);
    expect(Buffer.byteLength(serialized, 'utf8')).toBe(legacy.property.serializedUtf8Bytes);
    expect(createHash('sha256').update(serialized).digest('hex')).toBe(
      legacy.property.outcomeSequenceSha256,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — the gate's advice names the door to use
// ─────────────────────────────────────────────────────────────────────────

describe('regression: check:semantics names describedResult() in its advice', () => {
  it('a triage result with no coverage is told to return describedResult({ …, coverage })', () => {
    const report = checkSemantics([
      { name: 'nas_share_triage', resultClass: 'triage', results: [{ verdict: 'no fault found' }] },
    ]);
    const finding = report.findings.find((f) => f.code === 'triage-without-coverage');
    expect(finding?.message).toContain(
      'Return describedResult({ …, coverage: { checked, notChecked, cannotCover } })',
    );
    expect(finding?.message).not.toMatch(/\bsemantic\(/);
  });

  it('a newly minted envelope and a historical record are judged identically by the gate', () => {
    const full = CASES[5]!;
    const a = checkSemantics([
      { name: 'ports', resultClass: 'inventory', results: [describedResult(full.camel)] },
    ]);
    const b = checkSemantics([
      { name: 'ports', resultClass: 'inventory', results: [recordedCase(full.name).envelope] },
    ]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });
});
