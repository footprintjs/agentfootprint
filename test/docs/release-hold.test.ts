/**
 * The release hold — NOTHING RELEASES WHILE A `hold-release` LABEL IS OPEN.
 *
 * WHY. A release was once published while another working session held it: the
 * hold lived in one conversation and no workflow could see it. footprintjs/ci
 * now reads the repository's open issues and pull requests for the label, and
 * this repository calls it in three places (docs: footprintjs/ci docs/HOLD.md):
 *
 *   - publish.yml · `hold` job (`build` needs it) — the early signal. It runs only
 *     in the modes where the run would build, tag, release or publish, so a push
 *     to main that releases nothing stays green during a hold;
 *   - publish.yml · a STEP in EVERY job that writes part of a release, directly
 *     before that job's first write (`release`: the tag; `publish`: npm) — what
 *     actually holds. `needs` protect only the first attempt and only against a
 *     hold open when the `hold` job ran: GitHub does not re-run a job that already
 *     succeeded, so after "Re-run failed jobs", or for a hold set while `build`
 *     ran, only a step inside the writing job sees the hold;
 *   - ci.yml · `hold` job in pull-request mode — keeps a version-changing pull
 *     request red while a hold is open.
 *
 * These are file-shape assertions on purpose (like release-gate-interlock.test.ts):
 * the real check can only be proved by a real release, and what a test can pin is
 * that no later edit quietly takes the check out of the path or lets it fail open.
 */

import { describe, it, expect } from 'vitest';
import { jobBlock, jobIds, needsOf, readWorkflow, stepKey, stepsOf } from '../helpers/workflowText';

const PUBLISH = readWorkflow('publish.yml');
const CI = readWorkflow('ci.yml');

/** The one reviewed footprintjs/ci commit every hold reference must name. */
const HOLD_PIN = /^[a-f0-9]{40}$/;

/** The `permissions:` grants of a job, as `scope: access` lines without comments. */
function grantsOf(job: string): string[] {
  const block = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(job)?.[1] ?? '';
  return block
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/#.*/, '').trim())
    .sort();
}

describe('publish.yml · the hold job', () => {
  const hold = jobBlock(PUBLISH, 'hold');
  const build = jobBlock(PUBLISH, 'build');
  const uses = /^ {4}uses: footprintjs\/ci\/\.github\/workflows\/hold\.yml@([a-f0-9]{40})$/m.exec(
    hold,
  );
  const conditionOf = (job: string): string | undefined => /^ {4}if: (.+)$/m.exec(job)?.[1];

  /** The mode test inside `build`'s condition: the part that says "this run releases". */
  const publishingPartOf = (condition: string): string | undefined =>
    /\((needs\.plan\.outputs\.mode == '[a-z]+'(?: \|\| needs\.plan\.outputs\.mode == '[a-z]+')*)\)/.exec(
      condition,
    )?.[1];

  /** Every job a job waits for, directly or through another. */
  const reach = (id: string, seen = new Set<string>()): Set<string> => {
    for (const need of needsOf(jobBlock(PUBLISH, id))) {
      if (!seen.has(need)) {
        seen.add(need);
        reach(need, seen);
      }
    }
    return seen;
  };

  it('waits for plan, and is skipped in every mode that releases nothing', () => {
    expect(needsOf(hold)).toEqual(['plan']);
    const condition = conditionOf(hold);
    expect(condition, 'hold has no `if:`').toBeDefined();
    // Not `always()`/`!cancelled()`: a plan that failed must skip it, as it skips `build`.
    expect(condition).toMatch(/^needs\.plan\.outputs\.mode == '[a-z]+'( \|\| .+)?$/);
  });

  it('runs in exactly the modes `build` runs in: the two conditions never differ', () => {
    const inBuild = publishingPartOf(conditionOf(build) ?? '');
    expect(inBuild, "build's `if:` no longer has the mode test").toBeDefined();
    // `hold`'s own wording must be the SAME expression, not a second reading of it
    // (and the same as the size gate's, which also guards exactly the releasing modes).
    expect(conditionOf(hold)).toBe(inBuild);
    expect(conditionOf(jobBlock(PUBLISH, 'file-size'))).toBe(inBuild);
  });

  it('is not skippable into a release: build also needs plan to have succeeded, hold to have succeeded', () => {
    const condition = conditionOf(build) ?? '';
    expect(condition).toContain("needs.hold.result == 'success'");
    expect(condition).toContain("needs.plan.result == 'success'");
    expect(needsOf(build)).toContain('hold');
  });

  it('is behind every job that tags, creates a release or publishes', () => {
    // Anything holding a write or OIDC token on the release path: the tag and release
    // job, the publish job. A new such job must wait for `hold` too.
    const powerful = jobIds(PUBLISH).filter((id) =>
      /^ {6}(contents: write|id-token: write)\b/m.test(jobBlock(PUBLISH, id)),
    );
    expect(powerful).toEqual(expect.arrayContaining(['release', 'publish']));
    for (const id of powerful) {
      expect(reach(id), `${id} can be reached without the hold`).toContain('hold');
    }
    // And each step of the chain needs the one before it to have SUCCEEDED
    // (`!cancelled()` alone would run a job after a failed or skipped dependency).
    expect(jobBlock(PUBLISH, 'release')).toContain("needs.build.result == 'success'");
    expect(jobBlock(PUBLISH, 'publish')).toContain("needs.build.result == 'success'");
  });

  it('leaves opening the release pull request free of the hold', () => {
    for (const id of ['propose', 'release-pr']) {
      expect(reach(id), `${id} must not wait for hold`).not.toContain('hold');
    }
  });

  it('calls the reusable workflow in publish mode, pinned to one full commit in both places', () => {
    expect(uses, 'hold.yml must be pinned to a full commit SHA').not.toBeNull();
    const pin = uses?.[1] as string;
    expect(pin).toMatch(HOLD_PIN);
    expect(hold).toMatch(new RegExp(`^ {6}tool_sha: ${pin}$`, 'm'));
    expect(hold).toMatch(/^ {6}mode: publish$/m);
    expect(hold, 'no secret and no token is handed to the check').not.toMatch(
      /secrets:|token:|inherit/,
    );
  });

  it('has exactly the three read grants on the job itself', () => {
    expect(grantsOf(hold)).toEqual(['contents: read', 'issues: read', 'pull-requests: read']);
  });

  it('keeps release and publish behind build, so a held release reaches neither', () => {
    expect(needsOf(jobBlock(PUBLISH, 'release'))).toContain('build');
    expect(needsOf(jobBlock(PUBLISH, 'publish'))).toContain('build');
  });
});

/** A step's text without its comment lines (comments say "npm publish" without running it). */
const code = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

/**
 * What counts as a WRITE of a release, found the way this repository's own release
 * tests find things (scripts/release-route*.test.mjs read each job's text with the
 * comments stripped and look for its commands): a step whose code runs one of the
 * commands that create a tag, push it, create a GitHub release or publish to npm.
 */
const WRITE = /\bgit tag\b|\bgit push\b|\bgh release create\b|\bnpm publish\b/;
/** What a job may never do to a release unless it is a writing job with the hold step. */
const RELEASE_WRITE = /refs\/tags|\bgit tag\b|\bgh release\b|\bnpm publish\b|--tag\b/;
/** A status function in an `if:` can run a step after the hold step failed. */
const STATUS_FUNCTION = /\b(always|failure|success|cancelled)\(\)/;

/** The jobs that hold a token able to write: `contents: write` or `id-token: write`. */
const writingJobs = jobIds(PUBLISH).filter((id) =>
  /^ {6}(contents: write|id-token: write)\b/m.test(jobBlock(PUBLISH, id)),
);

/** What each writing job's own `permissions:` must be: its write power plus the hold's two reads. */
const GRANTS: Record<string, string[]> = {
  release: ['contents: write', 'issues: read', 'pull-requests: read'],
  publish: ['contents: read', 'id-token: write', 'issues: read', 'pull-requests: read'],
};

/** The job-level `if:` of each writing job, pinned by exact text like `build`'s. */
const JOB_IF: Record<string, string> = {
  release:
    "${{ !cancelled() && needs.build.result == 'success' && github.event_name != 'release' }}",
  publish:
    "${{ !cancelled() && needs.build.result == 'success' && (needs.release.result == 'success' || (needs.release.result == 'skipped' && github.event_name == 'release')) }}",
};

describe('publish.yml · every job that writes part of a release runs the hold step before its first write', () => {
  it('finds the writing jobs: the tag and release job and the publish job (and nothing unexpected)', () => {
    // A new job with `contents: write` or `id-token: write` must be added to GRANTS
    // and JOB_IF here, and so gets every check below.
    expect(writingJobs).toEqual(['release', 'publish']);
  });

  it.each(writingJobs)('%s: the hold step is the step directly before its first write', (id) => {
    const steps = stepsOf(jobBlock(PUBLISH, id));
    const firstWrite = steps.findIndex((step) => WRITE.test(code(step)));
    expect(firstWrite, `${id} has no step that writes`).toBeGreaterThan(0);
    const holdSteps = steps.filter((step) => /hold@/.test(stepKey(step, 'uses') ?? ''));
    expect(holdSteps, `${id} must run the hold step exactly once`).toHaveLength(1);
    expect(steps[firstWrite - 1], `${id}: the step before its first write`).toBe(holdSteps[0]);
  });

  it('release: the first write is the tag, and the GitHub release comes after it', () => {
    const steps = stepsOf(jobBlock(PUBLISH, 'release'));
    const names = steps.map((step) => stepKey(step, 'name'));
    const hold = names.indexOf('Refuse while a hold-release label is open');
    expect(names.slice(hold + 1, hold + 3)).toEqual(['Tag', 'GitHub release']);
    expect(code(steps[hold + 1])).toMatch(/git tag /);
  });

  it('publish: the step before "Publish to npm" is the hold step, and only that step runs npm publish', () => {
    const steps = stepsOf(jobBlock(PUBLISH, 'publish'));
    const publishAt = steps.findIndex((step) => stepKey(step, 'name') === 'Publish to npm');
    expect(publishAt).toBeGreaterThan(0);
    expect(stepKey(steps[publishAt - 1], 'uses') ?? '').toMatch(/hold@/);
    expect(steps.filter((step) => /\bnpm publish\b/.test(code(step)))).toHaveLength(1);
  });

  it.each(writingJobs)('%s: the step uses the pinned hold commit and the job token only', (id) => {
    const steps = stepsOf(jobBlock(PUBLISH, id));
    const step = steps.find((candidate) => /hold@/.test(stepKey(candidate, 'uses') ?? '')) ?? '';
    const uses = stepKey(step, 'uses') ?? '';
    const pin = /^footprintjs\/ci\/\.github\/actions\/hold@([a-f0-9]{40})$/.exec(uses)?.[1];
    expect(pin, `${id}: the hold step must be pinned to a full commit: ${uses}`).toMatch(HOLD_PIN);
    expect(jobBlock(PUBLISH, 'hold')).toContain(`@${pin}`);
    // A `with:` or `env:` here could hand the check a different token or options.
    expect(step).not.toMatch(/^ {8}(with|env):/m);
  });

  it.each(writingJobs)('%s: nothing can skip the step or let a write run after it failed', (id) => {
    const job = jobBlock(PUBLISH, id);
    const steps = stepsOf(job);
    const step = steps.find((candidate) => /hold@/.test(stepKey(candidate, 'uses') ?? '')) ?? '';
    expect(stepKey(step, 'if')).toBeUndefined();
    expect(stepKey(step, 'continue-on-error')).toBeUndefined();
    for (const each of steps) {
      expect(stepKey(each, 'continue-on-error'), each).toBeUndefined();
      // ANY status function: `always()`, `failure()`, `cancelled()` and also `success()`
      // (`success() || true` overrides the default "only after the steps before it passed").
      expect(stepKey(each, 'if') ?? '', each).not.toMatch(STATUS_FUNCTION);
    }
    expect(job).not.toMatch(/^ {4}continue-on-error:/m);
    // The job's own condition is pinned by exact text: a `always() ||` in front of it
    // would run the job (and its tag or publish) after a red `hold`.
    expect(/^ {4}if: (.+)$/m.exec(job)?.[1]).toBe(JOB_IF[id]);
  });

  it.each(writingJobs)(
    '%s: its own permissions are exactly its write power plus the hold reads',
    (id) => {
      expect(grantsOf(jobBlock(PUBLISH, id))).toEqual(GRANTS[id]);
    },
  );

  it('docs starts a workflow run, which is not a tag, a release or a publish', () => {
    const docs = jobBlock(PUBLISH, 'docs');
    expect(code(docs)).not.toMatch(WRITE);
    expect(/^ {4}if: (.+)$/m.exec(docs)?.[1]).toBe(
      "${{ !cancelled() && needs.plan.outputs.mode == 'publish' && needs.release.result == 'success' && needs.publish.result == 'success' }}",
    );
  });
});

describe('publish.yml · the jobs exempt from the hold step write no tag, release or package', () => {
  // `propose` and `release-pr` open or update the RELEASE PULL REQUEST. A hold stops
  // releases, not that: proposing is how a release is prepared and reviewed. Neither
  // has `contents: write` or `id-token: write` in `permissions:`, so the filter above
  // does not see them; `release-pr` gets its write power from the release App's token,
  // which is why it is found here by `permission-contents: write` and named.
  it('the only job with the release App token is release-pr, and it writes one branch and one pull request', () => {
    const withAppToken = jobIds(PUBLISH).filter((id) =>
      /permission-contents:\s*write/.test(jobBlock(PUBLISH, id)),
    );
    expect(withAppToken).toEqual(['release-pr']);
    const text = code(jobBlock(PUBLISH, 'release-pr'));
    expect(text, 'release-pr must never tag, release or publish').not.toMatch(RELEASE_WRITE);
    const pushes = text.split('\n').filter((line) => /\bgit push\b/.test(line));
    expect(pushes.map((line) => line.trim())).toEqual([
      'git push origin release/next:refs/heads/release/next',
    ]);
    expect(text).toMatch(/gh pr create/);
    expect(text).toMatch(/gh pr edit/);
  });

  it('propose writes nothing outside its own checkout (a bundle and an artifact)', () => {
    expect(code(jobBlock(PUBLISH, 'propose'))).not.toMatch(WRITE);
    expect(code(jobBlock(PUBLISH, 'propose'))).not.toMatch(RELEASE_WRITE);
  });

  it('no other job runs a command that tags, pushes, creates a release or publishes', () => {
    // `plan` READS tags (`git ls-remote`), which is why this uses the write commands
    // and not a bare "tags" pattern.
    for (const id of jobIds(PUBLISH)) {
      if (writingJobs.includes(id) || id === 'release-pr') continue;
      expect(code(jobBlock(PUBLISH, id)), `${id} must not write part of a release`).not.toMatch(
        WRITE,
      );
    }
  });
});

describe('the two hold calls are plain jobs that can fail', () => {
  it.each([
    ['publish.yml', PUBLISH],
    ['ci.yml', CI],
  ])('%s: the hold job has no continue-on-error', (_name, yml) => {
    expect(jobBlock(yml, 'hold')).not.toMatch(/continue-on-error/);
  });
});

describe('ci.yml · the hold job (pull-request mode)', () => {
  const hold = jobBlock(CI, 'hold');

  it('runs only for pull requests, with its own read grants, pinned like the publish workflow', () => {
    expect(hold).toMatch(/^ {4}if: github\.event_name == 'pull_request'$/m);
    expect(grantsOf(hold)).toEqual(['contents: read', 'issues: read', 'pull-requests: read']);
    const pin = /^ {4}uses: footprintjs\/ci\/\.github\/workflows\/hold\.yml@([a-f0-9]{40})$/m.exec(
      hold,
    )?.[1];
    expect(pin).toMatch(HOLD_PIN);
    expect(hold).toMatch(new RegExp(`^ {6}tool_sha: ${pin}$`, 'm'));
    expect(hold).toMatch(/^ {6}mode: pull-request$/m);
    // One commit for every hold reference in the repository.
    expect(jobBlock(PUBLISH, 'hold')).toContain(`@${pin}`);
  });

  it('depends on nothing and nothing depends on it', () => {
    expect(needsOf(hold)).toEqual([]);
    for (const id of jobIds(CI)) {
      expect(needsOf(jobBlock(CI, id)), `${id} must not need hold`).not.toContain('hold');
    }
  });
});
