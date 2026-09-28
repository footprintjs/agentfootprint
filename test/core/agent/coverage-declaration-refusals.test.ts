/**
 * A declaration is refused, never trimmed — and the refusal reads as one.
 *
 * Two defects, one file, because both are about what a result helper says
 * when it cannot honor what it was handed:
 *
 *   1. A SILENT LOSS. `absent()`, `coverage()` and `semantic()` read their
 *      declarations by name. A declaration fed from plain JavaScript or JSON —
 *      where the type checker never looks — could carry `not_checked` or
 *      `cannot_cover`, and the helper minted without that list: the declared
 *      limit vanished and the answer read as if the tool had none. Every key a
 *      declaration carries is now one the helper reads or a refusal, naming
 *      the spelling meant when it is a casing slip.
 *   2. A REFUSAL THAT READ LIKE A FINDING. The helpers run inside a tool's
 *      `execute`, so a refusal becomes the call's error result — the text the
 *      model reads. It used to start with the helper's own name
 *      (`absent: …`, `semantic: carries series/facts with no provenance …`).
 *      It now starts `refused: `, whichever helper refused.
 *
 * Sections follow Convention 3: Unit (each helper, each level) · Functional
 * (the refusal text) · Integration (the model-visible tool message, through
 * the real loop) · Property (casing slips of every known key) · Regression
 * (a correct declaration mints the bytes it always did — goldens taken from
 * the tree before this change).
 */

import { describe, expect, it } from 'vitest';

import {
  ABSENCE_NOTE,
  Agent,
  absent,
  coverage,
  COVERAGE_NOTE,
  defineTool,
  semantic,
  SEMANTICS_NOTE,
} from '../../../src/index.js';
import {
  REFUSED_PREFIX,
  refuseUnknownKeys,
  spellingMeant,
} from '../../../src/core/agent/coverage/refusal.js';
import type { LLMMessage, LLMRequest } from '../../../src/adapters/types.js';
import { mock } from '../../../src/llm-providers.js';

// ── Toolkit ──────────────────────────────────────────────────────────────

/** A declaration as JSON hands it over — untyped, so the compiler is out of
 *  the picture exactly as it is for a plain-JS or JSON-fed author. */
const fromJson = (text: string): never => JSON.parse(text) as never;

const PROVENANCE = { measured_at: '2026-09-19T02:00:00Z', source: 'RVTools export' };

/** The message a helper threw, or a failure when it did not throw. */
const refusalOf = (mint: () => unknown): string => {
  try {
    mint();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal, and the helper minted');
};

const call = (name: string, id = 't1') => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});

/**
 * Run one tool through the real loop and hand back what the MODEL was sent
 * for it: the `role: 'tool'` message in the request the second model call
 * received — the exact text a provider adapter puts on the wire.
 */
const toolMessageTheModelReads = async (
  execute: () => unknown,
): Promise<{ text: string; content: string; toolEnd: Record<string, unknown> }> => {
  const requests: LLMRequest[] = [];
  let calls = 0;
  const toolEnds: Record<string, unknown>[] = [];
  const agent = Agent.create({
    provider: mock({
      respond: (req) => {
        requests.push(req);
        calls += 1;
        return calls === 1 ? call('lookup') : { content: 'I could not get that data.' };
      },
    }),
    model: 'mock',
    maxIterations: 4,
  })
    .system('You answer questions about a storage estate.')
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Look something up',
        inputSchema: { type: 'object', properties: {} },
        execute,
      }),
    )
    .watch({
      id: 'capture-tool-end',
      onEmit: (e: { name: string; payload?: Record<string, unknown> }) => {
        if (e.name === 'agentfootprint.stream.tool_end') toolEnds.push(e.payload ?? {});
      },
    })
    .build();
  const result = await agent.run({ message: 'How big is vm-01?' });
  expect(requests).toHaveLength(2);
  const toolMessage = requests[1]!.messages.find((m: LLMMessage) => m.role === 'tool');
  expect(toolMessage).toBeDefined();
  const text =
    typeof toolMessage!.content === 'string'
      ? toolMessage!.content
      : JSON.stringify(toolMessage!.content);
  return { text, content: String(result), toolEnd: toolEnds[0] ?? {} };
};

// ─────────────────────────────────────────────────────────────────────────
// Unit — every helper refuses a key it does not read, at every level it reads
// ─────────────────────────────────────────────────────────────────────────

describe('unit: a JS-fed not_checked / cannot_cover is refused, naming the spelling meant', () => {
  it('absent() — top level', () => {
    const notChecked = refusalOf(() =>
      absent(
        fromJson(
          '{"what":"FLOGI entries on fc1/3","checked":["the fcns db"],"not_checked":["the archive"]}',
        ),
      ),
    );
    expect(notChecked).toMatch(/did you mean `notChecked`\?/);
    expect(notChecked).toMatch(/'not_checked' is not a field this vocabulary has/);

    const cannotCover = refusalOf(() =>
      absent(
        fromJson(
          '{"what":"x","checked":["the fcns db"],"cannot_cover":[{"what":"peer","why":"scoped"}]}',
        ),
      ),
    );
    expect(cannotCover).toMatch(/did you mean `cannotCover`\?/);
  });

  it('coverage() — top level', () => {
    const notChecked = refusalOf(() =>
      coverage({ ok: true }, fromJson('{"checked":["SRDF pairs"],"not_checked":["NDM"]}')),
    );
    expect(notChecked).toMatch(/did you mean `notChecked`\?/);
    const cannotCover = refusalOf(() =>
      coverage(
        { ok: true },
        fromJson('{"checked":["SRDF pairs"],"cannot_cover":[{"what":"ESX","why":"none"}]}'),
      ),
    );
    expect(cannotCover).toMatch(/did you mean `cannotCover`\?/);
  });

  it('semantic() — the nested coverage declaration', () => {
    const notChecked = refusalOf(() =>
      semantic(
        fromJson(
          JSON.stringify({
            facts: [{ entity: 'vm-01' }],
            provenance: PROVENANCE,
            coverage: { checked: ['the export'], not_checked: ['the live vCenter'] },
          }),
        ),
      ),
    );
    expect(notChecked).toMatch(/'coverage\.not_checked' is not a field this vocabulary has/);
    expect(notChecked).toMatch(/did you mean `notChecked`\?/);
    expect(notChecked).toMatch(/The fields of `coverage` are: checked, notChecked, cannotCover\./);

    const cannotCover = refusalOf(() =>
      semantic(
        fromJson(
          JSON.stringify({
            facts: [{ entity: 'vm-01' }],
            provenance: PROVENANCE,
            coverage: { cannot_cover: [{ what: 'AIX LPARs', why: 'not in the export' }] },
          }),
        ),
      ),
    );
    expect(cannotCover).toMatch(/did you mean `cannotCover`\?/);
  });

  it('the lists that used to vanish no longer mint — before, a partial ledger was minted without them', () => {
    // The exact shape of the loss: `checked` present, so the mint succeeded
    // and the snake_case list was simply not read.
    expect(() =>
      coverage(1, fromJson('{"checked":["a"],"not_checked":[{"what":"b","why":"c"}]}')),
    ).toThrow(/notChecked/);
  });
});

describe('unit: the other keys each helper reads are held to the same rule', () => {
  it('absent() — try_instead and try_instead_tool name their camelCase spellings', () => {
    expect(
      refusalOf(() =>
        absent(fromJson('{"what":"x","checked":["a"],"try_instead":"Widen the window."}')),
      ),
    ).toMatch(/did you mean `tryInstead`\?/);
    expect(
      refusalOf(() =>
        absent(fromJson('{"what":"x","checked":["a"],"try_instead_tool":{"tool":"inventory"}}')),
      ),
    ).toMatch(/did you mean `tryInsteadTool`\?/);
  });

  it('semantic() — grain, provenance and render name their snake_case spellings', () => {
    expect(
      refusalOf(() =>
        semantic(
          fromJson(
            JSON.stringify({
              facts: [{ entity: 'vm-01' }],
              provenance: { measuredAt: '2026-09-19', source: 'RVTools export' },
            }),
          ),
        ),
      ),
    ).toMatch(/'provenance\.measuredAt' is not a field[\s\S]*did you mean `measured_at`\?/);
    expect(
      refusalOf(() =>
        semantic(
          fromJson(
            JSON.stringify({
              series: [{ t: 1, entity: 'fc1/3', metric: 'iops', value: 1 }],
              grain: { interval: '30m', isCounter: false },
              provenance: PROVENANCE,
            }),
          ),
        ),
      ),
    ).toMatch(/did you mean `is_counter`\?/);
    expect(
      refusalOf(() =>
        semantic(
          fromJson(
            JSON.stringify({
              facts: [{ entity: 'vm-01' }],
              provenance: PROVENANCE,
              render: { default: 'table', filterNote: 'replicas excluded' },
            }),
          ),
        ),
      ),
    ).toMatch(/did you mean `filter_note`\?/);
  });

  it('semantic() — an unknown clarify key is refused (the copy used to keep only its two keys)', () => {
    const message = refusalOf(() =>
      semantic(
        fromJson(
          JSON.stringify({
            clarify: { question: 'Which volume?', candidates: ['v1', 'v2'], options: ['v3'] },
          }),
        ),
      ),
    );
    expect(message).toMatch(/'clarify\.options' is not a field this vocabulary has\./);
    expect(message).toMatch(/The fields of `clarify` are: question, candidates\./);
    expect(message).not.toMatch(/did you mean/);
  });

  it('a key that is not a casing slip gets no guess — only the fields that exist', () => {
    const message = refusalOf(() => coverage(1, fromJson('{"checked":["a"],"skipped":["b"]}')));
    // `period` joined the fields `coverage()` reads in honesty step 7b.
    expect(message).toBe(
      `${REFUSED_PREFIX}'skipped' is not a field this vocabulary has. ` +
        'The fields are: checked, notChecked, cannotCover, period.',
    );
  });

  it('semantic() keeps its specific refusal for a hand-written not_covered', () => {
    expect(
      refusalOf(() =>
        semantic(fromJson('{"facts":[{"entity":"x"}],"not_covered":["the archive"]}')),
      ),
    ).toMatch(/^refused: `not_covered` is derived, never declared/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Functional — every refusal starts with the one neutral prefix
// ─────────────────────────────────────────────────────────────────────────

describe('functional: a refusal says what it is before anything else, never the helper name', () => {
  const refusals: ReadonlyArray<readonly [string, () => unknown]> = [
    ['absent — no checked', () => absent({ what: 'x', checked: [] })],
    ['absent — blank what', () => absent({ what: ' ', checked: ['a'] })],
    ['absent — not an object', () => absent(null as never)],
    [
      'absent — cannotCover with no why',
      () => absent({ what: 'x', checked: ['a'], cannotCover: ['b'] }),
    ],
    [
      'absent — tryInsteadTool as a list',
      () => absent({ what: 'x', checked: ['a'], tryInsteadTool: [] as never }),
    ],
    [
      'absent — unknown key',
      () => absent(fromJson('{"what":"x","checked":["a"],"not_checked":[]}')),
    ],
    ['coverage — nothing declared', () => coverage(1, {})],
    ['coverage — not an object', () => coverage(1, null as never)],
    ['coverage — item with no ground', () => coverage(1, { checked: [''] })],
    ['coverage — unknown key', () => coverage(1, fromJson('{"not_checked":["a"]}'))],
    ['semantic — no provenance', () => semantic({ facts: [{ entity: 'x' }] })],
    [
      'semantic — no source',
      () => semantic(fromJson('{"facts":[{"entity":"x"}],"provenance":{"measured_at":"now"}}')),
    ],
    [
      'semantic — series without grain',
      () =>
        semantic({
          series: [{ t: 1, entity: 'a', metric: 'm', value: 1 }],
          provenance: PROVENANCE,
        }),
    ],
    ['semantic — declares nothing', () => semantic({})],
    ['semantic — not an object', () => semantic(null as never)],
    [
      'semantic — coverage names no ground',
      () => semantic({ facts: [{ entity: 'x' }], provenance: PROVENANCE, coverage: {} }),
    ],
    [
      'semantic — unknown nested key',
      () => semantic(fromJson('{"facts":[{"entity":"x"}],"coverage":{"not_checked":["a"]}}')),
    ],
  ];

  it.each(refusals)('%s', (_label, mint) => {
    const message = refusalOf(mint);
    expect(message.startsWith(REFUSED_PREFIX)).toBe(true);
    expect(message).not.toMatch(/^(absent|coverage|semantic):/);
  });

  it('the prefix is the one pinned text: "refused: "', () => {
    expect(REFUSED_PREFIX).toBe('refused: ');
  });

  it('a result with no provenance reads as a refused result, naming the two required fields', () => {
    expect(refusalOf(() => semantic({ facts: [{ entity: 'vm-01' }] }))).toBe(
      'refused: this result carries series/facts with no `provenance` — ' +
        '`provenance.measured_at` and `provenance.source` are required whenever the envelope ' +
        'carries data: a number with no age and no source cannot be trusted or audited. ' +
        '(field: provenance)',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration — what the model is actually sent, through the real loop
// ─────────────────────────────────────────────────────────────────────────

describe('integration: the model-visible tool message starts with the refusal, and the run continues', () => {
  it('an envelope with no source: the tool message the model reads starts "refused: "', async () => {
    const { text, content, toolEnd } = await toolMessageTheModelReads(() =>
      semantic(
        fromJson('{"facts":[{"entity":"vm-01","size_tb":12}],"provenance":{"measured_at":"now"}}'),
      ),
    );
    expect(text.startsWith(REFUSED_PREFIX)).toBe(true);
    expect(text).toMatch(/^refused: `provenance\.source` must name the system of record/);
    expect(text).not.toMatch(/^semantic:/);
    // The refusal is the call's error result — the value never reached the model.
    expect(toolEnd.error).toBe(true);
    expect(text).not.toContain('size_tb');
    // The run went on: the model got its next turn and answered.
    expect(content).toBe('I could not get that data.');
  });

  it('an envelope with no provenance at all: "refused: this result carries series/facts with no …"', async () => {
    const { text, content } = await toolMessageTheModelReads(() =>
      semantic({ facts: [{ entity: 'vm-01', size_tb: 12 }] }),
    );
    expect(text).toMatch(/^refused: this result carries series\/facts with no `provenance`/);
    expect(content).toBe('I could not get that data.');
  });

  it('a JS-fed not_checked: the model reads the refusal and the spelling meant, not a trimmed ledger', async () => {
    const { text, toolEnd } = await toolMessageTheModelReads(() =>
      coverage({ healthy: true }, fromJson('{"checked":["SRDF pairs"],"not_checked":["NDM"]}')),
    );
    expect(text).toMatch(
      /^refused: 'not_checked' is not a field[\s\S]*did you mean `notChecked`\?/,
    );
    expect(toolEnd.error).toBe(true);
    expect(text).not.toContain('healthy');
  });

  it('absent() refusing inside a tool no longer reads "absent: …" — a word a model can take for a finding', async () => {
    const { text } = await toolMessageTheModelReads(() => absent({ what: 'vm-01', checked: [] }));
    expect(text.startsWith(REFUSED_PREFIX)).toBe(true);
    expect(text).not.toMatch(/^absent/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property — every casing slip of every known key is caught and named
// ─────────────────────────────────────────────────────────────────────────

describe('property: a casing slip of a known key always names that key', () => {
  const snake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const camel = (key: string): string =>
    key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  const upperFirst = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);
  const vocabularies: ReadonlyArray<readonly string[]> = [
    ['what', 'checked', 'notChecked', 'cannotCover', 'tryInstead', 'tryInsteadTool'],
    ['checked', 'notChecked', 'cannotCover'],
    ['interval', 'aggregation', 'is_counter', 'collapsed'],
    ['measured_at', 'age_seconds', 'source', 'source_export_date'],
    ['default', 'columns', 'sort', 'filter_note', 'chart_hint'],
  ];

  it('snake_case, camelCase, UPPER-first and lower-case respellings all resolve to the known key', () => {
    let checked = 0;
    for (const known of vocabularies) {
      for (const key of known) {
        for (const slip of [snake(key), camel(key), upperFirst(key), key.toLowerCase()]) {
          if (slip === key) continue;
          expect(spellingMeant(slip, known)).toBe(key);
          expect(() => refuseUnknownKeys({ [slip]: 1 }, known)).toThrow(`did you mean \`${key}\`?`);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('a known key is never refused, and a different word is never guessed', () => {
    for (const known of vocabularies) {
      const all = Object.fromEntries(known.map((k) => [k, 1]));
      expect(() => refuseUnknownKeys(all, known)).not.toThrow();
      expect(spellingMeant('something_else', known)).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression — a correct declaration mints exactly the bytes it always did
// ─────────────────────────────────────────────────────────────────────────

describe('regression: correct declarations are byte-identical to the tree before this change', () => {
  // Each golden is `JSON.stringify` of the minted value, `note` removed (the
  // notes are pinned byte-for-byte by test/docs/canonical-notes.test.ts), as
  // the pre-change tree minted it.
  const withoutNote = (value: object): string => {
    const { note: _note, ...rest } = value as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  const COVERAGE_DECL = {
    checked: ['SRDF pair state on all 4 arrays (live query)'],
    notChecked: [{ what: 'NDM migration sessions', why: 'the API timed out — ask again' }],
    cannotCover: [{ what: 'host-side multipathing', why: 'no collector runs on the ESX hosts' }],
  };

  it('absent() — every field, record-only extras and the typed tool included', () => {
    const minted = absent({
      what: 'FLOGI entries on fc1/3',
      checked: [
        'shq-fab-a: the live fcns database',
        { what: 'window: the last 24h', why: 'FLOGI retention', short: 'the last 24h' },
      ],
      notChecked: [
        { what: 'the archived FLOGI history', why: 'older than the 24h window', kind: 'scope' },
      ],
      cannotCover: [
        { what: 'ports on the peer fabric', why: 'this collector is scoped to one fabric' },
      ],
      tryInstead: 'Ask for a different interface, or query the peer fabric by name.',
      tryInsteadTool: { tool: 'fabric_inventory', why: 'it lists both fabrics' },
    });
    expect(minted.note).toBe(ABSENCE_NOTE);
    expect(withoutNote(minted)).toBe(
      '{"af_absent":true,"outcome":"nothing_found","looked_for":"FLOGI entries on fc1/3",' +
        '"checked":[{"what":"shq-fab-a: the live fcns database"},{"what":"window: the last 24h",' +
        '"why":"FLOGI retention","short":"the last 24h"}],"not_checked":[{"what":"the archived ' +
        'FLOGI history","why":"older than the 24h window","kind":"scope"}],"cannot_cover":' +
        '[{"what":"ports on the peer fabric","why":"this collector is scoped to one fabric"}],' +
        '"retry_returns_the_same":true,"try_instead":"Ask for a different interface, or query ' +
        'the peer fabric by name.","try_instead_tool":{"tool":"fabric_inventory","why":"it ' +
        'lists both fabrics"}}',
    );
  });

  it('coverage() — all three lists', () => {
    const minted = coverage({ healthy: true }, COVERAGE_DECL);
    expect(minted.af_coverage.note).toBe(COVERAGE_NOTE);
    expect(
      JSON.stringify({ ...minted, af_coverage: JSON.parse(withoutNote(minted.af_coverage)) }),
    ).toBe(
      '{"af_coverage":{"checked":[{"what":"SRDF pair state on all 4 arrays (live query)"}],' +
        '"not_checked":[{"what":"NDM migration sessions","why":"the API timed out — ask again"}],' +
        '"cannot_cover":[{"what":"host-side multipathing","why":"no collector runs on the ESX ' +
        'hosts"}]},"result":{"healthy":true}}',
    );
  });

  it('semantic() — series, grain, provenance, coverage, clarify and render', () => {
    const minted = semantic({
      series: [{ t: '2026-08-19T02:00:00Z', entity: 'fc1/3', metric: 'avg_iops', value: 17200 }],
      grain: { interval: '30m', aggregation: 'avg', is_counter: false },
      provenance: {
        measured_at: '2026-08-19T02:00:00Z',
        age_seconds: 600,
        source: 'InfluxDB SwitchPortStats',
        source_export_date: '2026-08-18',
      },
      coverage: COVERAGE_DECL,
      clarify: { question: 'Which fabric?', candidates: ['shq-fab-a', 'shq-fab-b'] },
      render: {
        default: 'table',
        columns: ['entity', 'value'],
        sort: 'value desc',
        filter_note: 'replicas excluded',
        chart_hint: 'line per entity',
      },
    });
    expect(minted.note).toBe(SEMANTICS_NOTE);
    expect(withoutNote(minted)).toBe(
      '{"af_semantics":true,"series":[{"t":"2026-08-19T02:00:00Z","entity":"fc1/3","metric":' +
        '"avg_iops","value":17200}],"grain":{"interval":"30m","aggregation":"avg","is_counter":' +
        'false},"provenance":{"measured_at":"2026-08-19T02:00:00Z","age_seconds":600,"source":' +
        '"InfluxDB SwitchPortStats","source_export_date":"2026-08-18"},"coverage":{"checked":' +
        '[{"what":"SRDF pair state on all 4 arrays (live query)"}],"not_checked":[{"what":"NDM ' +
        'migration sessions","why":"the API timed out — ask again"}],"cannot_cover":[{"what":' +
        '"host-side multipathing","why":"no collector runs on the ESX hosts"}]},"not_covered":' +
        '["NDM migration sessions — the API timed out — ask again","host-side multipathing — no ' +
        'collector runs on the ESX hosts"],"clarify":{"question":"Which fabric?","candidates":' +
        '["shq-fab-a","shq-fab-b"]},"render":{"default":"table","columns":["entity","value"],' +
        '"sort":"value desc","filter_note":"replicas excluded","chart_hint":"line per entity"}}',
    );
  });

  it('semantic() — facts, edges and a stated clarify: null', () => {
    const minted = semantic({
      facts: [{ entity: 'vm-01', size_tb: 12 }],
      edges: [{ from: 'vm-01', to: 'ds-7', kind: 'rides' }],
      provenance: { measured_at: '2026-09-19', source: 'RVTools export' },
      clarify: null,
    });
    expect(withoutNote(minted)).toBe(
      '{"af_semantics":true,"facts":[{"entity":"vm-01","size_tb":12}],"edges":[{"from":"vm-01",' +
        '"to":"ds-7","kind":"rides"}],"provenance":{"measured_at":"2026-09-19","source":"RVTools ' +
        'export"},"clarify":null}',
    );
  });
});
