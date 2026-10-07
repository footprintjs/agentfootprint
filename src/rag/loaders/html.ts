/**
 * htmlLoader — HTML with the tags taken out, without a parser.
 *
 * Pattern: Adapter behind `DocumentLoader`.
 * Role:    rag/ layer. Zero dependency.
 * Emits:   N/A.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 * This is a **tag stripper**, not an HTML parser, and the distinction is worth
 * being blunt about because the failure mode is silent. It removes `<script>`
 * and `<style>` bodies, replaces tags with whitespace, and decodes the handful
 * of entities that appear in real prose. That is enough for documentation
 * pages, exported articles, and saved knowledge-base entries — the things
 * people actually put in a corpus.
 *
 * It is NOT enough for a modern application page. A single-page app's HTML is
 * mostly scaffolding, and what you get back will be navigation labels and
 * button text. If your corpus is that, run a real extractor (Readability,
 * Mercury, your CMS's own export) and feed the result in as text — the
 * `{ text, uri }` arm of `DocumentSource` exists for exactly that.
 *
 * A parser was considered and rejected for v1: every option is a dependency
 * measured in megabytes, and the difference it buys on the documents people
 * index is small. If that stops being true, the fix is another
 * `DocumentLoader` passed ahead of this one — no change here.
 *
 * ── Offsets ─────────────────────────────────────────────────────────────────
 * Tags are replaced with whitespace of the SAME LENGTH rather than deleted, so
 * offsets into the extracted text line up with offsets into the original file.
 * A chunk's `charStart` therefore points at the same place in both, and the
 * text that gets stored is the extracted text, which is what the offsets index.
 */
import type { DocumentInput, DocumentLoader, LoadedDocumentDraft } from '../types.js';
import { decodeText } from './text.js';

/** Blank a matched region, preserving newlines so line structure survives. */
function blank(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

// ── The passes ──────────────────────────────────────────────────────────────
// Each pass is a scan, not a regex, because the file is input a deployer may
// not trust and every lazy `open[\s\S]*?close` (and `<[^>]*>`) is quadratic on
// it: an `open` with no `close` after it is re-tried from every later `open`,
// and each attempt reads to the end (16,000 unclosed `<` take ~1.4 s in V8).
// A scan stops at the first `open` that has no `close`, because no later one
// can have one either. Each pass blanks exactly what its regex in
// `test/security/linear-scanners.test.ts` blanks.

/**
 * Every `open … close` region blanked, leftmost first, each ending at the
 * first `close` after its `open` — `/<!--[\s\S]*?-->/g`, and `/<[^>]*>/g` for
 * `<` … `>` (`[^>]*` stops at the first `>` too).
 */
function blankDelimited(text: string, open: string, close: string): string {
  const parts: string[] = [];
  let copied = 0;
  for (;;) {
    const start = text.indexOf(open, copied);
    if (start === -1) break;
    const closeAt = text.indexOf(close, start + open.length);
    if (closeAt === -1) break;
    const end = closeAt + close.length;
    parts.push(text.slice(copied, start), blank(text.slice(start, end)));
    copied = end;
  }
  return copied === 0 ? text : parts.join('') + text.slice(copied);
}

/**
 * Every `<name …>` … `</name …>` element blanked, body included —
 * `/<name\b[^>]*>[\s\S]*?<\/name(?=[\t\n\f\r />])[^>]*>/gi`. The end tag is the
 * one an HTML tokenizer ends the element at: `</script`, then a blank, `/` or
 * `>`, then anything up to the next `>` — so `</script foo>` and `</SCRIPT\n>`
 * close the body too. (`\s*>` did not, which left the body in the text.)
 */
function blankRawText(text: string, name: 'script' | 'style'): string {
  const parts: string[] = [];
  let copied = 0;
  for (;;) {
    const start = openTagAt(text, name, copied);
    if (start === -1) break;
    const openEnd = text.indexOf('>', start + 1 + name.length);
    if (openEnd === -1) break;
    const close = endTagAt(text, name, openEnd + 1);
    if (close === -1) break;
    const closeEnd = text.indexOf('>', close + 2 + name.length);
    if (closeEnd === -1) break;
    parts.push(text.slice(copied, start), blank(text.slice(start, closeEnd + 1)));
    copied = closeEnd + 1;
  }
  return copied === 0 ? text : parts.join('') + text.slice(copied);
}

/** The next `<name` (any case) that `\b` ends, at or after `from`; -1 when none. */
function openTagAt(text: string, name: string, from: number): number {
  for (let at = text.indexOf('<', from); at !== -1; at = text.indexOf('<', at + 1)) {
    const after = at + 1 + name.length;
    if (namedAt(text, at + 1, name) && !isWordChar(text.charCodeAt(after))) return at;
  }
  return -1;
}

/** The next `</name` (any case) followed by a blank, `/` or `>`, at or after `from`; -1 when none. */
function endTagAt(text: string, name: string, from: number): number {
  for (let at = text.indexOf('</', from); at !== -1; at = text.indexOf('</', at + 1)) {
    if (namedAt(text, at + 2, name) && endsTagName(text.charCodeAt(at + 2 + name.length))) {
      return at;
    }
  }
  return -1;
}

/** `text` spells the lower-case ASCII `name` at `at`, in any case. */
function namedAt(text: string, at: number, name: string): boolean {
  if (at + name.length > text.length) return false;
  for (let i = 0; i < name.length; i++) {
    if ((text.charCodeAt(at + i) | 0x20) !== name.charCodeAt(i)) return false;
  }
  return true;
}

/** `\w` — `NaN` (past the end) is not one, so `\b` holds there. */
function isWordChar(code: number): boolean {
  const lower = code | 0x20;
  return (code >= 0x30 && code <= 0x39) || (lower >= 0x61 && lower <= 0x7a) || code === 0x5f;
}

/** What ends a tag name: tab, LF, FF, CR, space, `/`, `>`. `NaN` (past the end) does not. */
function endsTagName(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0x20 ||
    code === 0x2f ||
    code === 0x3e
  );
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * Strip markup to text.
 *
 * Exported because the splitter tests and the security tests both need to
 * assert on it directly, and because a consumer writing their own loader for a
 * markup-ish format may reasonably want the same pass.
 */
export function stripTags(html: string): string {
  let out = html;
  // Script and style CONTENT is not prose. Blanked wholesale, bodies included.
  out = blankRawText(out, 'script');
  out = blankRawText(out, 'style');
  out = blankDelimited(out, '<!--', '-->');
  // Every remaining tag becomes whitespace of equal length — see the header.
  out = blankDelimited(out, '<', '>');
  // Entities are decoded LAST and only for the fixed set above. A general
  // numeric decode would let `&#60;script&#62;` reappear as a tag in text that
  // has already been stripped.
  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char.padEnd(entity.length, ' '));
  }
  return out;
}

export function htmlLoader(): DocumentLoader {
  return {
    name: 'html',
    extensions: ['.html', '.htm', '.xhtml'],
    // eslint-disable-next-line @typescript-eslint/require-await
    async load(input: DocumentInput): Promise<LoadedDocumentDraft> {
      return { text: stripTags(decodeText(input.bytes)) };
    },
  };
}
