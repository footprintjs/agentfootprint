/**
 * loadDocuments — a folder (or a list, or a string) becomes documents.
 *
 * Pattern: routing over the `DocumentLoader` port.
 * Role:    rag/ layer. Step one of the pipeline, and the only step that
 *          touches the filesystem.
 * Emits:   N/A — `indexCorpus` wraps this in a stage and records what it did.
 *
 * ── The source is a union because the modes exclude ─────────────────────────
 * `{ dir }`, `{ files }` and `{ text, uri }` are three different questions,
 * not three optional fields. A call naming a directory AND an explicit file
 * list is a contradiction — which wins? — so the type refuses it at the
 * keystroke, and the function refuses it again at runtime for JavaScript
 * callers and casts.
 *
 * ── A failure is a record, not an exception ─────────────────────────────────
 * One unreadable file out of two hundred must not lose the other 199. Failures
 * come back in `failed[]` naming the uri and the reason, and the indexing
 * report carries them. The exception to that is a failure that means the whole
 * call was wrong — a directory that does not exist, a contradictory source —
 * which throws, because retrying the other zero files is not a recovery.
 */
import { lazyRequire } from '../lib/lazyRequire.js';
import { sha256 } from './hash.js';
import { DEFAULT_LOADERS } from './loaders/index.js';
import type { DocumentLoader, DocumentSource, FailedDocument, LoadedDocument } from './types.js';

export interface LoadDocumentsOptions {
  /**
   * Loaders to route with, consulted BEFORE the built-ins. Passing one that
   * claims `.md` overrides the Markdown loader without editing a registry.
   */
  readonly loaders?: readonly DocumentLoader[];
  /**
   * Skip files larger than this many bytes, recording them in `failed[]`.
   * Default 25 MB — a corpus is other people's directories, and a stray
   * database dump should be reported rather than read into memory.
   */
  readonly maxBytes?: number;
}

export interface LoadDocumentsResult {
  readonly documents: readonly LoadedDocument[];
  readonly failed: readonly FailedDocument[];
  /** How many files the source turned up, before any of them were read. */
  readonly discovered: number;
}

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Read a source into documents.
 *
 * @throws TypeError when the source names more than one mode, or none.
 * @throws when a named directory or file cannot be reached at all.
 *
 * @example
 * ```ts
 * const { documents, failed } = await loadDocuments({ dir: './docs' });
 * const { documents } = await loadDocuments({ files: ['./a.md', './b.pdf'] });
 * const { documents } = await loadDocuments({ text: 'inline', uri: 'note.md' });
 * ```
 */
export async function loadDocuments(
  source: DocumentSource,
  options: LoadDocumentsOptions = {},
): Promise<LoadDocumentsResult> {
  const loaders = [...(options.loaders ?? []), ...DEFAULT_LOADERS];
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  refuseAmbiguousSource(source);

  // The inline arm never touches the filesystem, so it is answered first and
  // a browser-side caller can use it without `node:fs` ever being resolved.
  if ('text' in source && source.text !== undefined) {
    const bytes = new TextEncoder().encode(source.text);
    return {
      discovered: 1,
      failed: [],
      documents: [
        {
          uri: source.uri,
          text: source.text,
          contentHash: sha256(bytes),
          bytes: bytes.length,
          loader: 'inline',
        },
      ],
    };
  }

  const fs = lazyRequire<typeof import('node:fs')>('node:fs');
  const path = lazyRequire<typeof import('node:path')>('node:path');

  const paths =
    'dir' in source && source.dir !== undefined
      ? walk(fs, path, source.dir, source.recursive ?? true, source.include, loaders)
      : [...(source.files ?? [])];

  const documents: LoadedDocument[] = [];
  const failed: FailedDocument[] = [];

  for (const filePath of paths) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > maxBytes) {
        failed.push({
          uri: filePath,
          reason: `file is ${stat.size} bytes, over the ${maxBytes}-byte limit (raise maxBytes to include it)`,
        });
        continue;
      }
      const loader = routeTo(loaders, path.extname(filePath).toLowerCase());
      if (loader === undefined) {
        failed.push({
          uri: filePath,
          reason: `no loader claims '${
            path.extname(filePath) || '(no extension)'
          }' — pass one in \`loaders\``,
        });
        continue;
      }
      const bytes = new Uint8Array(fs.readFileSync(filePath));
      const draft = await loader.load({ uri: filePath, bytes, mtimeMs: stat.mtimeMs });
      documents.push({
        uri: filePath,
        text: draft.text,
        ...(draft.pages && { pages: draft.pages }),
        contentHash: sha256(bytes),
        bytes: bytes.length,
        mtimeMs: stat.mtimeMs,
        loader: loader.name,
      });
    } catch (err) {
      // One bad file does not lose the other 199.
      failed.push({ uri: filePath, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { documents, failed, discovered: paths.length };
}

/**
 * Refuse a source that names more than one mode, or none.
 *
 * The type already refuses it; this catches JavaScript callers and casts, and
 * names what was actually written rather than failing later on a path that is
 * `undefined`.
 */
function refuseAmbiguousSource(source: DocumentSource): void {
  const named = (['dir', 'files', 'text'] as const).filter(
    (key) => (source as Record<string, unknown>)[key] !== undefined,
  );
  if (named.length === 1) {
    if (named[0] === 'text' && !(source as { uri?: string }).uri) {
      throw new TypeError(
        'loadDocuments({ text }) also needs `uri`: chunk ids are built from it, ' +
          'so an inline document with no identifier produces chunks nothing can cite.',
      );
    }
    return;
  }
  throw new TypeError(
    named.length === 0
      ? 'loadDocuments: name exactly one source — `{ dir }`, `{ files }`, or `{ text, uri }`.'
      : `loadDocuments: \`${named.join('` and `')}\` cannot be combined — they are different ` +
        'sources, not a merge, and there is no sensible order between them. Call it once per source.',
  );
}

/** First loader claiming the extension wins; caller-supplied ones come first. */
function routeTo(
  loaders: readonly DocumentLoader[],
  extension: string,
): DocumentLoader | undefined {
  return loaders.find((loader) => loader.extensions.includes(extension));
}

/** Depth-first walk, filtered to extensions some loader claims. */
function walk(
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
  dir: string,
  recursive: boolean,
  include: readonly string[] | undefined,
  loaders: readonly DocumentLoader[],
): string[] {
  const wanted = include
    ? new Set(include.map((e) => e.toLowerCase()))
    : new Set(loaders.flatMap((l) => l.extensions));

  const out: string[] = [];
  const visit = (current: string): void => {
    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        // Dot-directories are tooling, not corpus — `.git` alone would double
        // the size of most walks and index nothing anyone wants retrieved.
        if (!recursive || dirent.name.startsWith('.')) continue;
        visit(full);
        continue;
      }
      if (!dirent.isFile()) continue;
      if (wanted.has(path.extname(dirent.name).toLowerCase())) out.push(full);
    }
  };
  visit(dir);
  // Sorted so a corpus indexes in the same order on every machine — chunk ids
  // are stable per document, but a stable ORDER makes two runs' reports
  // diffable, which is most of what makes an incremental re-index readable.
  return out.sort();
}
