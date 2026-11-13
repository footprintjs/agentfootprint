/**
 * bench/honest-report/harness/build.mjs — one library build, loaded from a checkout's BUILT
 * package by path, with the commit it was built from (RULE.md § 3, § 10).
 *
 * Why by path and not `import('agentfootprint')`: the measurement runs the before commit and
 * the after commit side by side in ONE process, so each build is its own module graph, found by
 * its folder (`<checkout>/dist/esm/…`). The same folder given twice is one graph (the A/A
 * rehearsal).
 *
 * The commit that names a build is the last commit that touched the library (`src/` or
 * `package.json`), not the checkout's HEAD: this bench's own commits sit on top of `05cbef67`
 * and change no library byte. A checkout with uncommitted library changes is refused: its
 * commit would not say what ran.
 *
 * The built files must be those of that commit (RULE.md § 3): a paid run builds each checkout
 * fresh first (`freshBuild`, `npm run build` in it), and every run records a digest of the
 * `dist/esm` it loaded (`distDigest`), so two runs that loaded different files cannot pass for one.
 *
 * Example: `await loadBuild('.')` → `{ label: 'A', commit: '05cbef675f27…', version: '14.4.0',
 * where: '.', doors: { Agent, defineTool, allow, deny, mock, anthropic, recordRun, assessAnswer,
 * accountForAnswer } }`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { recordedDir } from '../../recordedDir.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

/** The commit of the library in `root`, and whether its library files are clean. */
export function libraryCommitOf(root) {
  const commit = git(root, 'log', '-1', '--format=%H', '--', 'src', 'package.json');
  const dirty = git(root, 'status', '--porcelain', '--', 'src', 'package.json') !== '';
  return { commit, dirty };
}

/** A digest of every file under `dir` (path and bytes, in sorted order; sha256, first 16 hex). */
export function distDigest(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
    }
  };
  walk(dir);
  const h = createHash('sha256');
  for (const f of files.sort()) h.update(relative(dir, f)).update('\u0000').update(readFileSync(f));
  return h.digest('hex').slice(0, 16);
}

/** Builds the checkout in `dir` from its own sources (`npm run build`); throws when the build fails. */
export function freshBuild(dir) {
  execFileSync('npm', ['run', 'build'], { cwd: resolve(dir), stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * Loads the build in checkout `dir` under `label` ('A' is the checkout the bench runs from,
 * 'B' a second one given by `--build-b`).
 */
export async function loadBuild(dir, label) {
  const root = resolve(dir);
  const esm = join(root, 'dist', 'esm');
  if (!existsSync(join(esm, 'index.js'))) {
    throw new Error(`build ${label} (${recordedDir(root)}) is not built: run \`npm run build\` in it first`);
  }
  const { commit, dirty } = libraryCommitOf(root);
  if (dirty) throw new Error(`build ${label} (${recordedDir(root)}) has uncommitted library changes: commit them or use a clean checkout`);
  const url = (p) => pathToFileURL(join(esm, p)).href;
  const [core, providers, observe] = await Promise.all([import(url('index.js')), import(url('doors/providers.js')), import(url('doors/observe.js'))]);
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  return {
    label,
    commit,
    version,
    where: recordedDir(root),
    dist: distDigest(esm),
    doors: {
      Agent: core.Agent,
      defineTool: core.defineTool,
      allow: core.allow,
      deny: core.deny,
      mock: providers.mock,
      anthropic: providers.anthropic,
      recordRun: observe.recordRun,
      assessAnswer: observe.assessAnswer,
      accountForAnswer: observe.accountForAnswer,
    },
  };
}

/** The build as a run records it: never the doors, never an absolute path. */
export function buildStamp(build) {
  return { label: build.label, commit: build.commit, version: build.version, where: build.where, ...(build.dist !== undefined && { dist: build.dist }) };
}
