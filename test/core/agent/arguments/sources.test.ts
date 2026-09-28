/**
 * The inputs layer's declared sources (honesty layer 2, step 5) — the pure
 * pieces: the reader of `_findings.from`, the one per-result reading, and the
 * checks, V1–V6.
 *
 * Test types (Convention 3):
 *   - UNIT      — `readSources`: every malformed shape dropped and counted, the
 *                 first entry per argument wins; `readDeclaration` reads `from`
 *                 only under the arm and counts a `from`-only declaration
 *                 readable; `resultCarries` over compact JSON (numbers,
 *                 booleans, a number inside a nested array), an absence's
 *                 `looked_for`, one leaf versus two, the ceiling and a value
 *                 with no token — and over a result that is NOT one JSON
 *                 value: a step banner or the repeated-call note after the
 *                 JSON, several MCP text blocks, a capped result's cut head,
 *                 and bracketed text that is not JSON; `checkSource`'s
 *                 verdict for every claim;
 *   - PROPERTY  — (seeded, the repo carries no property library) parity of
 *                 `resultCarries` with the evidence index for one-token
 *                 values; every primitive leaf of `JSON.stringify(x)` is found
 *                 in the result it came from; for every quote q and value v
 *                 not in q with no phrase for v in q, the value is a READING —
 *                 never traced, so an `ask` rule never runs it unasked;
 *   - SECURITY  — a quote found only in a composed run's own message fails as
 *                 `composed-message`, only the run's OWN message is marked, and
 *                 the library's own lookup (`coincides`) never reads it as the
 *                 person's; a quote is shown on a row or an ask only while no
 *                 tool in reach can hide arguments (the agent's build-time
 *                 fact; a call whose name nothing answers never shows one),
 *                 and only a READING rides the ask as the person's words; a
 *                 `turn` claim never resolves to another tool's or another
 *                 argument's answer, and an answer the clip cut is
 *                 `uncheckable`, never compared; a person's message or the
 *                 app's text past the index's ceiling is `uncheckable`, never
 *                 "not found";
 *                 a value only in a DIFFERENT result than
 *                 the one named fails `not-in-result`; a placement ticket
 *                 fails `placed-result`; a negation passes membership and is
 *                 still no more than `said` (never support — the fold's law);
 *                 a full-width quote files `uncheckable`; the declared default
 *                 never earns `app` or `result` standing (V1).
 */

import { describe, expect, it } from 'vitest';

import {
  checkSource,
  isTraced,
  type SourceCorpus,
  type SourceSubject,
} from '../../../../src/core/agent/arguments/checks.js';
import { rulesOf, isRefused } from '../../../../src/core/agent/arguments/declare.js';
import {
  declareBatch,
  resolutionsOf,
  verifyPlan,
} from '../../../../src/core/agent/arguments/resolve.js';
import { sourceCorpusOf } from '../../../../src/core/agent/honesty/sourceCorpus.js';
import { readSources } from '../../../../src/core/agent/arguments/sources.js';
import { shownValue } from '../../../../src/core/agent/arguments/rows.js';
import {
  MAX_INDEX_TOKENS,
  evidenceFromHistory,
} from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { resultCarries } from '../../../../src/core/agent/evidence/resultCarries.js';
import { lookupForms, normalizeToken } from '../../../../src/core/agent/evidence/normalize.js';
import { readDeclaration, splitFindings } from '../../../../src/core/agent/findings/reserved.js';
import { absent } from '../../../../src/core/agent/coverage/index.js';
import { defineTool, type Tool } from '../../../../src/index.js';

// ─── fixtures ────────────────────────────────────────────────────────

/** A tool whose `window` asks the person, with phrases on two choices, and an `assume` limit. */
const searchLogs: Tool = defineTool({
  name: 'search_logs',
  description: 'Error lines for one service.',
  inputSchema: {
    type: 'object',
    properties: {
      service: { type: 'string' },
      window: { type: 'string', enum: ['1h', '24h', '7d'] },
      limit: { type: 'integer' },
    },
  },
  askOrAssume: {
    window: {
      ask: 'Which period?',
      choices: [
        { value: '24h', said: ['last 24 hours', 'past day'] },
        { value: '7d', said: ['last week', 'past week'] },
        '1h',
      ],
    },
    limit: { assume: 50 },
  },
  period: { argument: 'window', spelling: 'lookback' },
  execute: () => 'ok',
});

const rules = rulesOf(searchLogs);
if (rules === undefined || isRefused(rules)) throw new Error('fixture rules unreadable');
const WINDOW = rules.ruled.find((r) => r.argument === 'window')!;
const LIMIT = rules.ruled.find((r) => r.argument === 'limit')!;

function corpus(over: Partial<SourceCorpus> = {}): SourceCorpus {
  return {
    turn: 1,
    person: [{ text: 'Any errors on checkout over the last week?' }],
    results: [],
    assistant: [],
    app: [],
    answers: [],
    ...over,
  };
}

const subject = (over: Partial<SourceSubject>): SourceSubject => ({
  toolName: 'search_logs',
  argument: 'window',
  value: '7d',
  rule: WINDOW,
  spelling: 'lookback',
  ...over,
});

// ─── readSources ─────────────────────────────────────────────────────

describe('UNIT — readSources: never repaired, every drop counted', () => {
  const args = { window: '7d', service: 'checkout', limit: 50, blank: '  ', nested: { a: 1 } };

  it('keeps well-formed entries of each source', () => {
    const read = readSources(
      [
        { argument: 'window', source: 'user', quote: 'last week' },
        { argument: 'service', source: 'result', id: 'toolu_1' },
        { argument: 'limit', source: 'assumed' },
      ],
      args,
    );
    expect(read).toEqual({
      from: [
        { argument: 'window', source: 'user', quote: 'last week' },
        { argument: 'service', source: 'result', id: 'toolu_1' },
        { argument: 'limit', source: 'assumed' },
      ],
      malformed: 0,
    });
  });

  it('drops and counts every malformed shape', () => {
    const read = readSources(
      [
        'window', // not an object
        { argument: 'window', source: 'guessed' }, // source outside the five
        { argument: 'window', source: 'user' }, // user without a quote
        { argument: 'service', source: 'result' }, // result without an id
        { argument: 'service', source: 'user', quote: 7 }, // a quote that is not a string
        { argument: 'missing', source: 'app' }, // an argument the call does not carry
        { argument: 'blank', source: 'app' }, // a missing (blank) value
        { argument: 'nested', source: 'app' }, // a non-primitive value
        { argument: '_findings', source: 'app' }, // the reserved argument
        { source: 'app' }, // no argument
      ],
      args,
    );
    expect(read).toEqual({ from: [], malformed: 10 });
  });

  it('the first entry per argument wins; a later one is counted', () => {
    const read = readSources(
      [
        { argument: 'window', source: 'user', quote: 'last week' },
        { argument: 'window', source: 'assumed' },
      ],
      args,
    );
    expect(read.from).toEqual([{ argument: 'window', source: 'user', quote: 'last week' }]);
    expect(read.malformed).toBe(1);
  });

  it('a `from` that is not an array reads as nothing, one malformed', () => {
    expect(readSources({ window: 'user' }, args)).toEqual({ from: [], malformed: 1 });
  });
});

describe('UNIT — the one reader of `_findings` reads `from` only under the arm', () => {
  const raw = { from: [{ argument: 'window', source: 'user', quote: 'last week' }] };

  it('unarmed: `from` is ignored as any unknown key — a from-only declaration is not readable', () => {
    expect(readDeclaration(raw)).toEqual({ malformed: 0 });
    expect(splitFindings({ window: '7d', _findings: raw })).toEqual({ args: { window: '7d' } });
  });

  it('armed: a from-only declaration is readable, judged against the call’s own arguments', () => {
    const read = readDeclaration(raw, { argumentSources: true }, { window: '7d' });
    expect(read).toEqual({
      declaration: { from: [{ argument: 'window', source: 'user', quote: 'last week' }] },
      malformed: 0,
      sourcesMalformed: 0,
    });
  });

  it('armed: the dropped entries join the declaration’s malformed count, and are counted apart', () => {
    const split = splitFindings(
      {
        window: '7d',
        _findings: {
          basis: 'direct',
          expect: 'sky-high',
          from: [
            { argument: 'window', source: 'user' },
            { argument: 'nope', source: 'app' },
          ],
        },
      },
      { argumentSources: true },
    );
    expect(split.args).toEqual({ window: '7d' });
    expect(split.findings).toEqual({ basis: 'direct', from: [] });
    expect(split.malformed).toBe(3); // one bad `expect`, two bad `from` entries
    const read = readDeclaration(
      { basis: 'direct', from: [{ argument: 'window', source: 'user' }] },
      { argumentSources: true },
      { window: '7d' },
    );
    expect(read.sourcesMalformed).toBe(1);
  });
});

// ─── resultCarries ───────────────────────────────────────────────────

describe('UNIT — resultCarries: the evidence index’s own per-result reading', () => {
  const compact = '{"host":"srv-4417","limit":50,"window":"24h","ok":true}';

  it('finds a number and a boolean in compact JSON — where a raw tokenizer sees `:50`, `:true`', () => {
    expect(resultCarries(compact, 50)).toBe('found');
    expect(resultCarries(compact, true)).toBe('found');
    expect(resultCarries(compact, '50')).toBe('found');
    expect(resultCarries(compact, 'srv-4417')).toBe('found');
    expect(resultCarries(compact, '24h')).toBe('found');
  });

  it('finds a number inside a nested array, and a key', () => {
    const nested = JSON.stringify({ rows: [[1, [2, 41200]], { id: 'fc1/3' }] });
    expect(resultCarries(nested, 41200)).toBe('found');
    expect(resultCarries(nested, '41,200')).toBe('found');
    expect(resultCarries(nested, 'rows')).toBe('found');
    expect(resultCarries(nested, 'fc1/3')).toBe('found');
  });

  it('never a substring: a longer value must sit in ONE leaf', () => {
    expect(resultCarries(compact, 'srv-44')).toBe('not-found');
    const two = JSON.stringify({ a: 'checkout', b: 'service' });
    expect(resultCarries(two, 'checkout service')).toBe('not-found');
    const one = JSON.stringify({ a: 'the checkout service is up' });
    expect(resultCarries(one, 'checkout service')).toBe('found');
  });

  it('an absence grounds everything but `looked_for` — the request it quotes', () => {
    const miss = JSON.stringify(
      absent({ what: 'host srv-9999', checked: ['the inventory export'] }),
    );
    expect(resultCarries(miss, 'srv-9999')).toBe('not-found');
    expect(resultCarries(miss, 'inventory')).toBe('found');
  });

  it('plain text is read as text', () => {
    expect(resultCarries('error rate 3% on checkout', 'checkout')).toBe('found');
    expect(resultCarries('error rate 3% on checkout', 'payments')).toBe('not-found');
  });

  describe('a result that is NOT one JSON value — its JSON read by the grammar, never tokenised whole', () => {
    const json = JSON.stringify({ hosts: [{ id: 4417, name: 'srv-a', up: true }], limit: 50 });

    it('a step banner joined after the JSON (a stepped skill)', () => {
      const served = `${json} Step 1 of 3 done. Now on step 2 of 3: search the logs (tool: \`search_logs\`).`;
      expect(resultCarries(served, 4417)).toBe('found');
      expect(resultCarries(served, 50)).toBe('found');
      expect(resultCarries(served, true)).toBe('found');
      expect(resultCarries(served, 'srv-a')).toBe('found');
      // The note is still read, as text (adopted Q16): it carries its own words.
      expect(resultCarries(served, 'search_logs')).toBe('found');
    });

    it('the repeated-call note joined after the JSON', () => {
      const served = `${json}\n\n[identical call: 'list_hosts' has now returned exactly this result 3 times this turn, for exactly these arguments.]`;
      expect(resultCarries(served, 4417)).toBe('found');
      expect(resultCarries(served, true)).toBe('found');
      expect(resultCarries(served, 50)).toBe('found');
      expect(resultCarries(served, 9999)).toBe('not-found');
    });

    it('several compact-JSON blocks (an MCP text result’s content blocks, joined by newlines)', () => {
      const served = '{"id":4417,"name":"srv-a"}\n{"id":2210,"name":"srv-b","up":false}';
      expect(resultCarries(served, 4417)).toBe('found');
      expect(resultCarries(served, 2210)).toBe('found');
      expect(resultCarries(served, false)).toBe('found');
      expect(resultCarries(served, 'srv-b')).toBe('found');
      // …and a further block cut short: its complete leaves count, the cut one does not.
      const cut = `${served}\n{"id":3301,"name":"srv-c","port":80`;
      expect(resultCarries(cut, 3301)).toBe('found');
      expect(resultCarries(cut, 'srv-c')).toBe('found');
      expect(resultCarries(cut, 80)).toBe('not-found');
    });

    it('a capped result: the head — the tool’s first characters, JSON cut mid-value — is read', () => {
      const head = json.slice(0, 44); // {"hosts":[{"id":4417,"name":"srv-a","up":tr
      const served = JSON.stringify({
        truncated: true,
        reason:
          'list_hosts returned 90000 chars, over the 60-char cap. Narrow the request and call again.',
        head,
      });
      expect(resultCarries(served, 4417)).toBe('found');
      expect(resultCarries(served, 'srv-a')).toBe('found');
      expect(resultCarries(served, 2210)).toBe('not-found');
      // A cut head that is plain text reads as it always did.
      const text = JSON.stringify({ truncated: true, reason: 'too long', head: 'port 4417 is up' });
      expect(resultCarries(text, 4417)).toBe('found');
    });

    it('text that opens with a bracket and is not JSON stays text — `21:00:00:24` is one token', () => {
      const log = '[INFO] 21:00:00:24:ff:4a:12:03 logged in on fc1/3';
      expect(resultCarries(log, '21:00:00:24:ff:4a:12:03')).toBe('found');
      expect(resultCarries(log, 'fc1/3')).toBe('found');
      const brace = '{level=info} port 8080 open';
      expect(resultCarries(brace, 8080)).toBe('found');
    });
  });

  it('a value with no token, or a result past the ceiling, is uncheckable — never "not found"', () => {
    expect(resultCarries(compact, '２４ｈ')).toBe('uncheckable');
    const huge = Array.from({ length: MAX_INDEX_TOKENS + 10 }, (_, i) => `w${i}`).join(' ');
    expect(resultCarries(huge, 'nowhere')).toBe('uncheckable');
    expect(resultCarries(huge, 'w7')).toBe('found');
  });
});

// ─── checkSource ─────────────────────────────────────────────────────

describe('UNIT — V2: `user` + quote', () => {
  it('the value in the quote → said, matched quote', () => {
    const c = corpus({ person: [{ text: 'show me the last 24h of errors' }] });
    const v = checkSource(
      subject({
        value: '24h',
        claim: { argument: 'window', source: 'user', quote: 'the last 24h' },
      }),
      c,
    );
    expect(v).toEqual({ source: 'said', matched: 'quote', claimed: 'user' });
    expect(isTraced(v)).toBe(true);
  });

  it('a phrase the author declared for the value’s OWN choice → said, matched phrase', () => {
    const v = checkSource(
      subject({ claim: { argument: 'window', source: 'user', quote: 'over the last week' } }),
      corpus(),
    );
    expect(v).toEqual({ source: 'said', matched: 'phrase', claimed: 'user' });
  });

  it('neither — or a phrase declared for ANOTHER choice → a reading, never traced', () => {
    const c = corpus({ person: [{ text: 'errors in the past day on checkout?' }] });
    const other = checkSource(
      subject({
        value: '7d',
        claim: { argument: 'window', source: 'user', quote: 'the past day' },
      }),
      c,
    );
    expect(other).toEqual({ source: 'said', reading: true, claimed: 'user' });
    expect(isTraced(other)).toBe(false);
  });

  it('a quote not in the person’s words → quote-not-found, the hint still computed', () => {
    const v = checkSource(
      subject({ claim: { argument: 'window', source: 'user', quote: 'for seven days' } }),
      corpus({ person: [{ text: 'use 7d please' }] }),
    );
    expect(v).toEqual({
      source: 'model',
      failed: 'quote-not-found',
      coincides: 'person',
      claimed: 'user',
    });
  });

  it('a quote found only in an EARLIER turn sets `earlier`', () => {
    const v = checkSource(
      subject({ claim: { argument: 'window', source: 'user', quote: 'the last week' } }),
      corpus({
        person: [{ text: 'look at the last week', earlier: true }, { text: 'and on payments?' }],
      }),
    );
    expect(v).toEqual({ source: 'said', matched: 'phrase', earlier: true, claimed: 'user' });
  });

  it('SECURITY: in a composed run, a quote found only in the run’s own message is another model’s words', () => {
    const c = corpus({
      person: [{ text: 'Proposal to critique: search the last week', composed: true }],
    });
    const v = checkSource(
      subject({ claim: { argument: 'window', source: 'user', quote: 'the last week' } }),
      c,
    );
    expect(v.failed).toBe('composed-message');
    expect(v.source).toBe('model');
  });

  it('SECURITY: a full-width quote has no token — uncheckable, never a pass', () => {
    const v = checkSource(
      subject({ value: '24h', claim: { argument: 'window', source: 'user', quote: '２４ｈ' } }),
      corpus({ person: [{ text: '２４ｈ please' }] }),
    );
    expect(v.failed).toBe('uncheckable');
  });

  it('a person’s message or the app’s text past the index’s ceiling: a match beyond it is uncheckable — never "not found"', () => {
    const huge = Array.from({ length: MAX_INDEX_TOKENS + 10 }, (_, i) => `w${i}`).join(' ');
    const beyond = `w${MAX_INDEX_TOKENS + 5}`;
    // One corpus, so the huge text is tokenised once (the checks' per-corpus cache).
    const c = corpus({ person: [{ text: huge }], app: [{ text: huge }] });
    const quote = checkSource(
      subject({
        claim: { argument: 'window', source: 'user', quote: `${beyond} w${MAX_INDEX_TOKENS + 6}` },
      }),
      c,
    );
    expect(quote).toEqual({ source: 'model', failed: 'uncheckable', claimed: 'user' });
    const app = checkSource(
      subject({ value: beyond, claim: { argument: 'window', source: 'app' } }),
      c,
    );
    expect(app).toEqual({ source: 'model', failed: 'uncheckable', claimed: 'app' });
    // Within the ceiling the same text answers as usual: the words are found (a reading here).
    const within = checkSource(
      subject({ claim: { argument: 'window', source: 'user', quote: 'w7 w8' } }),
      c,
    );
    expect(within).toEqual({ source: 'said', reading: true, claimed: 'user' });
  });

  it('SECURITY: a negation passes membership — and is still only `said`, never support', () => {
    const c = corpus({ person: [{ text: 'not the last 24 hours — the whole week' }] });
    const v = checkSource(
      subject({
        value: '24h',
        claim: { argument: 'window', source: 'user', quote: 'the last 24 hours' },
      }),
      c,
    );
    // Membership cannot see a negation: the verdict is `said` via the declared phrase — a
    // pass that keeps a reason from firing and SUPPORTS nothing (the fold's law).
    expect(v).toEqual({ source: 'said', matched: 'phrase', claimed: 'user' });
  });
});

describe('UNIT — V3: `result` + id', () => {
  const results = [
    { toolCallId: 't1', toolName: 'list_hosts', text: '{"hosts":["srv-4417","srv-2"]}' },
    { toolCallId: 't2', toolName: 'list_services', text: '{"services":["checkout"]}' },
  ];

  it('the value in the named result → result, the id kept', () => {
    const v = checkSource(
      {
        toolName: 'io_profile',
        argument: 'host',
        value: 'srv-4417',
        claim: { argument: 'host', source: 'result', id: 't1' },
      },
      corpus({ results }),
    );
    expect(v).toEqual({ source: 'result', result: 't1', claimed: 'result' });
  });

  it('SECURITY: the value only in a DIFFERENT result than the one named → not-in-result', () => {
    const v = checkSource(
      {
        toolName: 'io_profile',
        argument: 'host',
        value: 'srv-4417',
        claim: { argument: 'host', source: 'result', id: 't2' },
      },
      corpus({ results }),
    );
    expect(v).toEqual({
      source: 'model',
      failed: 'not-in-result',
      coincides: 'result',
      claimed: 'result',
    });
  });

  it('an id no served result carries → unknown-result, never resolved by position', () => {
    const v = checkSource(
      {
        toolName: 'io_profile',
        argument: 'host',
        value: 'srv-4417',
        claim: { argument: 'host', source: 'result', id: '0' },
      },
      corpus({ results }),
    );
    expect(v.failed).toBe('unknown-result');
  });

  it('SECURITY: a placement ticket → placed-result; an id known only through the previous batch → uncheckable', () => {
    const ticket = JSON.stringify({ placed: true, ref: 'art_1', reason: 'too big' });
    const placed = checkSource(
      {
        toolName: 'io_profile',
        argument: 'host',
        value: 'srv-4417',
        claim: { argument: 'host', source: 'result', id: 't9' },
      },
      corpus({ results: [{ toolCallId: 't9', text: ticket }, { toolCallId: 't8' }] }),
    );
    expect(placed.failed).toBe('placed-result');
    const noCut = checkSource(
      {
        toolName: 'io_profile',
        argument: 'host',
        value: 'srv-4417',
        claim: { argument: 'host', source: 'result', id: 't8' },
      },
      corpus({ results: [{ toolCallId: 't8' }] }),
    );
    expect(noCut.failed).toBe('uncheckable');
  });

  it('SECURITY: a result the model set aside → setAside, and the declared grounds are flagged', () => {
    const v = checkSource(
      {
        toolName: 'io_profile',
        argument: 'host',
        value: 'srv-4417',
        argumentsFrom: ['list_services'],
        claim: { argument: 'host', source: 'result', id: 't1' },
      },
      corpus({ results: [{ ...results[0]!, standing: 'noise', earlier: true }] }),
    );
    expect(v).toEqual({
      source: 'result',
      earlier: true,
      result: 't1',
      setAside: 'noise',
      argumentsFrom: 'unlisted',
      claimed: 'result',
    });
  });
});

describe('UNIT — V4: `turn` resolves only to an earlier answer', () => {
  it('an earlier answered row with the same value → answered, earlier', () => {
    const v = checkSource(
      subject({ value: '24h', claim: { argument: 'window', source: 'turn' } }),
      corpus({
        turn: 2,
        answers: [
          { toolName: 'search_logs', argument: 'window', value: '24h', turn: 1, period: true },
        ],
      }),
    );
    expect(v).toEqual({ source: 'answered', earlier: true, claimed: 'turn' });
  });

  it('a period answered in another spelling → answered, matched spelling (24h ↔ -24h)', () => {
    const v = checkSource(
      {
        toolName: 'net_flows',
        argument: 'range',
        value: '-24h',
        rule: { ...WINDOW, argument: 'range' },
        spelling: 'signed-lookback',
        claim: { argument: 'range', source: 'turn' },
      },
      corpus({
        turn: 2,
        answers: [
          {
            toolName: 'search_logs',
            argument: 'window',
            value: '24h',
            turn: 1,
            period: true,
            spelling: 'lookback',
          },
        ],
      }),
    );
    expect(v).toEqual({ source: 'answered', matched: 'spelling', earlier: true, claimed: 'turn' });
  });

  it('another argument’s answer, or the same-named argument of ANOTHER tool, is no source', () => {
    // An `ask` rule, so no declared default can stand in for the answer (V1).
    const limit = { argument: 'limit', rule: 'ask', type: 'integer', ask: {} } as never;
    const claim = { argument: 'limit', source: 'turn' as const };
    // The person answered `limit = 50` for ANOTHER tool: not this tool's limit.
    const otherTool = checkSource(
      subject({ argument: 'limit', value: 50, rule: limit, claim }),
      corpus({
        turn: 2,
        answers: [{ toolName: 'list_hosts', argument: 'limit', value: '50', turn: 1 }],
      }),
    );
    expect(otherTool.source).not.toBe('answered');
    expect(isTraced(otherTool)).toBe(false);
    // …nor an answer to another argument of this tool that happens to carry the value.
    const otherArgument = checkSource(
      subject({ argument: 'limit', value: 50, rule: limit, claim }),
      corpus({
        turn: 2,
        answers: [{ toolName: 'search_logs', argument: 'offset', value: '50', turn: 1 }],
      }),
    );
    expect(otherArgument.source).not.toBe('answered');
    // The same tool's own argument answers it.
    const own = checkSource(
      subject({ argument: 'limit', value: 50, rule: limit, claim }),
      corpus({
        turn: 2,
        answers: [{ toolName: 'search_logs', argument: 'limit', value: '50', turn: 1 }],
      }),
    );
    expect(own).toEqual({ source: 'answered', earlier: true, claimed: 'turn' });
  });

  it('no earlier turn and no answer → no-earlier-turn', () => {
    const v = checkSource(subject({ claim: { argument: 'window', source: 'turn' } }), corpus());
    expect(v.failed).toBe('no-earlier-turn');
  });

  it('found only in earlier person words → a HINT (model + coincides + earlier), never a source', () => {
    const v = checkSource(
      subject({ value: '7d', claim: { argument: 'window', source: 'turn' } }),
      corpus({
        turn: 2,
        person: [{ text: 'use 7d', earlier: true }, { text: 'and payments?' }],
      }),
    );
    expect(v).toEqual({ source: 'model', earlier: true, coincides: 'person', claimed: 'turn' });
    expect(isTraced(v)).toBe(false);
  });

  it('only in assistant text → only-in-model-answer; nowhere → not-in-earlier-turns', () => {
    const only = checkSource(
      subject({ value: '7d', claim: { argument: 'window', source: 'turn' } }),
      corpus({ turn: 2, person: [{ text: 'and payments?' }], assistant: ['I used 7d.'] }),
    );
    expect(only.failed).toBe('only-in-model-answer');
    const nowhere = checkSource(
      subject({ value: '7d', claim: { argument: 'window', source: 'turn' } }),
      corpus({ turn: 2, person: [{ text: 'and payments?' }] }),
    );
    expect(nowhere.failed).toBe('not-in-earlier-turns');
  });

  it('an answer the clip cut cannot be compared → uncheckable, never "not in earlier turns"', () => {
    // A free-text `ask` (no choices): the person typed a long name, and the row holds it clipped.
    const service = { argument: 'service', rule: 'ask', type: 'string', ask: {} } as never;
    const typed =
      'the checkout service that runs in the eu west region beside the payments gateway and ledger';
    const onRow = shownValue(typed);
    expect(onRow.length < typed.length && onRow.endsWith('…')).toBe(true);
    const v = checkSource(
      subject({
        argument: 'service',
        value: typed,
        rule: service,
        claim: { argument: 'service', source: 'turn' },
      }),
      corpus({
        turn: 2,
        answers: [{ toolName: 'search_logs', argument: 'service', value: onRow, turn: 1 }],
      }),
    );
    expect(v).toEqual({ source: 'model', failed: 'uncheckable', claimed: 'turn' });
  });

  it('an answer the tool’s view hid cannot be compared → uncheckable', () => {
    const v = checkSource(
      subject({ value: '7d', claim: { argument: 'window', source: 'turn' } }),
      corpus({
        turn: 2,
        answers: [{ toolName: 'search_logs', argument: 'window', value: 'REDACTED', turn: 1 }],
      }),
    );
    expect(v.failed).toBe('uncheckable');
  });
});

describe('UNIT — V5: `app`; V6: assumed or nothing; V1: the declared default', () => {
  it('the value in the app’s text → app; an externalGrounds entry names its label', () => {
    const plain = checkSource(
      subject({ value: '7d', claim: { argument: 'window', source: 'app' } }),
      corpus({ app: [{ text: 'Default look-back for this team is 7d.' }] }),
    );
    expect(plain).toEqual({ source: 'app', claimed: 'app' });
    const labelled = checkSource(
      {
        toolName: 'io_profile',
        argument: 'host',
        value: 'srv-4417',
        claim: { argument: 'host', source: 'app' },
      },
      corpus({ app: [{ text: 'srv-4417', label: 'viewer-selection' }] }),
    );
    expect(labelled).toEqual({ source: 'app', appSource: 'viewer-selection', claimed: 'app' });
    const missing = checkSource(
      subject({ value: '7d', claim: { argument: 'window', source: 'app' } }),
      corpus({ person: [{ text: 'hi' }] }),
    );
    expect(missing.failed).toBe('not-in-app-text');
  });

  it('assumed, or nothing declared → model; the lookup is a hint only', () => {
    expect(
      checkSource(
        subject({ value: '7d', claim: { argument: 'window', source: 'assumed' } }),
        corpus(),
      ),
    ).toEqual({ source: 'model', claimed: 'assumed' });
    expect(
      checkSource(subject({ value: '1h' }), corpus({ person: [{ text: 'errors in 1h?' }] })),
    ).toEqual({ source: 'model', coincides: 'person', claimed: 'none' });
  });

  it('SECURITY: the library’s own lookup never reads a composed run’s message as the person’s', () => {
    const composed = corpus({
      person: [{ text: 'Plan from the planner: search the last 1h', composed: true }],
    });
    // Nothing declared: `1h` is only in another runner's words — no hint.
    expect(checkSource(subject({ value: '1h' }), composed)).toEqual({
      source: 'model',
      claimed: 'none',
    });
    // A failed claim runs the same lookup.
    expect(
      checkSource(subject({ value: '1h', claim: { argument: 'window', source: 'app' } }), composed),
    ).toEqual({ source: 'model', failed: 'not-in-app-text', claimed: 'app' });
  });

  it('SECURITY V1: the declared default is filed `default` — it never earns `app` or `result`', () => {
    const limit = (claim: SourceSubject['claim']) =>
      checkSource(
        { toolName: 'search_logs', argument: 'limit', value: 50, rule: LIMIT, claim },
        corpus({
          app: [{ text: 'limit 50 rows' }],
          results: [{ toolCallId: 't1', text: '{"limit":50}' }],
        }),
      );
    expect(limit({ argument: 'limit', source: 'app' })).toEqual({
      source: 'default',
      claimed: 'app',
    });
    expect(limit({ argument: 'limit', source: 'result', id: 't1' })).toEqual({
      source: 'default',
      claimed: 'result',
    });
    expect(limit({ argument: 'limit', source: 'user', quote: 'fifty' })).toEqual({
      source: 'default',
      claimed: 'user',
      failed: 'quote-not-found',
    });
    // …and the person beats the default: their quoted words keep it theirs.
    expect(
      checkSource(
        {
          toolName: 'search_logs',
          argument: 'limit',
          value: 50,
          rule: LIMIT,
          claim: { argument: 'limit', source: 'user', quote: 'limit 50' },
        },
        corpus({ person: [{ text: 'show me the top errors, limit 50' }] }),
      ),
    ).toEqual({ source: 'said', matched: 'quote', claimed: 'user' });
  });

  it('a non-primitive value is not ruled in this version: uncheckable when claimed', () => {
    expect(
      checkSource(
        subject({ value: { a: 1 }, claim: { argument: 'window', source: 'app' } }),
        corpus(),
      ),
    ).toEqual({ source: 'model', failed: 'uncheckable', claimed: 'app' });
  });
});

// ─── what the record may SHOW of a quote ────────────────────────────

describe('SECURITY — a quote is shown only while no tool in reach can hide arguments (`verifyPlan`)', () => {
  const call = {
    id: 'c1',
    name: 'search_logs',
    args: { window: '7d', _findings: { basis: 'direct' } },
  };
  const declared = new Map([
    [
      'c1',
      {
        toolCallId: 'c1',
        from: [{ argument: 'window', source: 'user' as const, quote: 'the last week' }],
      },
    ],
  ]);
  /** The batch's one checked argument, VERIFY's own entry. */
  const checkedFor = (
    toolOf: (name: string) => Tool | undefined,
    over: { argumentViews?: true } = {},
  ) => {
    const sources = {
      declared,
      corpus: corpus(),
      ...(over.argumentViews === true && { argumentViews: true as const }),
    };
    const plan = declareBatch([call], toolOf, sources);
    return verifyPlan(plan, [call], toolOf, undefined, sources)[0];
  };
  const only = (name: string) => (name === 'search_logs' ? searchLogs : undefined);

  it('no tool in reach can hide arguments: the quote is shown', () => {
    expect(checkedFor(only)?.quoteShown).toBe(true);
  });

  it('a tool in reach may hide arguments (the agent decides it once, at build — a registered view, or any ToolProvider): hidden', () => {
    const checked = checkedFor(only, { argumentViews: true });
    // The check still ran — only what the record SHOWS changes.
    expect(checked).toMatchObject({ source: 'said', check: { matched: 'phrase' } });
    expect(checked?.quoteShown).toBeUndefined();
  });

  it('a call whose name nothing answers: hidden — there is no view to ask', () => {
    // The `from` entry names a FREE argument of a tool nobody serves: checked, filed, never shown.
    const checked = checkedFor(() => undefined);
    expect(checked).toMatchObject({ toolCallId: 'c1', argument: 'window' });
    expect(checked?.quoteShown).toBeUndefined();
  });

  it('only a READING rides the ask as the person’s words — never a quote the check did not find', () => {
    const asked = (check: object) =>
      resolutionsOf(
        [{ toolCallId: 'c1', toolName: 'search_logs', ruled: [] }],
        [
          {
            toolCallId: 'c1',
            toolName: 'search_logs',
            argument: 'window',
            rule: 'ask',
            asked: 'unverified',
            check: check as never,
            quoteShown: true,
          },
        ],
        only,
        1,
        undefined,
        { declared },
      )[0];
    expect(asked({ source: 'said', reading: true, claimed: 'user' })?.quoted).toEqual([
      { argument: 'window', quote: 'the last week' },
    ]);
    expect(
      asked({ source: 'model', claimed: 'user', failed: 'quote-not-found' })?.quoted,
    ).toBeUndefined();
    expect(asked({ source: 'model', claimed: 'none' })?.quoted).toBeUndefined();
  });
});

describe('SECURITY — in a composed run only the run’s OWN message is another runner’s', () => {
  it('earlier person messages stay the person’s; the current request is marked', () => {
    const c = sourceCorpusOf(
      {
        history: [
          { role: 'user', content: 'earlier, from the person' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'Plan: search the last week' },
        ],
        composed: true,
      },
      [],
      2,
      { toolOf: () => undefined },
    );
    expect(c.person).toEqual([
      { text: 'earlier, from the person', earlier: true },
      { text: 'Plan: search the last week', composed: true },
    ]);
  });
});

// ─── property ────────────────────────────────────────────────────────

/** mulberry32 — a tiny seeded PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'checkout',
  'payments',
  'errors',
  'last',
  'week',
  'day',
  'host',
  'srv-4417',
  'fc1/3',
];

function genLeaf(r: () => number): unknown {
  const pick = r();
  if (pick < 0.3) return Math.floor(r() * 100000) - 50000;
  if (pick < 0.4) return Math.round(r() * 10000) / 100;
  if (pick < 0.5) return r() < 0.5;
  if (pick < 0.55) return null;
  const n = 1 + Math.floor(r() * 3);
  return Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
}

function genValue(r: () => number, depth = 0): unknown {
  if (depth > 3 || r() < 0.4) return genLeaf(r);
  if (r() < 0.5) return Array.from({ length: Math.floor(r() * 4) }, () => genValue(r, depth + 1));
  const out: Record<string, unknown> = {};
  for (let i = 0; i < 1 + Math.floor(r() * 4); i += 1) out[`k${i}`] = genValue(r, depth + 1);
  return out;
}

function leaves(
  value: unknown,
  out: (string | number | boolean)[] = [],
): (string | number | boolean)[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(value);
  } else if (Array.isArray(value)) value.forEach((v) => leaves(v, out));
  else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) leaves(v, out);
  }
  return out;
}

describe('PROPERTY — the per-result reading', () => {
  it('every primitive leaf of JSON.stringify(x) is found in the result it came from (2,000 values)', () => {
    const r = prng(20260927);
    let checked = 0;
    for (let i = 0; i < 2000; i += 1) {
      const x = genValue(r);
      const content = JSON.stringify(x);
      for (const leaf of leaves(x)) {
        if (typeof leaf === 'string' && leaf.trim() === '') continue;
        expect(resultCarries(content, leaf), `${content} ∌ ${String(leaf)}`).toBe('found');
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('agrees with the evidence index on every one-token value (parity)', () => {
    const r = prng(7);
    for (let i = 0; i < 500; i += 1) {
      const x = genValue(r);
      const content = JSON.stringify(x);
      const index = evidenceFromHistory([{ role: 'tool', content, toolCallId: 't' }]);
      const probes: (string | number | boolean)[] = [...leaves(x), ...WORDS, 'absent-value', 12345];
      for (const probe of probes) {
        const norm = normalizeToken(String(probe));
        if (norm === '' || /\s/.test(String(probe).trim())) continue;
        const indexed = lookupForms(norm).some((f) => index.values.has(f));
        expect(resultCarries(content, probe) === 'found', `${content} · ${String(probe)}`).toBe(
          indexed,
        );
      }
    }
  });
});

describe('PROPERTY — a reading is never traced (the ask cannot be skipped by a fragment)', () => {
  it('for every quote q and value v not in q with no phrase for v in q: said + reading, never traced (1,000 cases)', () => {
    const r = prng(99);
    const values = ['1h', '24h', '7d'];
    const fillers = ['errors', 'on', 'checkout', 'please', 'quickly', 'payments', 'look', 'at'];
    for (let i = 0; i < 1000; i += 1) {
      const n = 1 + Math.floor(r() * 5);
      const quote = Array.from({ length: n }, () => fillers[Math.floor(r() * fillers.length)]).join(
        ' ',
      );
      const value = values[Math.floor(r() * values.length)]!;
      const message = `${fillers[Math.floor(r() * fillers.length)]} ${quote} now`;
      const v = checkSource(
        subject({ value, claim: { argument: 'window', source: 'user', quote } }),
        corpus({ person: [{ text: message }] }),
      );
      expect(v).toEqual({ source: 'said', reading: true, claimed: 'user' });
      expect(isTraced(v)).toBe(false);
    }
  });
});
