/**
 * The package evidence `test-package` retains is bound to a commit this run
 * tested, and a pull request that is behind main still passes.
 *
 * WHY. A pull request run tests the merge of its head into main. The evidence
 * steps (`scripts/publish-archive/candidate.cjs`, the strict context contract)
 * refuse a commit whose tree is not the tested tree. They were handed the pull
 * request's HEAD, so the job failed whenever main had moved since the branch was
 * cut: every merge made every other open pull request need a base update and a
 * full rerun, with nothing wrong in it. The step pinned here hands them the head
 * only when its tree IS the tested tree, and the tested merge commit otherwise.
 *
 * Run-the-script assertions, as in ci-test-shards.test.ts: the step is run AS
 * WRITTEN against real git history, so what is pinned is what GitHub runs.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jobBlock, readWorkflow, runScript, stepKey, stepsOf } from '../helpers/workflowText';

const CI = readWorkflow('ci.yml');
const job = jobBlock(CI, 'test-package');
const steps = stepsOf(job);
const tested = steps.find((step) => stepKey(step, 'id') === 'tested');
const BOUND = '${{ steps.tested.outputs.commit }}';

const HAS_TOOLS =
  Boolean(process.env.CI) ||
  (spawnSync('bash', ['--version']).status === 0 && spawnSync('git', ['--version']).status === 0);

/** A repository with main, a branch cut from it, and both moved on. */
function history(): { root: string; git: (...args: string[]) => string } {
  const root = mkdtempSync(join(tmpdir(), 'af-tested-commit-'));
  const git = (...args: string[]): string => {
    const done = spawnSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    if (done.status !== 0) throw new Error(`git ${args.join(' ')}: ${done.stderr}`);
    return done.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return { root, git };
}

/** The commit the step names, run as written with HEAD checked out at `at`. */
function boundAt(root: string, prHead: string): string {
  const out = join(root, 'github-output');
  writeFileSync(out, '');
  const done = spawnSync('bash', ['-e', '-c', runScript(tested as string)], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', PR_HEAD: prHead, GITHUB_OUTPUT: out },
    encoding: 'utf8',
  });
  expect(done.status, done.stderr).toBe(0);
  const line = readFileSync(out, 'utf8').trim();
  rmSync(out);
  expect(line).toMatch(/^commit=[0-9a-f]{40}$/);
  return line.slice('commit='.length);
}

describe('ci.yml · test-package binds its evidence to a commit this run tested', () => {
  it('names the commit first, before any dependency code can run', () => {
    expect(tested, 'test-package has no step with id `tested`').toBeDefined();
    const at = steps.indexOf(tested as string);
    expect(stepKey(steps[at - 1], 'uses')).toMatch(/^actions\/checkout@/);
    expect(at).toBe(1);
    expect(job).toContain('PR_HEAD: ${{ github.event.pull_request.head.sha }}');
    // The head is a parent of the tested merge: the checkout must fetch it.
    expect(steps[0]).toContain('fetch-depth: 2');
  });

  it('every evidence step and artifact name reads that one commit', () => {
    expect(job.match(/SOURCE_HEAD: (.+)$/gm)).toEqual([
      `SOURCE_HEAD: ${BOUND}`,
      `SOURCE_HEAD: ${BOUND}`,
    ]);
    expect(job).toContain(`name: agentfootprint-source-${BOUND}`);
    expect(job).toContain(
      `name: agentfootprint-native-context-\${{ matrix.node-version }}-${BOUND}`,
    );
    // Nothing else in the job may name the pull request head directly.
    expect(job.match(/pull_request\.head\.sha/g)).toHaveLength(1);
  });

  describe.runIf(HAS_TOOLS)('the step, run as written', () => {
    it('a push names the pushed commit', () => {
      const { root, git } = history();
      try {
        expect(boundAt(root, '')).toBe(git('rev-parse', 'HEAD'));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('a pull request that contains main names its head: the tested tree is the head tree', () => {
      const { root, git } = history();
      try {
        git('switch', '-q', '-c', 'feature');
        writeFileSync(join(root, 'b.txt'), 'b\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'feature');
        const head = git('rev-parse', 'HEAD');
        // GitHub's merge ref: a real two-parent merge even when main has not moved.
        git('switch', '-q', '--detach', 'main');
        git('merge', '-q', '--no-ff', '-m', 'merge', head);
        expect(git('rev-parse', 'HEAD')).not.toBe(head);
        expect(boundAt(root, head)).toBe(head);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('a pull request behind main names the tested merge, and never its head', () => {
      const { root, git } = history();
      try {
        git('switch', '-q', '-c', 'feature');
        writeFileSync(join(root, 'b.txt'), 'b\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'feature');
        const head = git('rev-parse', 'HEAD');
        git('switch', '-q', 'main');
        writeFileSync(join(root, 'c.txt'), 'main moved\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'main moves');
        git('switch', '-q', '--detach', 'main');
        git('merge', '-q', '--no-ff', '-m', 'merge', head);
        const merge = git('rev-parse', 'HEAD');
        expect(git('rev-parse', `${head}^{tree}`)).not.toBe(git('rev-parse', 'HEAD^{tree}'));
        expect(boundAt(root, head)).toBe(merge);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('a head it cannot read names the tested commit: the evidence is never bound by guesswork', () => {
      const { root, git } = history();
      try {
        expect(boundAt(root, '0123456789012345678901234567890123456789')).toBe(
          git('rev-parse', 'HEAD'),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
