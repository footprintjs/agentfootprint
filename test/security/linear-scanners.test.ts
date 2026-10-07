/**
 * The scanners that replaced quadratic regexes on text the library does not
 * write: Markdown headings (`byHeading`), HTML (`stripTags`), model-written
 * code (`codeShape`), a PEM bundle (`pemCertificateBlocks`) and a person's
 * message (`firstEmail`, the fact extractor's address rule).
 *
 * WHAT A GREEN RUN PROVES
 *   1. Each scanner returns EXACTLY what its regex returned, on thousands of
 *      seeded strings built from the pieces that matter to it (delimiters,
 *      escapes, line breaks, near-misses). The regex stays here as the oracle.
 *      The one deliberate difference is `stripTags`' script/style END TAG,
 *      which now ends where an HTML tokenizer ends it (`</script foo>`), and
 *      its oracle says so.
 *   2. On each regex's worst case — the input it was quadratic on — the
 *      scanner's work is linear and COUNTED (`test/helpers/workCount.ts`):
 *      at least the length it had to read (so the counter saw the scan), at
 *      most a small multiple of it. Never a clock.
 *
 * Not counted, and linear: `codeShape`'s other passes (line comments, `#`
 * comments, numbers, identifiers, whitespace — each starts at a fixed lead
 * character and cannot re-read a stretch), the fact extractor's lead-in rules
 * (each walks only the few words after its own lead-in), `stripTags`' entity
 * pass (`split`/`join`), and the slices and joins that build results.
 *
 * Test types (Convention 3): security, property (seeded equivalence),
 * performance/regression (counted work).
 */
import { describe, expect, it } from 'vitest';
import { byHeading, splitDocuments, stripTags, type LoadedDocument } from '../../src/doors/rag.js';
import { atxHeadings, type AtxHeading } from '../../src/rag/splitters/byHeading.js';
import { codeShape } from '../../src/core/codeRunnerTool.js';
import {
  caPemProblem,
  intermediateCaSubjects,
  pemCertificateBlocks,
} from '../../src/adapters/identity/directory/ldapDirectory.js';
import { firstEmail, patternFactExtractor } from '../../src/memory/facts/patternFactExtractor.js';
import { placeBeforeTime } from '../../src/core/time/resolve.js';
import { withoutQuery } from '../../src/ontology/skosJsonLd.js';
import { countTextWork } from '../helpers/workCount.js';
import { seededTexts } from '../helpers/seededText.js';

const N = 100_000;

/** Linear: `perChar` counted reads per input character, plus constant setup. */
const budget = (n: number, perChar: number): number => perChar * n + 2_000;

function doc(text: string): LoadedDocument {
  return { uri: 'doc.md', text, contentHash: 'hash', bytes: text.length, loader: 'test' };
}

// ─── Markdown headings ──────────────────────────────────────────────

function headingsByRegex(text: string): AtxHeading[] {
  const pattern = /^(#{1,6})[ \t]+(.+?)[ \t]*$/gm;
  const found: AtxHeading[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.push({
      offset: match.index,
      end: match.index + match[0].length,
      level: (match[1] ?? '').length,
      title: match[2] ?? '',
    });
  }
  return found;
}

describe('atxHeadings — the heading lines, in one pass', () => {
  it('finds exactly the lines `/^(#{1,6})[ \\t]+(.+?)[ \\t]*$/gm` matched, with the same titles', () => {
    const texts = seededTexts(
      0x4ead,
      [
        '#',
        '##',
        '#######',
        ' ',
        '\t',
        '  ',
        'a',
        'B c',
        '\n',
        '\r',
        '\r\n',
        '\u2028',
        '\u2029',
        'x#',
        '# ',
      ],
      5_000,
      14,
    );
    let withHeadings = 0;
    let blankTitles = 0;
    for (const text of texts) {
      const expected = headingsByRegex(text);
      expect(atxHeadings(text), JSON.stringify(text)).toEqual(expected);
      if (expected.length > 0) withHeadings++;
      if (expected.some((h) => h.title.trim() === '')) blankTitles++;
    }
    // The seeds reach the hard cases, so agreement is not agreement on nothing.
    expect(withHeadings).toBeGreaterThan(500);
    expect(blankTitles).toBeGreaterThan(50);
  });

  it('the old worst case — a long blank run inside a heading — is read once', () => {
    const text = `# a${' '.repeat(N)}b`;
    const { result, work } = countTextWork(() => atxHeadings(text));
    expect(result).toEqual([
      { offset: 0, end: text.length, level: 1, title: `a${' '.repeat(N)}b` },
    ]);
    expect(work).toBeGreaterThanOrEqual(N);
    expect(work).toBeLessThanOrEqual(budget(text.length, 3));
  });

  it('trailing blanks and blank-only headings stay linear too', () => {
    for (const text of [`## a${'\t'.repeat(N)}`, '#  \n'.repeat(N / 4), `###${' '.repeat(N)}`]) {
      const { work } = countTextWork(() => atxHeadings(text));
      expect(work).toBeGreaterThanOrEqual(N);
      expect(work).toBeLessThanOrEqual(budget(text.length, 3));
    }
  });

  it('byHeading splits the crafted document in linear counted work', () => {
    const text = `# a${' '.repeat(N)}b\n\nbody`;
    const { work } = countTextWork(() => splitDocuments([doc(text)], byHeading()));
    expect(work).toBeGreaterThanOrEqual(N);
    expect(work).toBeLessThanOrEqual(budget(text.length, 4));
  });
});

// ─── HTML ───────────────────────────────────────────────────────────

/** The old passes, with the end tag corrected to the tokenizer's rule — the oracle. */
function stripTagsByRegex(html: string): string {
  const blank = (match: string): string => match.replace(/[^\n]/g, ' ');
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script(?=[\t\n\f\r />])[^>]*>/gi, blank)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style(?=[\t\n\f\r />])[^>]*>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<[^>]*>/g, blank);
}

describe('stripTags — blanks what its regexes blanked, in linear work', () => {
  it('equals the regex passes on seeded markup (entities aside)', () => {
    const texts = seededTexts(
      0x47a6,
      [
        '<script>',
        '<SCRIPT type=x>',
        '</script>',
        '</script >',
        '</script foo>',
        '</SCRIPT\t\n bar>',
        '</script/>',
        '</scripts>',
        '<scripts>',
        '<script',
        '</script',
        '<style>',
        '</style>',
        '</STYLE >',
        '<!--',
        '-->',
        '--!>',
        '<',
        '>',
        '<p>',
        '</',
        'text',
        ' ',
        '\n',
        '\u00a0',
        'x',
      ],
      6_000,
      10,
    );
    let bodiesBlanked = 0;
    for (const html of texts) {
      const expected = stripTagsByRegex(html);
      expect(stripTags(html), JSON.stringify(html)).toBe(expected);
      if (/<script/i.test(html) && !/<script/i.test(expected) && /[a-z]/.test(html))
        bodiesBlanked++;
    }
    expect(bodiesBlanked).toBeGreaterThan(200);
  });

  it('ends a script body where a browser does — `</script foo>` no longer leaks it into the text', () => {
    // Before this, `</script\s*>` was the only end tag, so the last three left
    // `hidden()` in the extracted text (code-scanning js/bad-tag-filter).
    for (const end of [
      '</script>',
      '</script >',
      '</SCRIPT>',
      '</script foo>',
      '</script\t\n bar>',
      '</script/>',
    ]) {
      const html = `<p>seen</p><script>hidden()${end}<p>after</p>`;
      const text = stripTags(html);
      expect(text, end).not.toContain('hidden');
      expect(text, end).toContain('seen');
      expect(text, end).toContain('after');
      expect(text.length).toBe(html.length);
    }
    // A different element's end tag still does not close a script.
    expect(stripTags('<script>a</scripts>b</script>c').trim()).toBe('c');
  });

  it.each([
    ['unclosed `<`', '<'.repeat(N)],
    ['open tags with no end tag', '<script>'.repeat(N / 8)],
    ['`<script` with no `>`', '<script'.repeat(N / 7)],
    ['comments that never close', '<!--'.repeat(N / 4)],
    ['styles that never close', '<style>'.repeat(N / 7)],
  ])('%s: linear counted work', (_name, html) => {
    const { result, work } = countTextWork(() => stripTags(html));
    expect(result.length).toBe(html.length);
    expect(work).toBeGreaterThanOrEqual(html.length);
    expect(work).toBeLessThanOrEqual(budget(html.length, 8));
  });
});

// ─── Model-written code ─────────────────────────────────────────────

const KEPT_WORDS =
  'if|else|for|while|return|function|const|let|var|def|import|from|class|try|catch|await|async|in|of|new|not|and|or|S|N';

/** `codeShape` as it was — every pass a regex. The oracle. */
function codeShapeByRegex(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/#[^\n]*/g, ' ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, 'S')
    .replace(/\b\d[\d_.eE+-]*\b/g, 'N')
    .replace(new RegExp(`\\b(?!${KEPT_WORDS})[A-Za-z_$][\\w$]*\\b(?!\\s*\\()`, 'g'), 'V')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('codeShape — the same shape, in linear work', () => {
  it('equals the regex chain on seeded code: comments, quotes, escapes, line breaks', () => {
    const texts = seededTexts(
      0xc0de,
      [
        '/*',
        '*/',
        '//',
        '#',
        "'",
        '"',
        '`',
        '\\',
        "\\'",
        '\\"',
        '\n',
        '\r',
        '\u2028',
        'a',
        'f(',
        ')',
        '1',
        ' ',
        ':',
        'x = ',
      ],
      8_000,
      16,
    );
    let literals = 0;
    let unclosed = 0;
    for (const code of texts) {
      expect(codeShape(code), JSON.stringify(code)).toBe(codeShapeByRegex(code));
      const stripped = code.replace(/\/\*[\s\S]*?\*\//g, ' ');
      if (/(['"`])(?:\\.|(?!\1)[^\\])*\1/.test(stripped)) literals++;
      if (/['"`]/.test(stripped.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, 'S'))) unclosed++;
    }
    expect(literals).toBeGreaterThan(1_000);
    expect(unclosed).toBeGreaterThan(1_000);
  });

  it.each([
    ['`/*` repeated, never closed', `/*${'a/*'.repeat(N / 3)}`],
    ['one quote, then a run of escaped quotes', `'${"\\'".repeat(N / 2)}`],
    [
      'every quote kind left open',
      `'${"\\'".repeat(N / 6)}"${'\\"'.repeat(N / 6)}\`${'\\`'.repeat(N / 6)}`,
    ],
    ['quotes that keep closing', `"${"'".repeat(N)}`],
  ])('%s: linear counted work', (_name, code) => {
    const { work } = countTextWork(() => codeShape(code));
    expect(work).toBeGreaterThanOrEqual(code.length);
    expect(work).toBeLessThanOrEqual(budget(code.length, 5));
  });
});

// ─── A PEM bundle ───────────────────────────────────────────────────

const BEGIN = '-----BEGIN CERTIFICATE-----';
const END = '-----END CERTIFICATE-----';

describe('pemCertificateBlocks — the blocks, in one pass', () => {
  it('finds exactly what `/BEGIN[\\s\\S]+?END/g` found', () => {
    const texts = seededTexts(
      0x9e3,
      [BEGIN, END, `${BEGIN}${END}`, 'MIIB', '\n', '-', '-----BEGIN CERTIFICATE----', 'x'],
      4_000,
      10,
    );
    let several = 0;
    for (const pem of texts) {
      const byRegex =
        pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      expect(pemCertificateBlocks(pem), JSON.stringify(pem)).toEqual(byRegex);
      if (byRegex.length >= 2) several++;
    }
    expect(several).toBeGreaterThan(100);
  });

  it('a file of BEGIN lines with no END is refused in linear counted work', () => {
    const pem = BEGIN.repeat(N / BEGIN.length);
    for (const read of [
      () => pemCertificateBlocks(pem),
      () => caPemProblem(pem),
      () => intermediateCaSubjects(pem),
    ]) {
      const { work } = countTextWork(read);
      expect(work).toBeGreaterThanOrEqual(pem.length - BEGIN.length);
      expect(work).toBeLessThanOrEqual(budget(pem.length, 2));
    }
    expect(caPemProblem(pem)).toBe('caPem must be a PEM CA certificate');
  });
});

// ─── A person's message: the address rule ───────────────────────────

describe('firstEmail — the address the old rule found, one attempt per `@`', () => {
  it('equals `text.match(/\\b(…@…\\.[A-Za-z]{2,})\\b/)?.[1]` on seeded text', () => {
    const texts = seededTexts(
      0xe3a1,
      [
        'a',
        'B',
        '1',
        '.',
        '_',
        '%',
        '+',
        '-',
        '@',
        ' ',
        'com',
        'x',
        '#',
        '\n',
        'é',
        '..',
        'io1',
        'a.b',
        'jo@ex.com',
        '@mail.io',
        '.org',
        'x@y',
        '.c',
      ],
      8_000,
      12,
    );
    const oldRule = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/;
    let found = 0;
    for (const text of texts) {
      const expected = text.match(oldRule)?.[1];
      expect(firstEmail(text), JSON.stringify(text)).toBe(expected);
      if (expected !== undefined) found++;
    }
    expect(found).toBeGreaterThan(200);
  });

  it.each([
    ['local-part characters and no `@`', 'a.'.repeat(N / 2)],
    ['one `@`, then a domain with no top-level part', `a@${'b.'.repeat(N / 2)}`],
    ['an `@` after every character', 'a@'.repeat(N / 2)],
  ])('%s: linear counted work, through the extractor', async (_name, content) => {
    const extractor = patternFactExtractor();
    // `extract` awaits nothing, so the whole extraction runs inside the counted call.
    const { result, work } = countTextWork(() =>
      extractor.extract({ messages: [{ role: 'user', content }], turnNumber: 1 }),
    );
    expect(work).toBeGreaterThanOrEqual(N);
    expect(work).toBeLessThanOrEqual(budget(content.length, 5));
    expect((await result).some((fact) => fact.key === 'user.email')).toBe(false);
  });

  it('still finds a real address', () => {
    expect(firstEmail('reach me at jo.smith+ops@mail.example.co.uk, thanks')).toBe(
      'jo.smith+ops@mail.example.co.uk',
    );
    expect(firstEmail('first@a.b then second@example.com')).toBe('second@example.com');
  });
});

// ─── A zone token, and a vocabulary IRI ─────────────────────────────
// Counted work for both is in test/security/linear-text.test.ts (its door table).

describe('placeBeforeTime — the place in `London time`, in one pass', () => {
  it('equals `/^(.+?)\\s+time$/i.exec(token)?.[1]` on seeded tokens', () => {
    const tokens = seededTexts(
      0x71e,
      [
        'a',
        'New',
        'York',
        ' ',
        '\t',
        '\n',
        '\r',
        '\u2028',
        '\u00a0',
        'time',
        'TIME',
        'Time',
        'tim',
        'e',
        'x time',
      ],
      6_000,
      8,
    );
    let places = 0;
    for (const token of tokens) {
      const expected = /^(.+?)\s+time$/i.exec(token)?.[1];
      expect(placeBeforeTime(token), JSON.stringify(token)).toBe(expected);
      if (expected !== undefined) places++;
    }
    expect(places).toBeGreaterThan(300);
    expect(placeBeforeTime('New York time')).toBe('New York');
  });

  it('agrees with the regex on every UTF-16 code unit as the blank, and inside the place', () => {
    // The blank before `time` is `\s`; a character inside the place is anything `.` matches.
    // Together these pin the folder's restated `\s` and line-break tests on every code unit.
    const disagreements: number[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      const char = String.fromCharCode(code);
      for (const token of [`a${char}time`, `a${char}b time`]) {
        if (placeBeforeTime(token) !== /^(.+?)\s+time$/i.exec(token)?.[1]) disagreements.push(code);
      }
    }
    expect(disagreements).toEqual([]);
  });
});

describe('withoutQuery — an IRI up to its query, in one pass', () => {
  it('equals `iri.replace(/[?].*$/, "")` on seeded IRIs', () => {
    const iris = seededTexts(
      0x1a1,
      ['?', 'a', '/', '#', '\n', '\r', '\u2028', 'x?y', '%20', 'http://ex.org/'],
      6_000,
      10,
    );
    let cut = 0;
    for (const iri of iris) {
      const expected = iri.replace(/[?].*$/, '');
      expect(withoutQuery(iri), JSON.stringify(iri)).toBe(expected);
      if (expected !== iri) cut++;
    }
    expect(cut).toBeGreaterThan(1_000);
  });
});
