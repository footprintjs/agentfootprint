#!/usr/bin/env node
/**
 * generate-examples-readme.mjs
 *
 * Walks `examples/` and regenerates the per-folder example tables in
 * `examples/README.md` between marker comments:
 *
 *   <!-- AUTO-GENERATED:examples:start -->
 *   ... regenerated content ...
 *   <!-- AUTO-GENERATED:examples:end -->
 *
 * Surrounding prose (DNA progression, closed taxonomy, etc.) stays
 * hand-written; only the per-folder tables are managed here so the
 * narrative voice doesn't get clobbered by a build step.
 *
 * The script extracts metadata from each example's `export const
 * meta: ExampleMeta = { ... }` block via a permissive regex.
 * Examples without a `meta` export are listed as raw filenames so
 * the script doesn't silently drop them.
 *
 * Run via:
 *   npm run examples:readme        # regenerate
 *   npm run examples:readme:check  # verify no drift (CI guard)
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const EXAMPLES_DIR = join(REPO_ROOT, 'examples');
const README_PATH = join(EXAMPLES_DIR, 'README.md');
const START_MARKER = '<!-- AUTO-GENERATED:examples:start -->';
const END_MARKER = '<!-- AUTO-GENERATED:examples:end -->';

// Folder display order + label. Folders not listed appear after these
// in alphabetical order.
const FOLDER_ORDER = [
  { dir: 'core', label: 'core/ — primitives' },
  { dir: 'core-flow', label: 'core-flow/ — compositions' },
  { dir: 'patterns', label: 'patterns/ — canonical patterns' },
  { dir: 'context-engineering', label: 'context-engineering/ — InjectionEngine flavors' },
  { dir: 'memory', label: 'memory/ — defineMemory + 4 types × 7 strategies' },
  { dir: 'features', label: 'features/ — runtime features' },
  { dir: 'canonical', label: 'canonical/ — end-to-end patterns' },
];

// Folders to skip entirely (helpers, config-only, non-example dirs).
const SKIP_FOLDERS = new Set(['helpers']);

/**
 * One example number = ONE example. A duplicate number makes "run example
 * N" ambiguous, and every doc link that names a number inherits the
 * ambiguity — so the generator REFUSES to emit a table containing one, in
 * --check mode AND in regenerate mode (writing the ambiguous table would be
 * accepted-and-silently-wrong; features/21-artifacts.ts shipped two "| 21 |"
 * rows this way while --check stayed green).
 *
 * The entries below are the collisions that were ALREADY COMMITTED when this
 * refusal landed; renumbering them now would break shipped GitHub links.
 * This list only ever SHRINKS: fixing one of these means renaming the file
 * AND deleting its rows here (a stale row is itself refused). Never add to it.
 */
const GRANDFATHERED_COLLISIONS = new Set([
  'features/06-detached-observability.ts',
  'features/06-flowchart-boundary-payloads.ts',
  'features/06-status-subpath.ts',
  'features/06-tool-args-validation.ts',
  'observability/13-context-error-finders.ts',
  'observability/13-per-loop-trajectory.ts',
]);

/**
 * Refuse duplicate example numbers with a teaching message: name the
 * colliding files and the folder's next free number, so the fix is
 * mechanical. Also refuse a STALE grandfather row, so the debt ledger
 * above cannot outlive the debt it documents.
 */
function assertUniqueNumbers(folders) {
  const problems = [];
  const justifiedGrandfathers = new Set();

  for (const folder of folders) {
    const files = listExampleFiles(join(EXAMPLES_DIR, folder));
    const byNumber = new Map();
    let maxNumber = 0;
    for (const file of files) {
      const m = /^(\d+)/.exec(file);
      if (!m) continue;
      maxNumber = Math.max(maxNumber, Number(m[1]));
      const group = byNumber.get(m[1]) ?? [];
      group.push(file);
      byNumber.set(m[1], group);
    }
    for (const [number, group] of byNumber) {
      if (group.length < 2) continue;
      const rels = group.map((f) => `${folder}/${f}`);
      const grandfathered = rels.filter((rel) => GRANDFATHERED_COLLISIONS.has(rel));
      for (const rel of grandfathered) justifiedGrandfathers.add(rel);
      if (grandfathered.length === rels.length) continue; // committed debt, ledgered above
      problems.push(
        `  examples/${folder}/ — number ${number} names ${group.length} examples:\n` +
          group.map((f) => `    ${f}`).join('\n') +
          `\n  Next free number in ${folder}/: ${maxNumber + 1}`,
      );
    }
  }

  if (problems.length > 0) {
    process.stderr.write(
      `\n[FAIL] Duplicate example numbers — one number must name ONE example.\n\n` +
        problems.join('\n\n') +
        `\n\n  Rename the NEW file to the folder's next free number, update any\n` +
        `  doc links that point at it, then re-run:\n` +
        `    npm run examples:readme\n\n`,
    );
    process.exit(1);
  }

  const stale = [...GRANDFATHERED_COLLISIONS].filter((rel) => !justifiedGrandfathers.has(rel));
  if (stale.length > 0) {
    process.stderr.write(
      `\n[FAIL] Stale GRANDFATHERED_COLLISIONS entries — the collision each\n` +
        `documented is gone:\n` +
        stale.map((rel) => `    ${rel}`).join('\n') +
        `\n  Delete these rows from scripts/generate-examples-readme.mjs.\n` +
        `  The list only shrinks.\n\n`,
    );
    process.exit(1);
  }
}

function listExampleFolders() {
  return readdirSync(EXAMPLES_DIR)
    .filter((name) => {
      const full = join(EXAMPLES_DIR, name);
      try {
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    })
    .filter((name) => !SKIP_FOLDERS.has(name));
}

function listExampleFiles(folderAbs) {
  return readdirSync(folderAbs)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

/**
 * Extract `export const meta: ExampleMeta = { ... }` and parse the
 * minimal subset we need (`id`, `title`, `description`).
 */
function extractMeta(filePath) {
  const text = readFileSync(filePath, 'utf-8');
  const blockRe = /export\s+const\s+meta\s*(?::\s*ExampleMeta)?\s*=\s*({[\s\S]*?});/m;
  const m = blockRe.exec(text);
  if (!m) return null;
  const block = m[1];

  /**
   * Read one string field out of the meta block.
   *
   * The body must be delimited-relative, NOT "any quote ends it". The older
   * form banned all three quote characters from the body and let any of them
   * close the string, so a double-quoted description containing an apostrophe
   * ended at the apostrophe: example 44's
   *
   *   description: "read_skill's menu is rebuilt each iteration ..."
   *
   * silently became the single word `read_skill`, and the README shipped a
   * truncated row that read as a complete sentence. Capturing the opening
   * delimiter and requiring the SAME character to close (backreference `\1`)
   * lets the other two quote characters live inside the body, which is exactly
   * what JavaScript's own string rules say. `\\.` still consumes an escaped
   * delimiter (`'It\'s fine'`) so an escape can never terminate the string.
   *
   * The value must be the WHOLE expression, not the first literal. The older
   * form stopped at the first closing quote, so a `+`-concatenated value —
   * example 55's
   *
   *   description:
   *     'an oversized return becomes a teaching ' +
   *     'refusal ...'
   *
   * silently became its first fragment, and the README shipped a row ending
   * mid-sentence (same truncated-row bug class as example 44, second
   * instance; examples 22 and observability 02/03 were also affected).
   * The fix matches the full `lit (+ lit)*` sequence — each literal keeps
   * its own delimiter via a per-iteration backreference — then joins the
   * literal bodies, exactly what JavaScript's `+` does at runtime. A single
   * literal is the one-element sequence, so unconcatenated fields are
   * byte-identical to before.
   */
  function fieldOf(key) {
    const re = new RegExp(
      `${key}\\s*:\\s*((['"\`])(?:\\\\.|(?!\\2)[^\\\\])*\\2` +
        `(?:\\s*\\+\\s*(['"\`])(?:\\\\.|(?!\\3)[^\\\\])*\\3)*)`,
    );
    const found = re.exec(block);
    if (!found) return null;
    // Join the body of every literal in the (possibly `+`-joined) sequence.
    const litRe = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    let out = '';
    for (const lit of found[1].matchAll(litRe)) out += lit[2];
    return out;
  }

  const id = fieldOf('id');
  const title = fieldOf('title');
  const description = fieldOf('description');
  if (!id || !title) return null;
  return { id, title, description: description ?? '' };
}

function renderFolderTable(folder, files) {
  if (files.length === 0) return '';
  const knownLabel = FOLDER_ORDER.find((f) => f.dir === folder)?.label;
  const trailingLabel = knownLabel
    ? knownLabel.split(' — ').slice(1).join(' — ') || 'examples'
    : 'examples';
  const lines = [];
  lines.push(`### [\`${folder}/\`](${folder}/) — ${trailingLabel}`);
  lines.push('');
  lines.push('| # | File | Title | Description |');
  lines.push('|---|---|---|---|');

  for (const file of files) {
    const fullPath = join(EXAMPLES_DIR, folder, file);
    const meta = extractMeta(fullPath);
    const numMatch = /^(\d+)/.exec(file);
    const num = numMatch ? numMatch[1] : '—';
    const rel = `${folder}/${file}`;
    if (!meta) {
      lines.push(`| ${num} | [\`${file}\`](${rel}) | _no meta_ | — |`);
      continue;
    }
    const title = meta.title.replace(/\|/g, '\\|');
    const desc = meta.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${num} | [\`${file}\`](${rel}) | ${title} | ${desc} |`);
  }

  return lines.join('\n');
}

function generate() {
  const folders = listExampleFolders();
  assertUniqueNumbers(folders);
  const ordered = [
    ...FOLDER_ORDER.map((f) => f.dir).filter((d) => folders.includes(d)),
    ...folders
      .filter((f) => !FOLDER_ORDER.some((o) => o.dir === f))
      .sort(),
  ];

  const sections = [];
  for (const folder of ordered) {
    const folderAbs = join(EXAMPLES_DIR, folder);
    const files = listExampleFiles(folderAbs);
    if (files.length === 0) continue;
    sections.push(renderFolderTable(folder, files));
  }

  const generatedBlock = [
    START_MARKER,
    '',
    '## Examples by folder',
    '',
    '_This section is auto-generated by `scripts/generate-examples-readme.mjs`._',
    '_Run `npm run examples:readme` after adding/editing examples._',
    '',
    sections.join('\n\n'),
    '',
    END_MARKER,
  ].join('\n');

  let readme = readFileSync(README_PATH, 'utf-8');
  if (readme.includes(START_MARKER) && readme.includes(END_MARKER)) {
    const startIdx = readme.indexOf(START_MARKER);
    const endIdx = readme.indexOf(END_MARKER) + END_MARKER.length;
    readme = readme.slice(0, startIdx) + generatedBlock + readme.slice(endIdx);
  } else {
    if (!readme.endsWith('\n')) readme += '\n';
    readme += '\n' + generatedBlock + '\n';
  }
  return readme;
}

const isCheckMode = process.argv.includes('--check');
const newContent = generate();
const existing = readFileSync(README_PATH, 'utf-8');

if (isCheckMode) {
  if (newContent !== existing) {
    process.stderr.write(
      `\n[FAIL] ${relative(REPO_ROOT, README_PATH)} is OUT OF DATE.\n` +
        `  Run: npm run examples:readme\n` +
        `  Then commit the updated file.\n\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`[OK] ${relative(REPO_ROOT, README_PATH)} is up to date.\n`);
  process.exit(0);
}

if (newContent === existing) {
  process.stdout.write(`[OK] ${relative(REPO_ROOT, README_PATH)} already up to date.\n`);
  process.exit(0);
}

writeFileSync(README_PATH, newContent, 'utf-8');
process.stdout.write(`[OK] Regenerated ${relative(REPO_ROOT, README_PATH)}.\n`);
