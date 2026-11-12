/**
 * The release hold — NOTHING PUBLISHES WHILE A `hold-release` LABEL IS OPEN.
 *
 * WHY. A release was once published while another working session held it: the
 * hold lived in one conversation and no workflow could see it. footprintjs/ci
 * now reads the repository's open issues and pull requests for the label, and
 * this repository calls it in three places (docs: footprintjs/ci docs/HOLD.md):
 *
 *   - publish.yml · `hold` job (first job; `build` needs it) — the early signal;
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
  const uses = /^ {4}uses: footprintjs\/ci\/\.github\/workflows\/hold\.yml@([a-f0-9]{40})$/m.exec(
    hold,
  );

  it('is the first job, needs nothing, and carries no condition that could skip it', () => {
    expect(jobIds(PUBLISH)[0]).toBe('hold');
    expect(needsOf(hold)).toEqual([]);
    expect(hold).not.toMatch(/^ {4}if:/m);
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

  it('is a dependency of build, by name in `needs` and by result in `if`', () => {
    const build = jobBlock(PUBLISH, 'build');
    expect(needsOf(build)).toContain('hold');
    // `!cancelled()` lets a job run after a FAILED dependency, so the result is
    // asked for: without it a held release would still build.
    expect(build).toContain("needs.hold.result == 'success'");
  });

  it('keeps release and publish behind build, so a held release reaches neither', () => {
    expect(jobBlock(PUBLISH, 'release')).toContain("needs.build.result == 'success'");
    expect(jobBlock(PUBLISH, 'publish')).toContain("needs.build.result == 'success'");
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
