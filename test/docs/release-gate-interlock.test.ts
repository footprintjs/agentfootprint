/**
 * The release interlock — a RED GATE MUST NOT BE ABLE TO REACH npm.
 *
 * The defect this pins (9.58.0): `docs:truth` was red at HEAD and red in CI on
 * both post-release commits, and it shipped anyway. Nothing in the release path
 * ran it. CI's `docs-truth` job triggers on `push`; `publish.yml` triggers on
 * `release: published`; and `release.sh` creates the GitHub release SECONDS
 * after the push — so the two ran concurrently and npm never waited on a CI
 * verdict. The gate existed, was red, and was structurally unable to stop
 * anything.
 *
 * The fix is an interlock, not a reminder: the gate runs inside the SAME job
 * the publishing job `needs:`, so a red gate fails the build job and the
 * publish job never starts — regardless of how the release was created (the
 * script, the web UI, another machine, a workflow re-run).
 *
 * The second half pins the hand-edit. `docs/DOCS_TRUTH_REPORT.md` is GENERATED,
 * and the 9.58.0 release commit edited it by hand (103 → 105 typed events,
 * nothing else), which left the export count stale AND meant nobody had run the
 * check that would have gone red. A generated file that a human can edit
 * without detection is a generated file that will be edited.
 *
 * These are file-shape assertions on purpose: they are the only kind that can
 * fail on THIS machine, before the tag is pushed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const PUBLISH_YML = join(ROOT, '.github', 'workflows', 'publish.yml');
const RELEASE_SH = join(ROOT, 'scripts', 'release.sh');
const REPORT = join(ROOT, 'docs', 'DOCS_TRUTH_REPORT.md');

const read = (p: string): string => readFileSync(p, 'utf8');

describe('release interlock — a red gate cannot reach npm', () => {
  it('publish.yml runs the docs:truth ratchet in the job the publish job needs', () => {
    const yml = read(PUBLISH_YML);

    expect(
      yml.includes('npm run docs:truth'),
      'publish.yml does not run `npm run docs:truth`. CI running it on `push` is NOT ' +
        'enough: this workflow triggers on `release: published`, which release.sh fires ' +
        'seconds after the push, so the two race and npm never waits for a CI verdict. ' +
        'That is exactly how 9.58.0 published with a red ratchet.',
    ).toBe(true);

    // It must be in `build`, not in `publish` — `publish` has the OIDC token and
    // does zero dependency resolution, so a gate there would both run too late
    // and violate the least-privilege split this workflow is built around.
    const buildJob = yml.slice(yml.indexOf('  build:'), yml.indexOf('  publish:'));
    expect(
      buildJob.includes('npm run docs:truth'),
      'docs:truth must run in the `build` job (the one `publish` needs:), not in the ' +
        'publish job — a gate that runs beside `npm publish` cannot prevent it.',
    ).toBe(true);

    const publishJob = yml.slice(yml.indexOf('  publish:'));
    expect(
      /needs:\s*build/.test(publishJob),
      'the publish job must `needs: build`, or the gate in `build` blocks nothing.',
    ).toBe(true);
  });

  it('release.sh runs the same gate locally, before the version bump', () => {
    const sh = read(RELEASE_SH);
    expect(
      sh.includes('npm run docs:truth'),
      'release.sh must run docs:truth before it bumps and tags. The workflow interlock ' +
        'is the real stop; this one exists so the failure lands on the author’s ' +
        'machine instead of after a tag has been pushed.',
    ).toBe(true);

    // Ordering: the gate has to precede the bump, or it fails with a tag already cut.
    expect(
      sh.indexOf('npm run docs:truth'),
      'docs:truth must run BEFORE `npm version` in release.sh.',
    ).toBeLessThan(sh.indexOf('npm version'));
  });
});

describe('the docs-truth report is generated, never hand-edited', () => {
  it('regenerating the report reproduces the committed bytes exactly', { timeout: 60_000 }, () => {
    expect(existsSync(REPORT), 'docs/DOCS_TRUTH_REPORT.md is missing').toBe(true);
    const committed = read(REPORT);

    // `--report-only` restates current truth against the EXISTING baseline. It
    // never writes the baseline, so this test can never quietly accept debt.
    try {
      execFileSync('node', ['scripts/docs-truth-check.mjs', '--report-only'], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch {
      // A red ratchet still writes the report; the exit code is the ratchet's
      // verdict, which its own test owns. Nothing to do here.
    }
    const regenerated = read(REPORT);

    if (regenerated !== committed) {
      // Restore, so a failing run never leaves the tree dirty for the next one.
      const { writeFileSync } = require('node:fs') as typeof import('node:fs');
      writeFileSync(REPORT, committed);
    }

    expect(
      regenerated,
      'docs/DOCS_TRUTH_REPORT.md does not match what the generator produces, which means ' +
        'it was edited by hand or is stale. That is precisely what happened in the 9.58.0 ' +
        'release commit: "103 typed events" was changed to "105" by hand, the export count ' +
        'was left stale at 1906, and because nobody ran the generator nobody saw the ' +
        'ratchet was red. Run `npm run docs:truth:report` and commit the result.',
    ).toBe(committed);
  });

  it('the report-only path exists and cannot write the baseline', () => {
    const script = read(join(ROOT, 'scripts', 'docs-truth-check.mjs'));
    expect(script.includes("argv.includes('--report-only')")).toBe(true);

    // The whole point: separating "restate the truth" from "accept the debt".
    // If the report-only branch could write BASELINE_PATH, an author restating
    // the numbers would silently baseline whatever gap happened to exist.
    const branch = script.slice(
      script.indexOf('if (REPORT_ONLY'),
      script.indexOf('if (UPDATE_BASELINE)'),
    );
    expect(branch.length, 'the --report-only branch was not found').toBeGreaterThan(0);
    expect(
      branch.includes('writeFileSync(BASELINE_PATH'),
      'the --report-only path must never write the baseline — that would turn "restate ' +
        'the numbers" back into "accept the debt", which is the incentive that produced ' +
        'the hand edit in the first place.',
    ).toBe(false);
  });
});
