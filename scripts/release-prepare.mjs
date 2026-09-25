#!/usr/bin/env node
/**
 * Prepare a release IN THE WORKING TREE — no commit, no tag, no push.
 *
 *   1. Read `.changes/` fragments and compute the next version from their kinds
 *      (or take an explicit --bump, which may raise but never lower that).
 *   2. Write the `## [X.Y.Z] - date` entry at the top of CHANGELOG.md.
 *   3. Set the version in package.json and package-lock.json.
 *   4. Replace the placeholder `unreleased` in CAPABILITIES.md table rows with X.Y.Z.
 *   5. Delete the folded fragments.
 *   6. Write the entry body to --notes-out (the GitHub release notes).
 *
 * Callers: .github/workflows/publish.yml (the automated release) and
 * scripts/release.sh (the local fallback). Both commit what this leaves behind.
 *
 * LEGACY PATH: with no fragments, an explicit --bump still works when CHANGELOG.md
 * already carries a hand-written `## [X.Y.Z]` heading for the computed version —
 * the way every release before fragments was cut.
 *
 * Usage:
 *   node scripts/release-prepare.mjs [--bump auto|patch|minor|major] [--date YYYY-MM-DD]
 *                                    [--notes-out <file>] [--dry-run]
 * Prints the new version on the last line of stdout; also writes `version=` to
 * $GITHUB_OUTPUT when that is set.
 */
import { readFileSync, writeFileSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  BUMPS,
  readFragments,
  requiredBump,
  incVersion,
  renderEntryBody,
} from './changes.mjs';

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
}
const DRY = process.argv.includes('--dry-run');

function fail(msg) {
  console.error(`release-prepare: ${msg}`);
  process.exit(1);
}

const requested = arg('bump', 'auto');
if (requested !== 'auto' && !BUMPS.includes(requested))
  fail(`--bump must be auto | patch | minor | major (got "${requested}")`);
const date = arg('date', new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD (got "${date}")`);

let fragments;
try {
  fragments = readFragments();
} catch (err) {
  fail(err.message);
}
const needed = requiredBump(fragments);

const pkgPath = join(ROOT, 'package.json');
const pkgText = readFileSync(pkgPath, 'utf8');
const current = JSON.parse(pkgText).version;
const changelogPath = join(ROOT, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf8');

let bump;
if (requested === 'auto') {
  if (!needed) fail('no fragments in .changes/ — nothing to release (add one, or pass an explicit --bump for a hand-written CHANGELOG entry)');
  bump = needed;
} else {
  if (needed && BUMPS.indexOf(requested) < BUMPS.indexOf(needed))
    fail(`--bump ${requested} is lower than the pending changes need (${needed}) — a ${needed} change cannot ship as a ${requested}`);
  bump = requested;
}
const version = incVersion(current, bump);
const hasHeading = changelog.includes(`## [${version}]`);

let notes;
let nextChangelog = changelog;
if (fragments.length > 0) {
  if (hasHeading)
    fail(`CHANGELOG.md already has a "## [${version}]" heading AND .changes/ has fragments — fold the hand-written text into a fragment and delete the heading`);
  notes = renderEntryBody(fragments);
  const at = changelog.search(/^## \[/m);
  if (at < 0) fail('CHANGELOG.md has no "## [" heading to insert above');
  nextChangelog = `${changelog.slice(0, at)}## [${version}] - ${date}\n\n${notes}\n\n${changelog.slice(at)}`;
} else {
  if (!hasHeading) fail(`no fragments in .changes/ and CHANGELOG.md has no "## [${version}]" entry — nothing describes this release`);
  const start = changelog.indexOf('\n', changelog.indexOf(`## [${version}]`)) + 1;
  const rest = changelog.slice(start);
  const end = rest.search(/^## \[/m);
  notes = (end < 0 ? rest : rest.slice(0, end)).trim();
}

// CAPABILITIES.md: rows added since the last release say `unreleased` in their Since cell.
const capsPath = join(ROOT, 'CAPABILITIES.md');
let capsNext;
if (existsSync(capsPath)) {
  const caps = readFileSync(capsPath, 'utf8');
  capsNext = caps
    .split('\n')
    .map((line) => (line.startsWith('|') ? line.replace(/\bunreleased\b/g, version) : line))
    .join('\n');
  if (capsNext === caps) capsNext = undefined;
}

console.error(`release-prepare: ${current} → ${version} (${bump}; ${fragments.length} fragment(s))`);
if (DRY) {
  console.error(`\n## [${version}] - ${date}\n\n${notes}\n`);
  console.log(version);
  process.exit(0);
}

writeFileSync(changelogPath, nextChangelog);
// package.json: replace the one version field in place — keeps the file's formatting byte-for-byte.
writeFileSync(pkgPath, pkgText.replace(`"version": "${current}"`, `"version": "${version}"`));
const lockPath = join(ROOT, 'package-lock.json');
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}
if (capsNext !== undefined) writeFileSync(capsPath, capsNext);
for (const f of fragments) rmSync(join(ROOT, f.file));
const notesOut = arg('notes-out');
if (notesOut) writeFileSync(notesOut, `${notes}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(version);
