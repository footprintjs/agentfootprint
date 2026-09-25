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
    const baseAt = rest.indexOf('--base');
    if (baseAt >= 0) {
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
  console.error('usage: node scripts/changes.mjs check [--base <ref>] | preview');
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
