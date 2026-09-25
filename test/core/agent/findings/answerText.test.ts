/**
 * Unit — `findings/answerText.ts`, the one reader of the reserved key in an
 * answer's TEXT (9.114.2).
 *
 * Pattern: Test-as-specification — each rule of the file header by example,
 *          then three properties over seeded random inputs: nothing removed ⇒
 *          byte-identical; any chunking ⇒ the same bytes as the whole text; a
 *          `JSON.stringify` answer ⇒ `JSON.stringify` of it without the key.
 * Role:    The stream (`stages/callLLM.ts`) and the peel
 *          (`reserved.ts · peelAnswerFindings`) share this scanner, so these
 *          properties are what make the tokens a UI shows and the answer the
 *          run returns the same text.
 */

import { describe, expect, it } from 'vitest';

import {
  reservedMemberFilter,
  withoutReservedMembers,
} from '../../../../src/core/agent/findings/answerText.js';

const text = (t: string): string => withoutReservedMembers(t).text;
const removed = (t: string): [number, string, boolean][] =>
  withoutReservedMembers(t).removed.map((m) => [m.object, m.valueText, m.complete]);

/** The same text fed in pieces of 1–4 characters. */
function streamed(t: string, rand: () => number): string {
  const f = reservedMemberFilter();
  let out = '';
  let i = 0;
  while (i < t.length) {
    const n = 1 + Math.floor(rand() * 4);
    out += f.push(t.slice(i, i + n));
    i += n;
  }
  return out + f.end();
}

/** mulberry32 — a seeded generator, so a failure is reproducible. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('answerText — the whole answer is one JSON object', () => {
  it('takes the member and the separator that joined it, wherever it stands', () => {
    expect(text('{"a":1,"_findings":{"previous":[]}}')).toBe('{"a":1}');
    expect(text('{"_findings":{"x":1},"a":1}')).toBe('{"a":1}');
    expect(text('{"a":1,"_findings":2,"b":"x"}')).toBe('{"a":1,"b":"x"}');
  });

  it("keeps the model's own layout — indentation and spacing stay as written", () => {
    expect(text('{\n  "a": 1,\n  "_findings": {\n    "p": []\n  }\n}')).toBe('{\n  "a": 1\n}');
    expect(text('{\n  "_findings": {},\n  "a": 1\n}')).toBe('{\n  "a": 1\n}');
  });

  it('an answer that was nothing but the key stays JSON: `{}`', () => {
    expect(text('{"_findings":{"p":[1,2]}}')).toBe('{}');
    expect(text('  {"_findings":1}  \n')).toBe('{}');
  });

  it('leaves a `_findings` inside a value, an escaped quote, and a brace inside a string', () => {
    expect(text('{"a":{"_findings":1}}')).toBe('{"a":{"_findings":1}}');
    expect(text('{"a":"}{\\"_findings\\":1","_findings":{"q":"}"}}')).toBe(
      '{"a":"}{\\"_findings\\":1"}',
    );
  });

  it('reads a key the way JSON does — an escaped spelling is the same key', () => {
    expect(text('{"\\u005ffindings":1,"a":2}')).toBe('{"a":2}');
  });

  it('hands back each removed value as written, with the object that held it', () => {
    expect(removed('{"a":1,"_findings":{"p":[1]},"_findings":2}')).toEqual([
      [0, '{"p":[1]}', true],
      [0, '2', true],
    ]);
  });

  it('an object with no key is untouched, byte for byte', () => {
    expect(text('{}')).toBe('{}');
    expect(text('{ }')).toBe('{ }');
    expect(text('{"a":1, "b":[1,{"c":null}]}')).toBe('{"a":1, "b":[1,{"c":null}]}');
  });
});

describe('answerText — an object written in the prose', () => {
  it('goes whole when the key was all it held, with no blank lines left at either end', () => {
    expect(text('p1 is down.\n\n{"_findings":{"previous":[]}}')).toBe('p1 is down.');
    expect(text('p1 is down.\n\n{"_findings":{"previous":[]}}\n')).toBe('p1 is down.');
    expect(text('{"_findings":1}\n\nB.')).toBe('B.');
    expect(text('A.\n\n{"_findings":1}\n\nB.')).toBe('A.\n\nB.');
  });

  it('keeps its other members', () => {
    expect(text('see {"a":1,"_findings":2} here')).toBe('see {"a":1} here');
  });

  it('text that stops being JSON is given back as written', () => {
    expect(text('use {a, b} or {x}')).toBe('use {a, b} or {x}');
    expect(text('{"_findings" oops}')).toBe('{"_findings" oops}');
    expect(text('a {"_findings":1} b')).toBe('a {} b');
    // …except a member that was already complete, which stays removed.
    expect(text('{"a":1,"_findings":2, oops')).toBe('{"a":1, oops');
  });

  it('an object that held only complete notes when the text stopped being JSON ends there (a brace short)', () => {
    const NOTES = '{"_findings":{"previous":[{"toolCallId":"c1","standing":"fact"}]}';
    // Its own paragraph: it goes whole, and the paragraph break stays.
    expect(text(`p1 is down.\n\n${NOTES}\n\nAlso, restart the switch.`)).toBe(
      'p1 is down.\n\nAlso, restart the switch.',
    );
    // Its own code block: the block goes, fences and all.
    expect(text(`p1 is down.\n\n\`\`\`json\n${NOTES}\n\`\`\`\n\nAlso, restart the switch.`)).toBe(
      'p1 is down.\n\nAlso, restart the switch.',
    );
    // Sharing its line: it stays `{}`; a trailing comma was its own.
    expect(text('{"_findings":1, oops')).toBe('{} oops');
    expect(text('{"_findings":1 oops')).toBe('{} oops');
    expect(removed(`${NOTES}\n\nAlso`)).toEqual([
      [0, '{"previous":[{"toolCallId":"c1","standing":"fact"}]}', true],
    ]);
  });

  it('a `_findings` value that stops being JSON part way is given back — the answer after it is not lost', () => {
    const asWritten = [
      // Prose that opens a value and never finishes it.
      'The key {"_findings": [ is reserved. The answer: p1 is down.',
      // A raw line break inside a string: no JSON string holds one.
      'Write {"_findings": "never closed.\nThe real answer is here.',
      '{"_findings":"note\n\nThe answer is 42.',
      // A stray quote inside a note, in prose and as the whole answer.
      'p1 is down.\n\n{"_findings":{"previous":[{"toolCallId":"c1","standing":"fact","line":"5" tall"}]}}\n\nAlso, restart the switch.',
      '{"answer":"p1 is down","_findings":{"previous":[{"toolCallId":"c1","line":"rack is 5" tall"}]}}',
      // A value that escapes its own closing quote, inside a code block.
      '```json\n{"_findings":{"x":"a\\"}\n```\n\nMore text here.',
      // Brackets that balance around text that is not JSON.
      '{"_findings":[1 2]} ok',
      '{"_findings":{"a" 1}} ok',
      '{"_findings":[1,]} ok',
      '{"_findings":tru} ok',
      '{"_findings":"\\x"} ok',
      // A key with a raw line break is not a key.
      '{"_find\nings":1}',
    ];
    for (const t of asWritten) {
      expect(text(t)).toBe(t);
      expect(removed(t)).toEqual([]);
    }
  });

  it('a value that is JSON — escapes, nesting, numbers, literals — is still removed whole', () => {
    expect(
      text('{"a":1,"_findings":{"p":[1,-2.5e3,true,null,{"q":"\\u00e9\\n\\"x\\""}],"r":{}}}'),
    ).toBe('{"a":1}');
    expect(removed('{"_findings":{"p":[ 1 , [ ] ]},"a":1}')).toEqual([
      [0, '{"p":[ 1 , [ ] ]}', true],
    ]);
  });
});

describe('answerText — code blocks', () => {
  it('a block that held only the key goes, fences and all', () => {
    expect(text('Answer.\n\n```json\n{"_findings":{"previous":[]}}\n```\n')).toBe('Answer.');
    expect(text('A.\n\n```json\n{"_findings":1}\n```\n\nB.')).toBe('A.\n\nB.');
    // Cut off before its closing fence: still gone, and no blank lines left.
    expect(text('A.\n\n```json\n{"_findings":1}')).toBe('A.');
  });

  it('a block that holds more keeps its fences and the rest; an emptied line of its own goes', () => {
    expect(text('```json\n{"a":1,"_findings":2}\n```')).toBe('```json\n{"a":1}\n```');
    expect(text('```json\n{"_findings":1}\n{"a":2}\n```')).toBe('```json\n{"a":2}\n```');
  });

  it('an object inside code keeps its shape: left empty mid-line it stays `{}`', () => {
    expect(text('```ts\nconst x = {"_findings": 1};\n```\n{"_findings":2}')).toBe(
      '```ts\nconst x = {};\n```',
    );
    expect(text('run `x` now')).toBe('run `x` now');
    expect(text('```\n```\nok')).toBe('```\n```\nok');
  });

  it('an object in a list keeps its place, so the list stays JSON', () => {
    expect(text('[{"_findings":1},{"a":2}]')).toBe('[{},{"a":2}]');
    expect(text('[\n  {"a": 2},\n  {"_findings": 1}\n]')).toBe('[\n  {"a": 2},\n  {}\n]');
    expect(text('[\n  {"_findings": 1},\n  {"a": 2}\n]')).toBe('[\n  {},\n  {"a": 2}\n]');
    expect(text('see [the docs](x) then\n{"_findings":1}')).toBe('see [the docs](x) then');
  });

  it('a string in a list is a string: its `]` or `{` does not move the list edge or open an object', () => {
    const list = '[\n  "see [1]]",\n  {"a": 1},\n  {"_findings": {"basis": "direct"}}\n]';
    expect(text(list)).toBe('[\n  "see [1]]",\n  {"a": 1},\n  {}\n]');
    expect(JSON.parse(text(list))).toEqual(['see [1]]', { a: 1 }, {}]);
    expect(text('[\n  "x]",\n  {"_findings": 1}\n]')).toBe('[\n  "x]",\n  {}\n]');
    expect(text('["a{", {"_findings": 3}]')).toBe('["a{", {}]');
    expect(removed('["a{", {"_findings": 3}]')).toEqual([[0, '3', true]]);
    expect(text('["q\\"]{", {"_findings": 3}]')).toBe('["q\\"]{", {}]');
    // A raw line break in its "string" means it was never a JSON list: prose from there.
    expect(text('it is [5" tall] and\n{"_findings":1}')).toBe('it is [5" tall] and');
  });
});

describe('answerText — the lines around what goes', () => {
  it("a removed line's indentation goes with it", () => {
    expect(text('A\n\n    {"_findings": 1}\n\nB')).toBe('A\n\nB');
    expect(text('```json\n  {"_findings":1}\n{"a":2}\n```')).toBe('```json\n{"a":2}\n```');
  });

  it('the next line keeps its own indentation — whole and in pieces', () => {
    const cases: [string, string][] = [
      // A line inside a fence: the code's block structure stays.
      [
        '```py\ndef f():\n    {"_findings":1}\n    return 1\n```',
        '```py\ndef f():\n    return 1\n```',
      ],
      // An indented code block stays a code block.
      ['Run:\n\n    {"_findings":1}\n    restart --port p1', 'Run:\n\n    restart --port p1'],
      ['A\n\n  {"_findings":1}\n  B', 'A\n\n  B'],
      ['- item one\n  {"_findings":1}\n  continued', '- item one\n  continued'],
      ['Intro:\n\t{"_findings":1}\n\tnext', 'Intro:\n\tnext'],
      ['Intro:\n\n  {"_findings":1}\n  {"a":1}', 'Intro:\n\n  {"a":1}'],
      // Notes a closing brace short go the same way.
      ['A\n\n  {"_findings":{"x":1}\n  B', 'A\n\n  B'],
      // Blank lines after the removed line collapse to one — the paragraphs
      // on either side stay apart — and the next line keeps its own indent.
      ['A\n    {"_findings":1}\n\n\n  B', 'A\n\n  B'],
      // An indented code block of notes takes its own indentation with it.
      ['A\n\n  ```json\n  {"_findings":1}\n  ```\n  B', 'A\n\n  B'],
    ];
    for (const [input, want] of cases) {
      expect(text(input)).toBe(want);
      for (let seed = 1; seed <= 20; seed++) expect(streamed(input, seeded(seed))).toBe(want);
    }
  });

  it('a code block of several notes objects goes whole, fences and all', () => {
    expect(text('Hi\n\n```json\n{"_findings":1}\n{"_findings":2}\n```\n')).toBe('Hi');
    expect(text('Hi\n\n```json\n{"_findings":1}\n\n{"a":2}\n```')).toBe(
      'Hi\n\n```json\n\n{"a":2}\n```',
    );
  });

  it('an answer of nothing but notes is left empty — only one bare JSON object becomes `{}`', () => {
    expect(text('```json\n{"_findings": {"previous": []}}\n```')).toBe('');
    expect(text('{"_findings": 1}\n{"_findings": 2}')).toBe('');
    expect(text('{"_findings": 1}')).toBe('{}');
  });
});

describe('answerText — the review round of 2026-09-25', () => {
  it('a missing comma after the notes is not a missing brace: the rest of the object is given back', () => {
    expect(text('{\n  "_findings": {"x":1}\n  "answer": "x"\n}')).toBe('{\n  "answer": "x"\n}');
    expect(text('{"_findings":{"x":1} "answer":"p1 is down"}')).toBe('{"answer":"p1 is down"}');
  });

  it('a second `_findings` given back after a removed one leaves no stray comma', () => {
    expect(text('p1.\n\n{"_findings":1,"_findings":{"x":"a\nb"}}\nAlso.')).toBe(
      'p1.\n\n{"_findings":{"x":"a\nb"}}\nAlso.',
    );
  });

  it('a removed line keeps the blank line after it, so the paragraphs around it stay apart', () => {
    expect(text('x\n{"_findings":1}\n\ny')).toBe('x\n\ny');
    expect(text('x\n{"_findings":1}\ny')).toBe('x\ny');
    expect(text('A.\n\n{"_findings":1}\n\nB.')).toBe('A.\n\nB.');
    expect(text('{"_findings":1}\n\nB.')).toBe('B.');
  });

  it("a removed code block's indentation is not carried onto the next line", () => {
    expect(text('A.\n\n  ```json\n  {"_findings":1}\n  ```\nB.')).toBe('A.\n\nB.');
  });
});

describe('answerText — a text that ends early (a cut-off stream)', () => {
  it('keeps a half-written value hidden, and says it was cut off', () => {
    expect(text('{"a":1,"_findings":{"previous":[{"too')).toBe('{"a":1');
    expect(removed('{"a":1,"_findings":{"prev')).toEqual([[0, '{"prev', false]]);
    expect(text('{"_findings":{"prev')).toBe('{}');
  });

  it('notes cut off mid-line leave `{}` where they began', () => {
    expect(text('Remember the key {"_findings":')).toBe('Remember the key {}');
  });

  it('a half-written key is not known to be the reserved one, so it is shown', () => {
    expect(text('{"a":1,"_fin')).toBe('{"a":1,"_fin');
  });

  it('end() twice returns nothing the second time', () => {
    const f = reservedMemberFilter();
    expect(f.push('{"_findings":1}')).toBe('');
    expect(f.end()).toBe('{}');
    expect(f.end()).toBe('');
    expect(f.push('more')).toBe('');
  });
});

describe('answerText — properties over seeded random inputs', () => {
  const PIECES = [
    '{',
    '}',
    '[',
    ']',
    '"',
    ':',
    ',',
    ' ',
    '\n',
    '`',
    '```',
    '_findings',
    '"_findings"',
    'a',
    '1',
    '\\',
    'x y',
    'true',
    '{"_findings":',
    '```json\n',
    'p1 is down.',
    '"a]"',
    '"b{"',
    'e5',
  ];

  it('nothing removed ⇒ the text comes back byte for byte; any chunking ⇒ the same bytes as the whole', () => {
    const rand = seeded(7);
    let unchanged = 0;
    for (let i = 0; i < 4000; i++) {
      let t = '';
      const n = 1 + Math.floor(rand() * 14);
      for (let j = 0; j < n; j++) t += PIECES[Math.floor(rand() * PIECES.length)];
      const whole = withoutReservedMembers(t);
      if (whole.removed.length === 0) {
        unchanged += 1;
        expect(whole.text).toBe(t);
      }
      for (let k = 0; k < 3; k++) expect(streamed(t, rand)).toBe(whole.text);
    }
    // The generator must actually reach both branches.
    expect(unchanged).toBeGreaterThan(1000);
    expect(unchanged).toBeLessThan(4000);
  });

  it("a JSON.stringify answer ⇒ JSON.stringify of it without the key — the 9.114.1 peel's bytes", () => {
    const rand = seeded(11);
    const KEYS = ['a', 'b', 'answer', 'port', 'x y', '_findingsX', 'é'];
    const VALUES: unknown[] = [
      1,
      -2.5,
      'x',
      'q"}{',
      true,
      null,
      [1, { _findings: 1 }],
      { deep: { _findings: [] } },
      '',
      1e21,
    ];
    for (let i = 0; i < 3000; i++) {
      const o: Record<string, unknown> = {};
      const n = Math.floor(rand() * 4);
      const at = Math.floor(rand() * (n + 1));
      const declared = { previous: [{ toolCallId: `c${i}`, standing: 'fact' }] };
      for (let j = 0; j <= n; j++) {
        if (j === at) o._findings = declared;
        else
          o[KEYS[Math.floor(rand() * KEYS.length)]!] = VALUES[Math.floor(rand() * VALUES.length)];
      }
      const { _findings: _, ...rest } = o;
      const compact = withoutReservedMembers(JSON.stringify(o));
      expect(compact.text).toBe(JSON.stringify(rest));
      expect(JSON.parse(compact.removed[0]!.valueText)).toEqual(declared);
      const pretty = withoutReservedMembers(JSON.stringify(o, null, 2));
      expect(JSON.parse(pretty.text)).toEqual(rest);
      expect(streamed(JSON.stringify(o, null, 2), rand)).toBe(pretty.text);
    }
  });
});
