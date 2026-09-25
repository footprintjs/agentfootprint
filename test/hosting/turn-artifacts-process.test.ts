/**
 * A held hand-over's late call, in a REAL Node process — the plain-Node repro
 * of the 2026-09-25 round-2 crash (`crash-r2.ts held`).
 *
 * In-process tests intercept `unhandledRejection`; a real process under
 * Node's default `--unhandled-rejections=throw` simply dies, taking every
 * session it serves with it. So this runs the shape as its own process and
 * asserts it survives: exit 0, the answer delivered, the awaited late call
 * refused by name.
 *
 * The fixture is bundled with esbuild (already a devDependency) into the OS
 * temp directory; `NODE_PATH` points its bare requires (`footprintjs`, …) at
 * this repo's installed packages, so nothing is written into the tree or into
 * `node_modules`.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../..');
const outDir = mkdtempSync(join(tmpdir(), 'af-turn-artifacts-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('a held hand-over in a real Node process', () => {
  it('survives a floating late put — exit 0, and the awaited one is refused by name', async () => {
    const outfile = join(outDir, 'held.cjs');
    await build({
      entryPoints: [resolve(REPO_ROOT, 'test/hosting/fixtures/heldTurnArtifactsProcess.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      packages: 'external',
      logLevel: 'silent',
    });
    const run = spawnSync(process.execPath, [outfile], {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, NODE_PATH: resolve(REPO_ROOT, 'node_modules') },
    });
    expect(run.stderr).not.toContain('TurnArtifactsExpiredError');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('complete:ok');
    expect(run.stdout).toContain('awaited:ERR_TURN_ARTIFACTS_EXPIRED');
    expect(run.stdout).toContain('SURVIVED');
  }, 30_000);
});
