/**
 * The release hold — NOTHING PUBLISHES WHILE A `hold-release` LABEL IS OPEN.
 *
 * WHY. A release was once published while another working session held it: the
 * hold lived in one conversation and no workflow could see it. footprintjs/ci
 * now reads the repository's open issues and pull requests for the label, and
 * this repository calls it in three places (docs: footprintjs/ci docs/HOLD.md):
 *
 *   - publish.yml · `hold` job (`build` needs it) — the early signal. It runs only
 *     in the modes where the run would build, tag, release or publish, so a push
 *     to main that releases nothing stays green during a hold;
 *   - publish.yml · `publish` job, a STEP directly before the publish step — what
 *     actually holds, because GitHub does not re-run a job that already
 *     succeeded, so "Re-run failed jobs" would skip the job form;
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

describe('publish.yml · the hold step in the publish job', () => {
  const publish = jobBlock(PUBLISH, 'publish');
  const steps = stepsOf(publish);
  const at = steps.findIndex((step) => /hold@/.test(stepKey(step, 'uses') ?? ''));

  it('is the last step before the one that runs npm publish', () => {
    expect(at, 'the publish job has no hold step').toBeGreaterThan(-1);
    const publishAt = steps.findIndex((step) => stepKey(step, 'name') === 'Publish to npm');
    expect(publishAt).toBeGreaterThan(-1);
    expect(at).toBe(publishAt - 1);
    expect(steps.filter((step) => /\bnpm publish\b/.test(step))).toHaveLength(1);
  });

  it('uses the same pinned footprintjs/ci commit as the hold job, and the job token only', () => {
    const uses = stepKey(steps[at], 'uses') ?? '';
    const pin = /^footprintjs\/ci\/\.github\/actions\/hold@([a-f0-9]{40})$/.exec(uses)?.[1];
    expect(pin, `the hold step must be pinned to a full commit: ${uses}`).toMatch(HOLD_PIN);
    expect(jobBlock(PUBLISH, 'hold')).toContain(`@${pin}`);
    // A `with:` here could hand the check a different token.
    expect(steps[at]).not.toMatch(/^ {8}(with|env):/m);
  });

  it('can fail the job and cannot be skipped: nothing in the job softens a failure', () => {
    expect(stepKey(steps[at], 'if')).toBeUndefined();
    expect(stepKey(steps[at], 'continue-on-error')).toBeUndefined();
    for (const step of steps) {
      expect(stepKey(step, 'continue-on-error'), step).toBeUndefined();
      // `always()`/`failure()` would run a later step, the publish step included,
      // after the hold step failed.
      expect(stepKey(step, 'if') ?? '', step).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    }
    expect(publish).not.toMatch(/^ {4}continue-on-error:/m);
  });

  it('adds the two read scopes the step needs and keeps every grant the job already had', () => {
    expect(grantsOf(publish)).toEqual([
      'contents: read',
      'id-token: write',
      'issues: read',
      'pull-requests: read',
    ]);
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
