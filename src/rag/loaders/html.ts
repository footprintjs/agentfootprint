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
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, blank);
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, blank);
  out = out.replace(/<!--[\s\S]*?-->/g, blank);
  // Every remaining tag becomes whitespace of equal length — see the header.
  out = out.replace(/<[^>]*>/g, blank);
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
