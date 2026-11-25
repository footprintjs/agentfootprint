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
 * One exception, and only one: the `build` job skips a gate when publish.yml's
 * `verdict` job showed that the release PR's CI already passed it on the EXACT
 * tree being published — the same gate on the same bytes, not run twice. When
 * that cannot be shown, the gate runs here as before. release-verdict.test.ts
 * pins the verdict and that nothing else can skip a gate.
 *
 * The second half pins the hand-edit. `docs/DOCS_TRUTH_REPORT.md` is GENERATED,
 * and the 9.58.0 release commit edited it by hand (103 → 105 typed events,
 * nothing else), which left the export count stale AND meant nobody had run the
 * check that would have gone red. A generated file that a human can edit
 * without detection is a generated file that will be edited. Since 25 Nov 2026
 * the report is not stored at all: it is written on demand and attached to each
 * CI run, so there is nothing to edit and nothing to go stale.
 *
 * These are file-shape assertions on purpose: they are the only kind that can
 * fail on THIS machine, before the tag is pushed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { jobBlock } from '../helpers/workflowText';

const ROOT = join(__dirname, '..', '..');
const PUBLISH_YML = join(ROOT, '.github', 'workflows', 'publish.yml');
const RELEASE_SH = join(ROOT, 'scripts', 'release.sh');

const read = (p: string): string => readFileSync(p, 'utf8');

/** `needs: build` or a list naming it (`needs: [build, release]` — tag before publish). */
const NEEDS_BUILD = /needs:\s*(build\b|\[[^\]]*\bbuild\b[^\]]*\])/;
/** The one version bump both release paths share. */
const BUMP_STEP = 'node scripts/release-prepare.mjs';

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
    const buildJob = jobBlock(yml, 'build');
    expect(
      buildJob.includes('npm run docs:truth'),
      'docs:truth must run in the `build` job (the one `publish` needs:), not in the ' +
        'publish job — a gate that runs beside `npm publish` cannot prevent it.',
    ).toBe(true);

    const publishJob = jobBlock(yml, 'publish');
    expect(
      NEEDS_BUILD.test(publishJob),
      'the publish job must `needs: build`, or the gate in `build` blocks nothing.',
    ).toBe(true);
  });

  it('release.sh runs the same gate locally, before the version bump', () => {
    // The bump is scripts/release-prepare.mjs (fragments → version + CHANGELOG).
    const sh = read(RELEASE_SH);
    expect(
      sh.includes('npm run docs:truth'),
      'release.sh must run docs:truth before it bumps and tags. The workflow interlock ' +
        'is the real stop; this one exists so the failure lands on the author’s ' +
        'machine instead of after a tag has been pushed.',
    ).toBe(true);

    // Ordering: the gate has to precede the bump, or it fails with a tag already cut.
    expect(sh.indexOf(BUMP_STEP), 'release.sh no longer calls the bump step').toBeGreaterThan(-1);
    expect(
      sh.indexOf('npm run docs:truth'),
      'docs:truth must run BEFORE the version bump in release.sh.',
    ).toBeLessThan(sh.indexOf(BUMP_STEP));
  });

  it('publish.yml checks the packed dependency after build and before staging in the required job', () => {
    const yml = read(PUBLISH_YML);
    const buildJob = jobBlock(yml, 'build');
    const gate = buildJob.indexOf('      - run: npm run test:context-package\n');
    expect(
      gate,
      'the build job must check the installed ContextFootprint dependency',
    ).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(buildJob.indexOf('      - run: npm run build\n'));
    expect(gate).toBeLessThan(buildJob.indexOf('      - name: Stage published package'));
    expect(jobBlock(yml, 'publish')).toMatch(NEEDS_BUILD);
  });

  it('release.sh checks the packed dependency after build and before the version bump', () => {
    const sh = read(RELEASE_SH);
    const gate = sh.search(/^npm run test:context-package$/m);
    expect(
      gate,
      'the local release must reject an unusable packed dependency before versioning',
    ).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(sh.search(/^npm run build$/m));
    expect(gate).toBeLessThan(sh.indexOf(BUMP_STEP));
    expect(sh).toMatch(/^set -euo pipefail$/m);
  });
});

describe('the docs-truth report is derived, never stored', () => {
  it('the report is not a tracked file, so it cannot be stale or edited by hand', () => {
    // Until 25 Nov 2026 the report was committed and this test regenerated it and
    // compared bytes. It is not stored any more: every pull request that changed an
    // export changed its counts, so open pull requests conflicted on it. A file
    // that is not in the tree cannot be the 9.58.0 hand edit either.
    const ignored = read(join(ROOT, '.gitignore')).split('\n');
    expect(ignored, '.gitignore must ignore the derived report').toContain(
      '/docs/DOCS_TRUTH_REPORT.md',
    );
    let tracked = '';
    try {
      tracked = execFileSync('git', ['ls-files', '--', 'docs/DOCS_TRUTH_REPORT.md'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      // Not a git checkout (a packed copy): the ignore rule above is the check.
    }
    expect(
      tracked.trim(),
      'docs/DOCS_TRUTH_REPORT.md is tracked again. It is derived: run `git rm --cached` on it. ' +
        '`npm run docs:truth:report` writes it locally and CI attaches it to each run.',
    ).toBe('');
  });

  it('CI writes the report and attaches it to the run', () => {
    const job = jobBlock(read(join(ROOT, '.github', 'workflows', 'ci.yml')), 'docs-truth');
    const at = (text: string): number => job.indexOf(text);
    expect(at('- run: npm run docs:truth\n')).toBeGreaterThan(-1);
    expect(at('run: npm run docs:truth:report\n')).toBeGreaterThan(
      at('- run: npm run docs:truth\n'),
    );
    expect(at('path: docs/DOCS_TRUTH_REPORT.md')).toBeGreaterThan(
      at('run: npm run docs:truth:report\n'),
    );
    // A run that wrote no report must not look like one that did.
    expect(job).toContain('if-no-files-found: error');
    // A red ratchet is when the report is wanted: every report step runs regardless.
    const reportSteps = job.slice(at('npm run docs:truth:report') - 40);
    expect(reportSteps.match(/if: always\(\)/g)?.length).toBe(3);
    // The summary is the report's first section, and an empty one fails the step.
    expect(job).toContain('/^## In plain words/{on=1; print; next} on && /^## /{exit} on');
    expect(job).toContain('test -s "$RUNNER_TEMP/docs-truth-summary.md"');
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
