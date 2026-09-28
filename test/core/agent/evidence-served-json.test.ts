/**
 * A served tool result that is NOT one JSON value — read by the JSON grammar
 * as far as it goes (`evidence/servedJson.ts`, through `evidenceIndex.ts` ·
 * `readResult`, the ONE reading the evidence index and the declared-sources
 * check share).
 *
 * Test types (Convention 3):
 *   - UNIT      — `leadingJsonValues`: one value and the note after it,
 *                 several blocks, a block that never closes, text that opens
 *                 with a bracket and is not JSON; `jsonPrefixOf`: the
 *                 complete leaves of a value cut short (keys, strings with
 *                 escapes, numbers in the parsed walk's spelling, booleans;
 *                 never `null`, never the token the text ends inside), the
 *                 whole words of a string the cut falls inside (never the
 *                 word it may have split; none when an escape is cut or no
 *                 space is left), and `undefined` for a value that CLOSES or
 *                 a token that is not JSON; `readResult`: the tail, a cut
 *                 block after complete ones, a cut string's words as text,
 *                 an absence's `looked_for` still projected away behind a
 *                 note, a capped result's head read as a result;
 *   - PROPERTY  — (seeded — the repo carries no property library) over
 *                 generated JSON values: a value with a note after it reads
 *                 as that value plus the note; every prefix of a value's
 *                 text yields leaves that are, in order, a prefix of the
 *                 value's own leaves — the reading never invents a leaf —
 *                 and a cut string's words are the start of the leaf it was
 *                 cut from, up to a space in it — never a split word;
 *   - INTEGRATION — the evidence index (`evidenceFromHistory`, the gate's
 *                 corpus) finds a number, a boolean and a string in a result
 *                 a framework note follows, and files that result as their
 *                 carrier — the gate's false flag closed at the one reader;
 *                 a whole word of a string a tool cut is grounded, the word
 *                 the cut split is not;
 *   - BOUNDARY  — whole JSON reads exactly as before (the same parsed
 *                 value); plain text and a lone brace stay text.
 */

import { describe, expect, it } from 'vitest';

import { absent } from '../../../src/core/agent/coverage/index.js';
import { evidenceFromHistory, readResult } from '../../../src/core/agent/evidence/evidenceIndex.js';
import { jsonPrefixOf, leadingJsonValues } from '../../../src/core/agent/evidence/servedJson.js';

const NOTE =
  "\n\n[identical call: 'list_hosts' has now returned exactly this result 2 times this turn, for exactly these arguments.]";

describe('UNIT — leadingJsonValues', () => {
  it('one value, and the note after it', () => {
    expect(leadingJsonValues(`{"id":4417}${NOTE}`)).toEqual({
      values: [{ id: 4417 }],
      rest: NOTE.trim(),
    });
  });

  it('several blocks separated by whitespace — an MCP text result', () => {
    expect(leadingJsonValues('{"id":1}\n{"id":2}\n[3]').values).toEqual([
      { id: 1 },
      { id: 2 },
      [3],
    ]);
  });

  it('a block that never closes, and bracketed text that is not JSON, end the values', () => {
    expect(leadingJsonValues('{"id":1}\n{"id":2,"na')).toEqual({
      values: [{ id: 1 }],
      rest: '{"id":2,"na',
    });
    expect(leadingJsonValues('[INFO] started').values).toEqual([]);
    expect(leadingJsonValues('plain text').values).toEqual([]);
  });
});

describe('UNIT — jsonPrefixOf', () => {
  const leavesOf = (text: string) => jsonPrefixOf(text)?.leaves;

  it('the complete leaves of a value cut short, in the parsed walk’s spelling', () => {
    expect(leavesOf('{"hosts":[{"id":4417,"up":true,"ratio":1.50,"x":null},{"id":22')).toEqual([
      'hosts',
      'id',
      '4417',
      'up',
      'true',
      'ratio',
      '1.5',
      'x',
      'id',
    ]);
    expect(leavesOf('["a\\"b","\\u0041", -0.0e1')).toEqual(['a"b', 'A']);
  });

  it('never the token the text ends inside — it may be cut', () => {
    expect(jsonPrefixOf('{"id":4417,"name":"srv-44')).toEqual({ leaves: ['id', '4417', 'name'] });
    expect(jsonPrefixOf('{"up":tr')).toEqual({ leaves: ['up'] });
    expect(jsonPrefixOf('[12, 34')).toEqual({ leaves: ['12'] });
  });

  it('a string the cut falls inside: its whole words, never the word the cut may have split', () => {
    expect(jsonPrefixOf('{"id":4417,"msg":"disk full on host-7 and mo')).toEqual({
      leaves: ['id', '4417', 'msg'],
      words: 'disk full on host-7 and',
    });
    // Escapes before the last space are read; a cut KEY yields its words too.
    expect(jsonPrefixOf('{"a \\"quoted\\" key na')).toEqual({
      leaves: [],
      words: 'a "quoted" key',
    });
    // Cut right after a space: every word before it is whole.
    expect(jsonPrefixOf('["port fc1/3 down ')?.words).toBe('port fc1/3 down');
  });

  it('no words when no space is left, or the part before it is not a JSON string', () => {
    expect(jsonPrefixOf('{"msg":"srv-4417,srv-22')).toEqual({ leaves: ['msg'] });
    expect(jsonPrefixOf('{"msg":" host')).toEqual({ leaves: ['msg'] });
    // `\ ` is no JSON escape: nothing is read from the cut string.
    expect(jsonPrefixOf('{"msg":"a\\ b')).toEqual({ leaves: ['msg'] });
  });

  it('undefined for a value that CLOSES, a token that is not JSON, or a mismatched bracket', () => {
    expect(jsonPrefixOf('{"a":1,}')).toBeUndefined();
    expect(jsonPrefixOf('[INFO] 21:00:00 up')).toBeUndefined();
    expect(jsonPrefixOf('{level=info')).toBeUndefined();
    expect(jsonPrefixOf('{"a":[1}')).toBeUndefined();
    expect(jsonPrefixOf('plain')).toBeUndefined();
  });
});

describe('UNIT — readResult', () => {
  it('whole JSON reads as it always did', () => {
    expect(readResult('{"id":4417,"up":true}')).toEqual({ parsed: { id: 4417, up: true } });
  });

  it('JSON with a note after it: the value, and the note as `tail`', () => {
    expect(readResult(`{"id":4417}${NOTE}`)).toEqual({ parsed: { id: 4417 }, tail: NOTE.trim() });
  });

  it('complete blocks, then one cut short: the values, then the cut block’s leaves', () => {
    expect(readResult('{"id":1}\n{"id":2,"name":"b')).toEqual({
      parsed: [{ id: 1 }, ['id', '2', 'name']],
    });
  });

  it('JSON a tool cut inside a string: the leaves, and the string’s whole words as `tail`', () => {
    expect(readResult('{"id":4417,"msg":"disk full on host-7 and mo')).toEqual({
      parsed: ['id', '4417', 'msg'],
      tail: 'disk full on host-7 and',
    });
    expect(readResult('{"id":1}\n{"id":2,"msg":"link down on fc1/3 sin')).toEqual({
      parsed: [{ id: 1 }, ['id', '2', 'msg']],
      tail: 'link down on fc1/3',
    });
  });

  it('an absence behind a note still drops `looked_for` — the request it quotes', () => {
    const miss = JSON.stringify(absent({ what: 'host srv-9999', checked: ['the inventory'] }));
    const read = readResult(`${miss}${NOTE}`);
    expect('parsed' in read).toBe(true);
    expect(JSON.stringify(read)).not.toContain('srv-9999');
  });

  it('a capped result: the marker as served, and its head read as a result of its own', () => {
    const head = '{"hosts":[{"id":4417,"up":true},{"id":22';
    const read = readResult(JSON.stringify({ truncated: true, reason: 'over the cap', head }));
    expect(read).toEqual({
      parsed: [
        { truncated: true, reason: 'over the cap', head },
        ['hosts', 'id', '4417', 'up', 'true', 'id'],
      ],
    });
  });

  it('plain text and bracketed text that is not JSON stay text', () => {
    expect(readResult('port 8080 open')).toEqual({ text: 'port 8080 open' });
    expect(readResult('[INFO] up')).toEqual({ text: '[INFO] up' });
  });
});

// ─── PROPERTY ────────────────────────────────────────────────────────

/** A seeded generator of JSON values — objects, arrays, strings, numbers, booleans, null. */
function generator(seed0: number) {
  let seed = seed0;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const int = (n: number) => Math.floor(next() * n);
  const words = ['srv-a', 'fc1/3', 'a "quoted" word', 'x\\y', 'line\nbreak', 'ünï', '41,200', ''];
  const value = (depth: number): unknown => {
    const kind = depth > 2 ? int(4) : int(6);
    switch (kind) {
      case 0:
        return words[int(words.length)];
      case 1:
        return int(2) === 0 ? int(100000) : -int(1000) / 8;
      case 2:
        return int(2) === 0;
      case 3:
        return null;
      case 4:
        return Array.from({ length: int(4) }, () => value(depth + 1));
      default:
        return Object.fromEntries(
          Array.from({ length: int(4) }, (_, i) => [`k${i}${words[int(3)]}`, value(depth + 1)]),
        );
    }
  };
  return () => (int(2) === 0 ? { root: value(0) } : [value(0), value(1)]);
}

/** The parsed walk's leaves, in order — keys and primitive values, as strings; never `null`. */
function leavesOf(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leavesOf);
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [k, ...leavesOf(v)]);
}

describe('PROPERTY — the grammar never invents a leaf (500 generated values)', () => {
  it('a value with a note after it reads as the value, and the note as text', () => {
    const gen = generator(97);
    for (let i = 0; i < 500; i += 1) {
      const v = JSON.parse(JSON.stringify(gen())) as unknown;
      const read = readResult(`${JSON.stringify(v)} Step 1 of 2 done.`);
      expect(read).toEqual({ parsed: v, tail: 'Step 1 of 2 done.' });
    }
  });

  it('every prefix of a value’s text yields, in order, a prefix of the value’s own leaves', () => {
    const gen = generator(4242);
    let withWords = 0;
    for (let i = 0; i < 500; i += 1) {
      const v = JSON.parse(JSON.stringify(gen())) as unknown;
      const text = JSON.stringify(v);
      const all = leavesOf(v);
      for (let cut = 1; cut < text.length; cut += 1 + (i % 3)) {
        const read = jsonPrefixOf(text.slice(0, cut));
        if (read === undefined) continue; // the prefix closed a value: not a cut prefix
        expect(all.slice(0, read.leaves.length)).toEqual(read.leaves);
        if (read.words === undefined) continue;
        // The words are the start of the string the cut fell inside, up to a space in it.
        withWords += 1;
        const cutFrom = all[read.leaves.length] as string;
        expect(cutFrom.startsWith(read.words)).toBe(true);
        expect(cutFrom[read.words.length]).toBe(' ');
      }
    }
    expect(withWords).toBeGreaterThan(0);
  });
});

// ─── INTEGRATION — the gate's corpus ─────────────────────────────────

describe('INTEGRATION — the evidence index reads the tool’s JSON before a framework note', () => {
  it('a number, a boolean and a string in a noted result are grounded, and carried by it', () => {
    const content = `${JSON.stringify({ hosts: [{ id: 4417, name: 'srv-a', up: true }] })}${NOTE}`;
    const index = evidenceFromHistory([
      { role: 'user', content: 'which hosts?' },
      { role: 'tool', toolCallId: 'c2', content },
    ]);
    for (const form of ['4417', 'true', 'srv-a']) {
      expect(index.values.has(form)).toBe(true);
      expect(index.carriers.get(form)?.toolCallIds).toEqual(['c2']);
    }
    // The raw tokenizer's junk forms are gone with the whole-text read.
    expect(index.values.has(':4417')).toBe(false);
  });

  it('a string a tool cut: its whole words are grounded, the word the cut split is not', () => {
    const index = evidenceFromHistory([
      { role: 'user', content: 'why is the disk full?' },
      { role: 'tool', toolCallId: 'c3', content: '{"id":4417,"msg":"disk full on host-7 and mo' },
    ]);
    for (const form of ['4417', 'host-7', 'disk']) {
      expect(index.values.has(form)).toBe(true);
      expect(index.carriers.get(form)?.toolCallIds).toEqual(['c3']);
    }
    expect(index.values.has('mo')).toBe(false);
  });
});
