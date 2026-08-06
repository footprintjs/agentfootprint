/**
 * Run a TypeScript fixture as a REAL second process.
 *
 * Some claims cannot be tested inside one process, and "a conversation
 * survives the process that had it" is the clearest of them: every convincing
 * in-process substitute still shares a heap with the thing it is meant to have
 * lost. So the fixture is bundled with esbuild (already a devDependency — no
 * network, no extra loader) and handed to `node`.
 *
 * The bundle is written INSIDE the repo's `node_modules` so that Node resolves
 * the packages the library imports (`footprintjs`) exactly the way it would in
 * a consumer's install — from the same `node_modules` this repo already has.
 * Only the library's own source is bundled; everything else stays external.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Inside node_modules so package resolution works, and ignored by every tool. */
const BUILD_DIR = join(REPO_ROOT, 'node_modules', '.agentfootprint-child');

export interface ChildResult {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Bundle `entry` (a .ts path) and run it in a fresh `node` process.
 *
 * @throws whatever `node` wrote to stderr, when the child exits non-zero — a
 *   child that failed silently would show up as an unhelpful parse error in
 *   the assertion below it.
 */
export async function runInChildProcess(
  entry: string,
  env: Record<string, string>,
): Promise<ChildResult> {
  const esbuild = (await import('esbuild')) as typeof import('esbuild');
  mkdirSync(BUILD_DIR, { recursive: true });
  const outfile = join(BUILD_DIR, `child-${process.pid}-${Date.now()}.mjs`);

  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // Everything in node_modules stays external and resolves at run time.
    packages: 'external',
    // The library loads a few optional modules through `lazyRequire`, which is
    // a real `require` at run time. An ESM bundle has none, and esbuild's shim
    // throws rather than guess — so give the bundle the same `createRequire`
    // the package's own ESM build gets from `scripts/postbuild-esm.mjs`. The
    // banner lands above esbuild's shim, which then finds a real `require` and
    // uses it. Without this the child cannot open `node:sqlite`, which is the
    // one thing it exists to do.
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
    logLevel: 'silent',
  });

  try {
    const stdout = execFileSync(process.execPath, [outfile], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '' };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    throw new Error(
      `child process failed.\n--- stderr ---\n${String(e.stderr ?? '')}\n` +
        `--- stdout ---\n${String(e.stdout ?? '')}`,
    );
  } finally {
    rmSync(outfile, { force: true });
  }
}
