/**
 * textLoader — plain text, decoded and left alone.
 *
 * Pattern: Adapter behind `DocumentLoader`.
 * Role:    rag/ layer. The simplest possible loader, and the one that defines
 *          what "leaving positions alone" means for the others: it decodes
 *          UTF-8, normalises line endings, and does nothing else. No trimming,
 *          no collapsing of blank lines, no smart quotes — every one of those
 *          would shift every offset after it, and an offset that does not
 *          index the original is worse than no offset at all.
 * Emits:   N/A.
 *
 * Line-ending normalisation is the one exception, and it is a deliberate one:
 * `\r\n` → `\n` happens BEFORE any offset is computed, so offsets index the
 * normalised text, which is also the text that is stored and shown. The
 * alternative — keeping `\r` — makes every paragraph boundary two characters
 * on Windows and one everywhere else, so the same document chunks differently
 * depending on who checked it out.
 */
import type { DocumentInput, DocumentLoader, LoadedDocumentDraft } from '../types.js';

/** Decode UTF-8 and normalise line endings. Shared by every text-shaped loader. */
export function decodeText(bytes: Uint8Array): string {
  // `fatal: false` — a corpus is other people's files, and one bad byte in a
  // 200-page document should degrade that character, not lose the document.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // Strip a UTF-8 BOM: it is invisible, it is not content, and left in place it
  // becomes the first character of the first chunk of the document.
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, '\n');
}

export function textLoader(): DocumentLoader {
  return {
    name: 'text',
    extensions: ['.txt', '.text', '.log', '.csv', '.tsv', '.json', '.yaml', '.yml'],
    // eslint-disable-next-line @typescript-eslint/require-await
    async load(input: DocumentInput): Promise<LoadedDocumentDraft> {
      return { text: decodeText(input.bytes) };
    },
  };
}
