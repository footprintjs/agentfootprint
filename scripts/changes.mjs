#!/usr/bin/env node
/**
 * Change fragments — one small file per change in `.changes/`, folded into
 * CHANGELOG.md by the release (scripts/release-prepare.mjs), never by hand.
 *
 * Why fragments instead of editing CHANGELOG.md: two sessions working at once
 * both edit the top of one 1.4 MB file and conflict, and each has to GUESS the
 * next version number. A fragment names only WHAT changed and its KIND; the
 * release computes the version from the kinds and writes the heading.
 *
 * Fragment format (`.changes/<any-slug>.md`):
 *
 *   ---
 *   type: fixed          # breaking | added | changed | deprecated | removed | fixed | security | internal
 *   bump: minor          # optional — raise (never lower) the bump this type implies
 *   ---
 *   **One-line headline.** Body in markdown, as it should read in the CHANGELOG.
 *
 * CLI:
 *   node scripts/changes.mjs check                 validate every fragment
 *   node scripts/changes.mjs check --base <ref>    ALSO require a fragment when src/ changed vs <ref>
 *   node scripts/changes.mjs preview               print the CHANGELOG entry the next release would write
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGES_DIR = join(ROOT, '.changes');

/** type → [CHANGELOG section, implied bump]. `internal` never reaches the CHANGELOG. */
export const TYPES = {
  breaking: ['Breaking', 'major'],
  added: ['Added', 'minor'],
  changed: ['Changed', 'patch'],
  deprecated: ['Deprecated', 'patch'],
  removed: ['Removed', 'patch'],
  fixed: ['Fixed', 'patch'],
  security: ['Security', 'patch'],
  internal: [null, 'patch'],
};
const SECTION_ORDER = ['breaking', 'added', 'changed', 'deprecated', 'removed', 'fixed', 'security'];
export const BUMPS = ['patch', 'minor', 'major'];

/** Parse one fragment. Returns `{ file, type, bump, body }` or throws a teaching error. */
export function parseFragment(file, text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: must start with a --- frontmatter block naming its type`);
  const meta = {};
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const kv = /^([a-z]+)\s*:\s*(.+)$/.exec(line);
    if (!kv) throw new Error(`${file}: frontmatter line "${raw.trim()}" is not "key: value"`);
    meta[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  for (const key of Object.keys(meta)) {
    if (key !== 'type' && key !== 'bump')
      throw new Error(`${file}: unknown frontmatter key "${key}" (allowed: type, bump)`);
  }
  const type = meta.type;
  if (!type || !(type in TYPES))
    throw new Error(`${file}: type must be one of ${Object.keys(TYPES).join(' | ')} (got "${type ?? ''}")`);
  const implied = TYPES[type][1];
  let bump = implied;
  if (meta.bump !== undefined) {
    if (!BUMPS.includes(meta.bump))
      throw new Error(`${file}: bump must be patch | minor | major (got "${meta.bump}")`);
    if (BUMPS.indexOf(meta.bump) < BUMPS.indexOf(implied))
      throw new Error(`${file}: bump "${meta.bump}" is lower than type "${type}" implies (${implied})`);
    bump = meta.bump;
  }
  const body = m[2].trim();
  if (!body) throw new Error(`${file}: the body is empty — say what changed, for the reader of the CHANGELOG`);
  if (type === 'breaking' && !/migrat/i.test(body))
    throw new Error(
      `${file}: a breaking change must tell the reader how to migrate — add a "Migration:" paragraph`,
    );
  return { file, type, bump, body };
}

/** Every fragment in `.changes/`, sorted by filename (README.md is the format doc, not a fragment). */
export function readFragments(dir = CHANGES_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => parseFragment(`.changes/${f}`, readFileSync(join(dir, f), 'utf8')));
}

export const CAPABILITIES_DIR = join(ROOT, '.capabilities');

/**
 * One file's capability rows: each non-blank line is one `CAPABILITIES.md` table row whose
 * Since cell is the placeholder `unreleased`. Throws with the file name on anything else,
 * so a malformed row fails the pull request and never reaches a release.
 */
export function parseCapabilityRows(file, text) {
  const rows = text.split('\n').filter((line) => line.trim() !== '');
  if (rows.length === 0) throw new Error(`${file}: empty — write one CAPABILITIES.md table row`);
  for (const row of rows) {
    // Cells are split on unescaped pipes only: a row may write `a \| b` inside a cell.
    const cells = row.trimEnd().split(/(?<!\\)\|/);
    if (!row.startsWith('| ') || /^\|\s*-{3}/.test(row) || cells.length !== 6 || cells[5] !== '')
      throw new Error(`${file}: every line must be one four-cell table row: | what you would build | \`symbol\` | \`path\` | unreleased |`);
    if (cells[4].trim() !== 'unreleased')
      throw new Error(`${file}: the last cell must be the word unreleased — the release writes the version`);
    if (cells[1].trim().startsWith('If you are about to build'))
      throw new Error(`${file}: this is the table's header, not a capability row`);
  }
  return { file, rows: rows.map((row) => row.trimEnd()) };
}

/**
 * Every capability row waiting for a release, sorted by filename (README.md is the format doc).
 * Why files and not lines in CAPABILITIES.md: every pull request added its row at the same
 * line of that table, so any two open pull requests conflicted. One file per row cannot.
 */
export function readCapabilityRows(dir = CAPABILITIES_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => parseCapabilityRows(`.capabilities/${f}`, readFileSync(join(dir, f), 'utf8')));
}

/**
 * `CAPABILITIES.md` with the waiting rows placed first in its table and every `unreleased`
 * placeholder replaced by `version`. Throws when rows wait and the table cannot be found.
 */
export function foldCapabilities(text, waiting, version) {
  // Only a row's Since cell is stamped: the word may also appear in the row's own prose.
  const stamp = (row) => row.replace(/\|\s*unreleased\s*\|\s*$/, `| ${version} |`);
  const lines = text.split('\n').map((line) => (line.startsWith('|') ? stamp(line) : line));
  if (waiting.length > 0) {
    const separator = lines.findIndex((line) => /^\|\s*-{3}/.test(line));
    if (separator < 0) throw new Error('CAPABILITIES.md has no table to fold .capabilities/ rows into');
    lines.splice(separator + 1, 0, ...waiting.flatMap((entry) => entry.rows.map((row) => stamp(row.trimEnd()))));
  }
  return lines.join('\n');
}

/**
 * Table rows of `CAPABILITIES.md` whose Since cell still says `unreleased`: rows written into
 * the table by hand. The release would still stamp them, but they are exactly what made pull
 * requests conflict, so `changes check` refuses them and names the folder to use.
 */
export function handWrittenUnreleasedRows(text) {
  return text.split('\n').filter((line) => line.startsWith('| ') && /\|\s*unreleased\s*\|\s*$/.test(line));
}

/** The highest bump any fragment needs, or undefined for none. */
export function requiredBump(fragments) {
  let at = -1;
  for (const f of fragments) at = Math.max(at, BUMPS.indexOf(f.bump));
  return at < 0 ? undefined : BUMPS[at];
}

export function incVersion(version, bump) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`cannot bump "${version}" — only plain X.Y.Z versions are supported`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/** Compute an RC from untouched main and observed tag names. No writes. */
export function candidateVersion(current, fragments, tags, requested = 'auto') {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(current) ||
    current.split('.').some((n) => !Number.isSafeInteger(Number(n)))
  )
    throw new Error('RC source must name a canonical stable version');
  const needed = requiredBump(fragments);
  if (!needed) throw new Error('no fragments waiting for an RC');
  if (requested !== 'auto' && !BUMPS.includes(requested))
    throw new Error('RC bump must be auto, patch, minor or major');
  if (requested !== 'auto' && BUMPS.indexOf(requested) < BUMPS.indexOf(needed))
    throw new Error('RC bump is lower than the fragment floor');
  const core = incVersion(current, requested === 'auto' ? needed : requested);
  if (core.split('.').some((n) => !Number.isSafeInteger(Number(n))))
    throw new Error('RC version exceeds the supported integer range');
  const prefix = 'v' + core + '-rc.';
  let highest = -1;
  for (const tag of tags) {
    if (typeof tag !== 'string') throw new Error('RC tag name must be a string');
    if (!tag.startsWith(prefix)) continue;
    const value = tag.slice(prefix.length);
    if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw new Error('noncanonical matching RC tag');
    highest = Math.max(highest, Number(value));
  }
  if (!Number.isSafeInteger(highest + 1))
    throw new Error('RC number exceeds the supported integer range');
  return core + '-rc.' + (highest + 1);
}

/** A fragment body as a CHANGELOG bullet: kept as-is when it is already a list, else one indented bullet. */
function asBullets(body) {
  if (/^[-*] /.test(body)) return body;
  return body
    .split('\n')
    .map((line, i) => (i === 0 ? `- ${line}` : line.trim() === '' ? '' : `  ${line}`))
    .join('\n');
}

/** The entry body (everything under the `## [X] - date` heading). */
export function renderEntryBody(fragments) {
  const parts = [];
  for (const type of SECTION_ORDER) {
    const inType = fragments.filter((f) => f.type === type);
    if (inType.length === 0) continue;
    parts.push(`### ${TYPES[type][0]}\n\n${inType.map((f) => asBullets(f.body)).join('\n\n')}`);
  }
  if (parts.length === 0) parts.push('_Internal changes only — nothing a user of the library can see._');
  return parts.join('\n\n');
}

function changedFilesSince(base) {
  const out = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [status, ...paths] = l.split('\t');
      return { status: status[0], path: paths[paths.length - 1] };
    });
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'candidate') {
    const at = rest.indexOf('--tags-file');
    if (at < 0 || !rest[at + 1])
      throw new Error('candidate requires --tags-file from a successful tag query');
    const text = readFileSync(rest[at + 1], 'utf8');
    const tags = text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const row = /^([0-9a-f]{40})\trefs\/tags\/([^\s]+)$/.exec(line);
        if (!row) throw new Error('tag query returned an invalid row');
        return row[2];
      });
    const bumpAt = rest.indexOf('--bump');
    const bump = bumpAt < 0 ? 'auto' : rest[bumpAt + 1];
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    console.log(candidateVersion(pkg.version, readFragments(), tags, bump));
    return 0;
  }
  if (cmd === 'preview') {
    const fragments = readFragments();
    const bump = requiredBump(fragments);
    if (!bump) {
      console.log('No fragments in .changes/ — nothing to release.');
      return 0;
    }
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    console.log(`## [${incVersion(pkg.version, bump)}] - (release date)  ← ${bump} bump from ${pkg.version}\n`);
    console.log(renderEntryBody(fragments));
    return 0;
  }
  if (cmd === 'check') {
    const fragments = readFragments(); // throws on the first malformed fragment
    readCapabilityRows(); // throws on the first malformed capability row
    const baseAt = rest.indexOf('--base');
    if (baseAt >= 0) {
      // Only on a pull request (`--base`): the release's own bare check must still pass on a main
      // that already holds such a row, and the release still stamps it.
      const capsPath = join(ROOT, 'CAPABILITIES.md');
      const byHand = existsSync(capsPath) ? handWrittenUnreleasedRows(readFileSync(capsPath, 'utf8')) : [];
      if (byHand.length > 0) {
        console.error(
          `CAPABILITIES.md has ${byHand.length} row(s) marked unreleased. Move each to its own file in ` +
            '.capabilities/ (see .capabilities/README.md): rows added to the table by hand make open pull requests conflict.\n' +
            byHand.map((row) => `  ${row.slice(0, 100)}…`).join('\n'),
        );
        return 1;
      }
      const base = rest[baseAt + 1];
      const changed = changedFilesSince(base);
      const touchesSrc = changed.some((c) => c.path.startsWith('src/'));
      const addsFragment = changed.some(
        (c) => c.status === 'A' && c.path.startsWith('.changes/') && c.path !== '.changes/README.md',
      );
      if (touchesSrc && !addsFragment) {
        console.error(
          'src/ changed but no .changes/ fragment was added.\n' +
            'Add one file, e.g. .changes/my-change.md:\n\n' +
            '  ---\n  type: fixed   # breaking | added | changed | deprecated | removed | fixed | security | internal\n  ---\n' +
            '  **What changed, in one line.** Why a user cares.\n\n' +
            'Use `type: internal` for refactors and tests — it never reaches the CHANGELOG. See .changes/README.md.',
        );
        return 1;
      }
      const diff = execFileSync('git', ['diff', `${base}...HEAD`, '--', 'CHANGELOG.md'], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      if (/^\+## \[/m.test(diff)) {
        console.error(
          'CHANGELOG.md gained a version heading in this change. Versions are written by the release,\n' +
            'not by hand — move the text into a .changes/ fragment (see .changes/README.md).',
        );
        return 1;
      }
    }
    console.log(`${fragments.length} change fragment(s) valid; next release: ${requiredBump(fragments) ?? 'none pending'}.`);
    return 0;
  }
  console.error('usage: node scripts/changes.mjs check [--base <ref>] | preview | candidate --tags-file <file> [--bump <kind>]');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
