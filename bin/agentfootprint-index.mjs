#!/usr/bin/env node
/**
 * agentfootprint-index — build a corpus index from the command line.
 *
 * The third bin in this package, after `agentfootprint-setup` and
 * `agentfootprint-lint-tools`. It exists because indexing is a BOOT-TIME job:
 * a cron entry, a deploy step, a thing you run once after adding documents.
 * Making that a script every consumer writes for themselves — argument
 * parsing, embedder selection, a progress line — is the kind of small friction
 * that gets in the way of the first ten minutes.
 *
 *   npx agentfootprint-index ./docs --to ./corpus.db
 *   npx agentfootprint-index ./docs --to ./corpus.db --embedder local --split heading
 *   npx agentfootprint-index ./docs --to ./corpus.db --dry-run
 *
 * It prints the same `IndexReport` the API returns, because the report IS the
 * output: a second run over unchanged documents prints `embedded 0`, which is
 * the whole point of an incremental index and the fastest way to see it work.
 */

import { parseArgs } from 'node:util';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const USAGE = `
agentfootprint-index — build a corpus index

USAGE
  agentfootprint-index <dir> --to <file.db> [options]

REQUIRED
  <dir>                  Directory of documents to index
  --to <file.db>         SQLite index file (created if missing)

OPTIONS
  --embedder <name>      static (default) | local | openai | mock
                         static: bundled weights, no key, no network
                         local:  on-device sentence-transformer, no key
                         openai: hosted, needs OPENAI_API_KEY
                         mock:   letter frequency — plumbing only, NOT semantic
  --split <name>         heading (default) | paragraph | fixed | whole
  --chars <n>            Target chunk size. Default 1000
  --overlap <n>          Overlap between chunks. Default 150
  --include <.ext,...>   Extensions to index. Default: every format we read
  --corpus <name>        Namespace to index into. Default '_global'
  --no-recursive         Do not descend into subdirectories
  --no-remove            Keep chunks whose document disappeared
  --dry-run              Report what WOULD happen; write nothing
  --json                 Print the report as JSON
  -h, --help             This

EXAMPLES
  agentfootprint-index ./docs --to ./corpus.db
  agentfootprint-index ./docs --to ./corpus.db --embedder local --chars 800
  agentfootprint-index ./docs --to ./corpus.db --dry-run --json
`;

function fail(message) {
  process.stderr.write(`agentfootprint-index: ${message}\n`);
  process.stderr.write('Run with --help for usage.\n');
  process.exit(1);
}

const { values, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        to: { type: 'string' },
        embedder: { type: 'string' },
        split: { type: 'string' },
        chars: { type: 'string' },
        overlap: { type: 'string' },
        include: { type: 'string' },
        corpus: { type: 'string' },
        recursive: { type: 'boolean', default: true },
        remove: { type: 'boolean', default: true },
        'dry-run': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
})();

if (values.help || positionals.length === 0) {
  process.stdout.write(USAGE);
  process.exit(values.help ? 0 : 1);
}

const dir = resolve(positionals[0]);
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  fail(`'${positionals[0]}' is not a directory.`);
}
if (!values.to && !values['dry-run']) {
  fail('--to <file.db> is required (or use --dry-run to report without writing).');
}

// Imported through the package's own entry points, so the CLI exercises the
// same doors a consumer does — a break in the export map fails here too.
const { indexCorpus } = await import('../dist/esm/doors/rag.js');
const { byHeading, byParagraph, fixedWithOverlap, wholeDocument } = await import(
  '../dist/esm/doors/rag.js'
);
const { sqliteVectorStore, InMemoryStore, mockEmbedder } = await import(
  '../dist/esm/doors/memory.js'
);
const providers = await import('../dist/esm/doors/providers.js');

const chars = values.chars === undefined ? undefined : Number(values.chars);
const overlap = values.overlap === undefined ? undefined : Number(values.overlap);
if (chars !== undefined && !Number.isFinite(chars)) fail('--chars must be a number.');
if (overlap !== undefined && !Number.isFinite(overlap)) fail('--overlap must be a number.');

const splitters = {
  heading: () => byHeading({ ...(chars && { maxChars: chars }), ...(overlap !== undefined && { overlapChars: overlap }) }),
  paragraph: () => byParagraph({ ...(chars && { maxChars: chars }), ...(overlap !== undefined && { overlapChars: overlap }) }),
  fixed: () => fixedWithOverlap({ ...(chars && { chars }), ...(overlap !== undefined && { overlapChars: overlap }) }),
  whole: () => wholeDocument(),
};
const splitName = values.split ?? 'heading';
if (!(splitName in splitters)) {
  fail(`unknown --split '${splitName}'. One of: ${Object.keys(splitters).join(', ')}.`);
}

const embedders = {
  static: () => providers.staticEmbedder(),
  local: () => providers.localEmbedder(),
  openai: () => providers.openaiEmbedder(),
  mock: () => mockEmbedder(),
};
const embedderName = values.embedder ?? 'static';
if (!(embedderName in embedders)) {
  fail(`unknown --embedder '${embedderName}'. One of: ${Object.keys(embedders).join(', ')}.`);
}

let embedder;
try {
  embedder = embedders[embedderName]();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

// --dry-run writes to a throwaway in-memory index, so it reports real chunk
// counts and real splitting without touching the file. It still EMBEDS —
// the alternative is reporting a count that the real run might not match.
const store = values['dry-run'] ? new InMemoryStore() : sqliteVectorStore({ file: resolve(values.to) });

try {
  const report = await indexCorpus({
    source: {
      dir,
      recursive: values.recursive,
      ...(values.include && { include: values.include.split(',').map((e) => e.trim()) }),
    },
    store,
    embedder,
    splitter: splitters[splitName](),
    removeMissing: values.remove,
    ...(values.corpus && { corpus: { conversationId: values.corpus } }),
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const parts = [
      `discovered ${report.discovered}`,
      `loaded ${report.loaded}`,
      `chunks ${report.chunks}`,
      `embedded ${report.embedded}`,
      `skipped ${report.skipped}`,
      `removed ${report.removed}`,
    ];
    process.stdout.write(
      `${values['dry-run'] ? '[dry run] ' : ''}${parts.join(' · ')}   (${report.elapsedMs}ms, ${report.splitter}, ${report.embedderFingerprint})\n`,
    );
    for (const failure of report.failed) {
      process.stdout.write(`  failed: ${failure.uri} — ${failure.reason}\n`);
    }
    if (report.truncated.length > 0) {
      process.stdout.write(
        `  ${report.truncated.length} chunk(s) longer than the embedder reads — they were clipped. Lower --chars.\n`,
      );
    }
  }
  if (typeof store.close === 'function') store.close();
} catch (err) {
  process.stderr.write(`agentfootprint-index: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
