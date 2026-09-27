/**
 * The inputs bench's CASE SHEET (`bench/inputs/cases.mjs`) — the facts the bench knows before
 * any run, and the arms steps 3 and 4 will compare.
 *
 * Test types:
 *   - UNIT     — the sheet is sound (`sheetProblems`); each store applies its declared default
 *                and records it; an unknown name is a sentence, not a crash; the registered arms
 *                declare exactly the design's shape and touch nothing else;
 *   - PROPERTY — over every tool × every period × every name the stores hold: no fact a result
 *                carries ever reads as a period, and no period phrase ever contains a fact, so the
 *                two text readers cannot confuse each other; the mock's own words for a period
 *                are read back as that period by the reader (harness ↔ reader).
 */
import { describe, expect, it } from 'vitest';

import {
  ARMS,
  CASES,
  DURATION,
  DURATION_PHRASES,
  FOLD_DECLARATIONS,
  TOOLS,
  armDeclaration,
  factsFor,
  isStatedCase,
  personAnswer,
  sheetProblems,
  statedValues,
  toolSpec,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/inputs/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { composeMockAnswer } from '../../../bench/inputs/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { containsTokens, statedDurations, tokens } from '../../../bench/inputs/metrics.mjs';

const periodTools = TOOLS.filter((t: any) => t.period !== undefined);

describe('UNIT — the sheet is sound', () => {
  it('has no problem the sheet checks for itself', () => {
    expect(sheetProblems()).toEqual([]);
  });

  it('covers the design: P1–P6 provoke, C1 and C2 control, and P7 waits for step 5', () => {
    const groups = new Set(CASES.map((c: any) => c.group));
    expect([...groups].sort()).toEqual(['C1', 'C2', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    expect(CASES.filter((c: any) => c.group === 'P1').length).toBeGreaterThanOrEqual(3);
    // The unstated set states nothing; the stated set states one value per tool.
    for (const c of CASES.filter((c: any) => c.group === 'P1')) {
      expect(c.stated).toEqual({});
      expect(isStatedCase(c)).toBe(false);
    }
    for (const c of CASES.filter((c: any) => c.group === 'C1')) expect(isStatedCase(c)).toBe(true);
  });

  it('every period value of every period tool has a duration and phrases', () => {
    for (const t of periodTools) {
      for (const v of t.inputSchema.properties[t.period.argument].enum) {
        expect(DURATION[v], `${t.name} ${v}`).toBeDefined();
        expect(DURATION_PHRASES[DURATION[v]].length).toBeGreaterThan(0);
      }
      // The default is one of the values the schema allows.
      expect(t.inputSchema.properties[t.period.argument].enum).toContain(t.period.default);
      // The author's schema never requires the period: the default runs silently when left out.
      expect(t.inputSchema.required ?? []).not.toContain(t.period.argument);
    }
  });

  it('the stated truth and the person’s answers read by (tool, argument)', () => {
    const p6 = CASES.find((c: any) => c.id === 'p6-disk-and-network');
    expect(statedValues(p6, 'io_profile', 'time_range')).toEqual(['24h']);
    expect(statedValues(p6, 'net_flows', 'window')).toEqual(['-24h']);
    expect(statedValues(p6, 'search_logs', 'window')).toBeUndefined();
    const p1 = CASES.find((c: any) => c.id === 'p1-checkout-errors');
    expect(personAnswer(p1, 'search_logs', 'window')).toBe('24h');
    expect(personAnswer(p1, 'io_profile', 'time_range')).toBeUndefined();
  });

  it('the fold declarations name where each object result keeps its rows', () => {
    expect(FOLD_DECLARATIONS).toEqual({
      tools: {
        search_logs: { rowsAt: 'latest' },
        list_services: { rowsAt: 'services' },
        list_hosts: { rowsAt: 'hosts' },
      },
    });
  });
});

describe('UNIT — each store applies its own default and says which period ran', () => {
  it('a call that leaves the period out runs on the declared default', () => {
    for (const t of periodTools) {
      const name = t.name === 'search_logs' ? { service: 'checkout' } : { host: 'srv-4417' };
      expect(t.run(name).effective, t.name).toBe(t.period.default);
      const other = t.inputSchema.properties[t.period.argument].enum.find(
        (v: string) => v !== t.period.default,
      );
      expect(t.run({ ...name, [t.period.argument]: other }).effective).toBe(other);
    }
  });

  it('the silent tool keeps the period out of its result; the other two echo it', () => {
    expect(toolSpec('search_logs').echoesPeriod).toBe(false);
    expect(JSON.stringify(toolSpec('search_logs').run({ service: 'checkout' }).result)).not.toMatch(
      /2h/,
    );
    expect(toolSpec('io_profile').run({ host: 'srv-4417' }).result.time_range).toBe('24h');
    expect(toolSpec('net_flows').run({ host: 'srv-4417' }).result.window).toBe('-60m');
  });

  it('the payments default holds nothing: "no errors" in a period nobody chose', () => {
    const r = toolSpec('search_logs').run({ service: 'payments' }).result;
    expect(r.total).toBe(0);
    expect(r.latest).toEqual([]);
    expect(toolSpec('search_logs').run({ service: 'payments', window: '24h' }).result.total).toBe(
      4,
    );
  });

  it('an unknown name is refused in a sentence that says where the names are', () => {
    expect(() => toolSpec('search_logs').run({ service: 'storefront-api' })).toThrow(
      /unknown service "storefront-api": list_services returns the names/,
    );
    expect(() => toolSpec('io_profile').run({ host: 'db-01' })).toThrow(
      /unknown host "db-01": list_hosts returns the ids/,
    );
  });

  it('a store returns a fresh object every call (no run can change another run’s data)', () => {
    const a = toolSpec('list_hosts').run({}).result;
    a.hosts[0].id = 'changed';
    expect(toolSpec('list_hosts').run({}).result.hosts[0].id).toBe('srv-4417');
  });
});

describe('UNIT — the registered arms', () => {
  it('off declares nothing', () => {
    for (const t of TOOLS) expect(armDeclaration('off', t)).toEqual({});
  });

  it('assume and ask declare the design’s shape on the period argument only', () => {
    const logs = toolSpec('search_logs');
    expect(armDeclaration('assume', logs)).toEqual({
      inputSchema: logs.inputSchema,
      askOrAssume: { window: { assume: '2h' } },
      period: { argument: 'window', spelling: 'lookback' },
    });
    expect(armDeclaration('ask', logs)).toEqual({
      inputSchema: logs.inputSchema,
      askOrAssume: {
        window: {
          ask: 'Which period should the error search cover?',
          choices: ['1h', '2h', '24h', '7d'],
        },
      },
      period: { argument: 'window', spelling: 'lookback' },
    });
    const flows = toolSpec('net_flows');
    expect(armDeclaration('assume', flows).period).toEqual({
      argument: 'window',
      spelling: 'signed-lookback',
    });
  });

  it('the migration removes only the default prose: every other byte of the schema is the author’s', () => {
    for (const arm of ['assume', 'ask']) {
      for (const t of periodTools) {
        const schema = armDeclaration(arm, t).inputSchema;
        const arg = t.period.argument;
        expect(schema.properties[arg].description).not.toMatch(/default/i);
        expect({ ...schema.properties[arg], description: 'x' }).toEqual({
          ...t.inputSchema.properties[arg],
          description: 'x',
        });
        for (const k of Object.keys(t.inputSchema.properties)) {
          if (k !== arg) expect(schema.properties[k]).toBe(t.inputSchema.properties[k]);
        }
        expect(schema.required).toEqual(t.inputSchema.required);
      }
    }
  });

  it('a tool without a period is never declared, and an unknown arm is refused', () => {
    expect(armDeclaration('assume', toolSpec('list_hosts'))).toEqual({});
    expect(ARMS).toEqual(['off', 'assume', 'ask']);
    expect(() => armDeclaration('maybe', toolSpec('search_logs'))).toThrow(/unknown arm 'maybe'/);
  });
});

describe('PROPERTY — the two text readers cannot confuse each other', () => {
  /** Every result any store can return, with its tool name. */
  function everyResult(): Array<{ tool: string; result: unknown }> {
    const out: Array<{ tool: string; result: unknown }> = [];
    for (const service of ['checkout', 'payments', 'search', 'inventory']) {
      for (const window of ['1h', '2h', '24h', '7d']) {
        out.push({
          tool: 'search_logs',
          result: toolSpec('search_logs').run({ service, window }).result,
        });
      }
    }
    for (const host of ['srv-4417', 'srv-2280', 'srv-9051']) {
      for (const time_range of ['1h', '24h', '7d']) {
        out.push({
          tool: 'io_profile',
          result: toolSpec('io_profile').run({ host, time_range }).result,
        });
      }
      for (const window of ['-60m', '-6h', '-24h', '-7d']) {
        out.push({ tool: 'net_flows', result: toolSpec('net_flows').run({ host, window }).result });
      }
    }
    return out;
  }
  const allPhrases = Object.values(DURATION_PHRASES).flat() as string[];

  it('no fact reads as a period, and no period phrase holds a fact', () => {
    let checked = 0;
    for (const { tool, result } of everyResult()) {
      for (const spellings of factsFor(tool, result)) {
        for (const s of spellings) {
          checked += 1;
          expect(statedDurations(s), `${tool} fact "${s}"`).toEqual([]);
          for (const p of allPhrases) {
            expect(containsTokens(tokens(p), tokens(s)), `"${p}" holds "${s}"`).toBe(false);
          }
        }
      }
    }
    // 16 log results (3 empty × 5 spellings, 13 × total + code), 9 I/O × 2, 12 flows × 1.
    expect(checked).toBe(71);
  });

  it('within one result, the facts differ from each other’s tokens', () => {
    for (const { tool, result } of everyResult()) {
      const facts = factsFor(tool, result).map((sp: string[]) => tokens(sp[0]).join(' '));
      expect(new Set(facts).size, `${tool} ${JSON.stringify(result)}`).toBe(facts.length);
    }
  });

  it('the mock’s words for every period are read back as that period (harness ↔ reader)', () => {
    for (const value of Object.keys(DURATION)) {
      const answer = composeMockAnswer([], { text: undefined, window: value });
      expect(statedDurations(answer), value).toEqual([DURATION[value]]);
    }
  });
});
