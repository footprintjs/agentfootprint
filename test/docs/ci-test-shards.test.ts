/**
 * CI splits the test run across machines, and a check still means what it meant
 * on one machine: every test it names ran and passed. A full run (a push to main,
 * the release pull request, a dependency pull request) runs the suite on both Node
 * versions and coverage; an ordinary pull request runs the suite on Node 24, the
 * package checks on both, and skips coverage.
 *
 * WHY. On one machine the suite and the coverage run took 9 and 17 minutes, and
 * a pull request waited for the slower one. So `test-shard` and `coverage-shard`
 * use four machines each, and the required checks `test (22)`, `test (24)` and
 * `coverage` became jobs that add them up. That shape has one dangerous way to be
 * wrong: a job is skipped when a job it needs failed, and GitHub reports a skipped
 * job as Success, even on a required check.
 *
 * WHAT THIS PINS.
 *   1. Nothing is dropped: the shard lists are exactly 1..N and the commands say /N.
 *   2. A required check fails closed: it always runs, it reads the result of every
 *      job it needs, and its step, run AS WRITTEN, accepts nothing but `success`.
 *   3. The coverage gate judges the merge of every shard: nothing merges after a
 *      failed shard, and a missing blob, which vitest would merge around and exit
 *      0, stops it.
 *
 * File-shape and run-the-script assertions on purpose, as in
 * release-verdict.test.ts: a workflow runs only on GitHub, so this is the half that
 * can fail on a laptop. publish.yml's reading of these names is pinned there.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jobBlock,
  jobIds,
  needsOf,
  readWorkflow,
  runScript,
  stepKey,
  stepsOf,
} from '../helpers/workflowText';

const CI = readWorkflow('ci.yml');
const PUBLISH = readWorkflow('publish.yml');

/**
 * An ordinary pull request runs the suite on Node 24 only and skips coverage; a
 * push to main, the release pull request and a dependency pull request run
 * everything (ci.yml says why, above `test-shard`). The condition is written out
 * at each place that uses it, so what can go wrong is two places disagreeing: a
 * release run that tests the suite on one Node version, or a coverage check that
 * waits for shards that never start.
 */
const FULL_RUN =
  "github.event_name != 'pull_request' || github.head_ref == 'release/next' || startsWith(github.head_ref, 'renovate/')";
/** The suite's Node versions, as ci.yml · test-shard writes them. */
const SUITE_NODES = `        node-version: \${{ fromJSON((${FULL_RUN}) && '[22, 24]' || '[24]') }}`;

/** The job's `shard: [...]` list, as numbers. */
function shardsOf(job: string): number[] {
  const list = /^ {8}shard: \[(.+)\]$/m.exec(job)?.[1];
  if (list === undefined) throw new Error(`the job has no shard list:\n${job}`);
  return list.split(',').map(Number);
}

/** A check step's `ENV: ${{ needs.<job>.result }}` lines, as ENV → job id. */
function resultsReadBy(step: string): Map<string, string> {
  const lines = step.matchAll(/^ {10}([A-Z_]+): \$\{\{ needs\.([\w-]+)\.result \}\}$/gm);
  return new Map([...lines].map(([, env, job]) => [env, job]));
}

/** A step's script run as the runner runs one that names no shell; its exit code. */
function exitOf(step: string, env: Record<string, string> = {}, cwd?: string): number | null {
  return spawnSync('bash', ['-e', '-c', runScript(step)], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env },
  }).status;
}

/** CI always runs these; a laptop without bash skips them rather than fail. */
const HAS_BASH = Boolean(process.env.CI) || spawnSync('bash', ['--version']).status === 0;

describe('ci.yml · every test still runs, under the same required names', () => {
  it('every required check keeps its job id and its default name', () => {
    for (const id of [
      'test',
      'coverage',
      'lint',
      'docs',
      'generated',
      'docs-links',
      'docs-truth',
      'changes',
      'tested-tree',
      'file-size',
    ]) {
      expect(jobIds(CI), id).toContain(id);
      // A job-level `name:` would change the check name the ruleset reads.
      expect(jobBlock(CI, id), id).not.toMatch(/^ {4}name:/m);
    }
  });

  it.each(['test-shard', 'coverage-shard'])('%s runs every share of the test files', (id) => {
    const job = jobBlock(CI, id);
    const shards = shardsOf(job);
    expect(shards.length).toBeGreaterThan(1);
    expect(shards).toEqual(shards.map((_, at) => at + 1));
    expect(job).toContain(`--shard=\${{ matrix.shard }}/${shards.length}`);
    // One failure must not cancel the shards that would show the next one.
    expect(job).toMatch(/^ {6}fail-fast: false$/m);
  });

  it('a full run tests the suite on both Node versions; the package checks and the check that adds them up always do', () => {
    expect(jobBlock(CI, 'test-shard')).toContain(`${SUITE_NODES}\n`);
    // `test-package` is never narrowed: publish.yml · build, the release's fallback,
    // does not run all of its commands, so a pull request must run them on Node 22.
    for (const id of ['test-package', 'test']) {
      expect(jobBlock(CI, id), id).toMatch(/^ {8}node-version: \[22, 24\]$/m);
    }
    expect(needsOf(jobBlock(CI, 'test'))).toEqual(['test-shard', 'test-package', 'test-examples']);
  });
});

describe('ci.yml · what a pull request skips, a full run does not', () => {
  it('a full run is every push, the release pull request and a dependency pull request', () => {
    // The release pull request must be a full run: publish.yml · verdict reads its
    // run as the release gate (release-verdict.test.ts pins the branch name there).
    expect(FULL_RUN).toContain("github.event_name != 'pull_request'");
    expect(FULL_RUN).toContain("github.head_ref == 'release/next'");
    expect(jobBlock(PUBLISH, 'verdict')).toContain('.head.ref == "release/next"');
  });

  it('the three places that narrow a pull request use the one condition', () => {
    const narrowed = CI.split('\n').filter(
      (line) => !line.trimStart().startsWith('#') && line.includes('renovate/'),
    );
    expect(narrowed.sort()).toEqual(
      [SUITE_NODES, `    if: ${FULL_RUN}`, `    if: always() && (${FULL_RUN})`].sort(),
    );
  });

  it('no other job is conditional: a new `if:` on a required check would skip it unseen', () => {
    // A skipped job satisfies a required check, so a condition on `lint` or
    // `generated` would let every pull request through unchecked. The jobs that
    // may carry one are named here; adding to this list is a reviewed decision.
    const conditional = jobIds(CI).filter((id) => /^ {4}if:/m.test(jobBlock(CI, id)));
    expect(conditional.sort()).toEqual(
      ['changes', 'coverage', 'coverage-shard', 'docs', 'hold', 'test'].sort(),
    );
    // And no job narrows its matrix by event except the suite.
    const byEvent = jobIds(CI).filter((id) =>
      /^ {6}matrix:[\s\S]*fromJSON/m.test(jobBlock(CI, id)),
    );
    expect(byEvent).toEqual(['test-shard']);
  });

  it('coverage runs the suite on Node 22: with `test (24)` that is the suite on both versions', () => {
    // An ordinary run's `test (22)` does not put the suite on Node 22 behind it
    // (only a full run does), so what a release's GATES rely on for "the suite
    // passed on Node 22" is this job. Moving it to 24 would leave nothing.
    expect(jobBlock(CI, 'coverage-shard')).toMatch(/^ {10}node-version: 22$/m);
  });

  it('the coverage shards and the check that merges them run together or not at all', () => {
    expect(jobBlock(CI, 'coverage-shard')).toContain(`\n    if: ${FULL_RUN}\n`);
    expect(jobBlock(CI, 'coverage')).toContain(`\n    if: always() && (${FULL_RUN})\n`);
  });

  it('a release still needs both test checks and coverage to have passed', () => {
    const gates = /^ {10}GATES: '(.*)'$/m.exec(jobBlock(PUBLISH, 'verdict'))?.[1] ?? '[]';
    expect(JSON.parse(gates)).toEqual(
      expect.arrayContaining(['test (22)', 'test (24)', 'coverage']),
    );
  });
});

describe.each(['test', 'coverage'])('ci.yml · the required check `%s` fails closed', (id) => {
  const job = jobBlock(CI, id);
  const check = stepsOf(job)[0];
  const results = resultsReadBy(check);
  const everyJobPassed = Object.fromEntries([...results.keys()].map((env) => [env, 'success']));

  it('runs whatever happened behind it, so a failure behind it can never report a skip', () => {
    // `coverage` runs only in a full run (see FULL_RUN below); within one it always runs.
    expect(job).toContain(
      id === 'coverage' ? `\n    if: always() && (${FULL_RUN})\n` : '\n    if: always()\n',
    );
  });

  it('reads the result of every job it needs', () => {
    expect(needsOf(job).length).toBeGreaterThan(0);
    expect([...results.values()].sort()).toEqual(needsOf(job).sort());
  });

  it('checks first, and no later step can run after the check failed', () => {
    expect(stepKey(check, 'run')).toBeDefined();
    for (const step of stepsOf(job)) expect(stepKey(step, 'if'), step).toBeUndefined();
  });

  it.runIf(HAS_BASH)('passes when every job behind it succeeded', () => {
    expect(exitOf(check, everyJobPassed)).toBe(0);
  });

  it.runIf(HAS_BASH).each(['failure', 'cancelled', 'skipped', ''])(
    'fails when a job behind it reports "%s"',
    (result) => {
      for (const env of results.keys()) {
        expect(exitOf(check, { ...everyJobPassed, [env]: result }), env).not.toBe(0);
      }
    },
  );
});

describe('ci.yml · the coverage gate judges the merge of every shard', () => {
  const shard = jobBlock(CI, 'coverage-shard');
  const steps = stepsOf(jobBlock(CI, 'coverage'));
  const stepAt = (matches: (step: string) => boolean): number => {
    const at = steps.findIndex(matches);
    if (at < 0) throw new Error('the coverage job has no such step');
    return at;
  };
  const uses = (action: string) => (step: string) => stepKey(step, 'uses')?.startsWith(action);
  const named = stepAt((step) => stepKey(step, 'name') === "Every shard's blob arrived");

  it('each shard records its blob and refuses to pass without one', () => {
    expect(shard).toContain('--reporter=blob');
    expect(shard).toContain('--outputFile.blob=vitest-blobs/shard-${{ matrix.shard }}.json');
    expect(shard).toContain('name: coverage-blob-${{ matrix.shard }}');
    expect(shard).toContain('path: vitest-blobs/');
    expect(shard).toContain('if-no-files-found: error');
    // A re-run must merge its own blob, not whichever attempt's has the higher id.
    expect(shard).toContain('overwrite: true');
  });

  it('downloads the blobs, names every one, then merges them', () => {
    const order = [
      stepAt(uses('actions/download-artifact@')),
      named,
      stepAt(
        (step) => stepKey(step, 'run') === 'npm run test:coverage -- --merge-reports=vitest-blobs',
      ),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(runScript(steps[named])).toBe(
      `ls -l vitest-blobs/shard-{${shardsOf(shard).join(',')}}.json`,
    );
  });

  it.runIf(HAS_BASH)('stops at a missing blob, which vitest alone would merge around', () => {
    const dir = mkdtempSync(join(tmpdir(), 'af-ci-shards-'));
    try {
      mkdirSync(join(dir, 'vitest-blobs'));
      const shards = shardsOf(shard);
      for (const n of shards.slice(1)) writeFileSync(join(dir, `vitest-blobs/shard-${n}.json`), '');
      expect(exitOf(steps[named], {}, dir)).not.toBe(0);
      writeFileSync(join(dir, `vitest-blobs/shard-${shards[0]}.json`), '');
      expect(exitOf(steps[named], {}, dir)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
