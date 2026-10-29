/**
 * The release publishes a tree CI passed, without running the gates twice —
 * and runs every gate itself whenever it cannot show that CI passed them.
 *
 * WHY. publish.yml's `build` job re-ran every gate the release PR's CI had
 * just run on the same tree. Release run 40897854122 spent 28m36s in `build`,
 * 23m03s of it in gates CI had already passed. Now the `verdict` job asks the
 * GitHub API whether CI passed those gates on the EXACT tree being published,
 * and `build` skips them only on an explicit yes.
 *
 * WHAT THIS PINS.
 *   1. The `verdict` script, run AS WRITTEN — extracted from publish.yml and
 *      run with bash and jq against a stand-in `gh` that answers from
 *      fixtures. It says yes in one world only: the merge of the release PR, a
 *      green CI run on its head, every gate job passed, and the tree that run
 *      recorded equal to the tree being published. In every world that differs
 *      in one way, it says nothing — and still exits 0, so it can never hold up
 *      a release.
 *   2. The wiring around it: only that answer can skip a gate; the steps that
 *      build and check the package never skip; CI runs every command a skipped
 *      gate would have run; the CI job names it trusts exist; `tested-tree`
 *      records the tree where no other job can write; and the docs site gates
 *      nothing on the way to npm.
 *
 * File-shape and run-the-script assertions on purpose (see
 * release-gate-interlock.test.ts): a workflow runs only on GitHub, so this is
 * the half that can fail on a laptop, before a release depends on it.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandsOf,
  jobBlock,
  jobIds,
  readWorkflow,
  runScript,
  stepKey,
  stepsOf,
} from '../helpers/workflowText';

const PUBLISH = readWorkflow('publish.yml');
const CI = readWorkflow('ci.yml');
const DOCS = readWorkflow('docs.yml');

const VERDICT_STEP = ((): string => {
  const step = stepsOf(jobBlock(PUBLISH, 'verdict')).find((s) => stepKey(s, 'id') === 'verdict');
  if (step === undefined) throw new Error('publish.yml · verdict has no step `id: verdict`');
  return step;
})();
const VERDICT_SCRIPT = runScript(VERDICT_STEP);

/** verdict's GATES env, exactly as written: the CI jobs whose green it trusts. */
const GATES_TEXT = ((): string => {
  const text = /^ {10}GATES: '(.*)'$/m.exec(VERDICT_STEP)?.[1];
  if (text === undefined) throw new Error('publish.yml · verdict sets no GATES');
  return text;
})();
const GATES = JSON.parse(GATES_TEXT) as string[];

/** The one condition that may skip a gate in `build`. */
const SKIP_IF = "needs.verdict.outputs.tested != 'true'";

// ── The stand-in GitHub ────────────────────────────────────────────────────

const REPO = 'footprintjs/agentfootprint';
const SHA = '1'.repeat(40); // the release commit on main
const TREE = '2'.repeat(40); // its tree
const HEAD = '3'.repeat(40); // the release PR's head
const OTHER_TREE = '4'.repeat(40); // a tree main had after it moved

/** Answers keyed by API path, query string dropped. */
type World = Record<string, unknown>;

const COMMIT = `repos/${REPO}/git/commits/${SHA}`;
const PULLS = `repos/${REPO}/commits/${SHA}/pulls`;
const RUNS = `repos/${REPO}/actions/workflows/ci.yml/runs`;
const jobsOfRun = (id: number): string => `repos/${REPO}/actions/runs/${id}/jobs`;

interface Job {
  name: string;
  conclusion: string | null;
  steps: Array<{ name: unknown }>;
}

function job(name: string, conclusion: string | null = 'success', steps: string[] = []): Job {
  return {
    name,
    conclusion,
    steps: [{ name: 'Set up job' }, ...steps.map((s) => ({ name: s })), { name: 'Complete job' }],
  };
}

/** What ci.yml's `tested-tree` job shows through the Jobs API. */
const testedTree = (tree: string, conclusion = 'success'): Job =>
  job('tested-tree', conclusion, [
    'Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    `Run echo "hash=$(git rev-parse 'HEAD^{tree}')" >> "$GITHUB_OUTPUT"`,
    `tested tree ${tree}`,
  ]);

/** A green run of ci.yml on the release PR: every gate passed, docs and changes skipped. */
const greenJobs = (tree = TREE): { jobs: Job[] } => ({
  jobs: [
    ...GATES.map((gate) => job(gate)),
    job('docs', 'skipped'),
    job('changes', 'skipped'),
    testedTree(tree),
  ],
});

const ciRun = (id: number, changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  event: 'pull_request',
  head_sha: HEAD,
  head_branch: 'release/next',
  head_repository: { full_name: REPO },
  status: 'completed',
  conclusion: 'success',
  ...changes,
});

const releasePr = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  number: 254,
  state: 'closed',
  merged_at: '2026-10-29T18:00:00Z',
  merge_commit_sha: SHA,
  base: { ref: 'main' },
  head: { ref: 'release/next', sha: HEAD, repo: { full_name: REPO } },
  ...changes,
});

/** The world `verdict` says yes to: the release PR merged as SHA, and run 501 tested its tree. */
function releaseMerge(): World {
  return {
    [COMMIT]: { sha: SHA, tree: { sha: TREE } },
    [PULLS]: [releasePr()],
    [RUNS]: { total_count: 1, workflow_runs: [ciRun(501)] },
    [jobsOfRun(501)]: greenJobs(),
  };
}

/** `gh api <path>` from the fixtures; a path with no answer fails like a 404. Logs every call. */
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_LOG"
[ "$1" = api ] || exit 1
key="\${2%%\\?*}"
jq -c --arg k "$key" 'if has($k) then .[$k] else error("no answer") end' "$FAKE_GH_ANSWERS" 2>/dev/null ||
  { echo "gh: HTTP 404: no answer for $2" >&2; exit 1; }
`;

interface Outcome {
  readonly status: number | null;
  /** What the step wrote to $GITHUB_OUTPUT — `tested=true\n`, or nothing. */
  readonly output: string;
  readonly summary: string;
  readonly log: string;
  readonly calls: string[];
}

/** Run verdict's script as GitHub would (`shell: bash`), against `world`. */
function runVerdict(world: World, env: Record<string, string> = {}): Outcome {
  const dir = mkdtempSync(join(tmpdir(), 'af-verdict-'));
  try {
    const file = (name: string): string => join(dir, name);
    writeFileSync(file('gh'), FAKE_GH, { mode: 0o755 });
    writeFileSync(file('answers.json'), JSON.stringify(world));
    writeFileSync(file('step.sh'), VERDICT_SCRIPT);
    for (const name of ['output', 'summary', 'calls']) writeFileSync(file(name), '');
    const run = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file('step.sh')], {
      encoding: 'utf8',
      timeout: 30_000,
      // Only what the step's env names, plus PATH with the stand-in gh first —
      // never this machine's real tokens.
      env: {
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        GH_TOKEN: 'not-a-token',
        REPO,
        SHA,
        GATES: GATES_TEXT,
        GITHUB_OUTPUT: file('output'),
        GITHUB_STEP_SUMMARY: file('summary'),
        FAKE_GH_ANSWERS: file('answers.json'),
        FAKE_GH_LOG: file('calls'),
        ...env,
      },
    });
    return {
      status: run.status,
      output: readFileSync(file('output'), 'utf8'),
      summary: readFileSync(file('summary'), 'utf8'),
      log: `${run.stdout}${run.stderr}`,
      calls: readFileSync(file('calls'), 'utf8').split('\n').filter(Boolean),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const available = (tool: string): boolean => spawnSync(tool, ['--version']).status === 0;
/** CI always runs these; a laptop without bash or jq skips them rather than fail. */
const CAN_RUN_THE_STEP = Boolean(process.env.CI) || (available('bash') && available('jq'));

// ── 1. The verdict, as written ─────────────────────────────────────────────

describe.runIf(CAN_RUN_THE_STEP)('publish.yml · verdict, run as written', () => {
  it('says yes for the release PR’s merge when a green CI run tested this exact tree', () => {
    const outcome = runVerdict(releaseMerge());
    expect(outcome.status, outcome.log).toBe(0);
    expect(outcome.output).toBe('tested=true\n');
    expect(outcome.summary).toContain(`https://github.com/${REPO}/actions/runs/501`);
    expect(outcome.summary).toContain(TREE);
    // The jobs of the run's LATEST attempt: a re-run that went green is green.
    expect(outcome.calls.find((call) => call.includes(jobsOfRun(501)))).toContain('filter=latest');
  });

  it('judges the newest run: green on this tree, it counts whatever an older run did', () => {
    const world = releaseMerge();
    world[RUNS] = {
      total_count: 2,
      workflow_runs: [ciRun(501), ciRun(499, { conclusion: 'failure' })],
    };
    const outcome = runVerdict(world);
    expect(outcome.output, outcome.log).toBe('tested=true\n');
    expect(outcome.summary).toContain('/actions/runs/501');
  });

  // Each world differs from the yes-world in ONE way. Each must leave `tested`
  // unset — so `build` runs every gate — and exit 0.
  const declines: Array<[string, (world: World) => void]> = [
    [
      'the newest run failed, though an older green run tested this exact tree',
      (w) => (w[RUNS] = { workflow_runs: [ciRun(501), ciRun(502, { conclusion: 'failure' })] }),
    ],
    [
      'the newest run tested another tree, though an older green run tested this one',
      (w) => {
        w[RUNS] = { workflow_runs: [ciRun(501), ciRun(502)] };
        w[jobsOfRun(502)] = greenJobs(OTHER_TREE);
      },
    ],
    [
      'the jobs of the newest run cannot be read',
      (w) => (w[RUNS] = { workflow_runs: [ciRun(501), ciRun(502)] }), // no answer for 502's jobs
    ],
    [
      'main moved after CI ran, so the run tested another tree',
      (w) => (w[jobsOfRun(501)] = greenJobs(OTHER_TREE)),
    ],
    [
      'a gate job was skipped',
      (w) => {
        const jobs = greenJobs();
        jobs.jobs[GATES.indexOf('coverage')].conclusion = 'skipped';
        w[jobsOfRun(501)] = jobs;
      },
    ],
    [
      'a gate job is missing from the run',
      (w) => {
        const jobs = greenJobs();
        jobs.jobs.splice(GATES.indexOf('docs-truth'), 1);
        w[jobsOfRun(501)] = jobs;
      },
    ],
    [
      'a gate job failed',
      (w) => {
        const jobs = greenJobs();
        jobs.jobs[GATES.indexOf('lint')].conclusion = 'failure';
        w[jobsOfRun(501)] = jobs;
      },
    ],
    [
      'the CI run did not finish green',
      (w) => (w[RUNS] = { workflow_runs: [ciRun(501, { conclusion: 'failure' })] }),
    ],
    [
      'the CI run has not finished',
      (w) =>
        (w[RUNS] = { workflow_runs: [ciRun(501, { status: 'in_progress', conclusion: null })] }),
    ],
    [
      // A re-run in progress may still show the last attempt's conclusion.
      'a re-run of the CI run is in progress',
      (w) => (w[RUNS] = { workflow_runs: [ciRun(501, { status: 'in_progress' })] }),
    ],
    [
      'the CI run was not a pull-request run',
      (w) => (w[RUNS] = { workflow_runs: [ciRun(501, { event: 'push' })] }),
    ],
    [
      'the CI run came from another repository',
      (w) =>
        (w[RUNS] = {
          workflow_runs: [ciRun(501, { head_repository: { full_name: 'someone/agentfootprint' } })],
        }),
    ],
    [
      'the CI run tested another head',
      (w) => (w[RUNS] = { workflow_runs: [ciRun(501, { head_sha: '5'.repeat(40) })] }),
    ],
    ['there is no CI run at all', (w) => (w[RUNS] = { total_count: 0, workflow_runs: [] })],
    [
      'the commit merged an ordinary pull request, not the release PR',
      (w) =>
        (w[PULLS] = [
          releasePr({ head: { ref: 'fix/bug', sha: HEAD, repo: { full_name: REPO } } }),
        ]),
    ],
    [
      'the release PR came from a fork',
      (w) =>
        (w[PULLS] = [
          releasePr({
            head: { ref: 'release/next', sha: HEAD, repo: { full_name: 'someone/agentfootprint' } },
          }),
        ]),
    ],
    [
      'the release PR merged into another branch',
      (w) => (w[PULLS] = [releasePr({ base: { ref: 'next' } })]),
    ],
    ['the commit was pushed to main with no pull request', (w) => (w[PULLS] = [])],
    [
      'the pull request was not merged as this commit',
      (w) => (w[PULLS] = [releasePr({ merge_commit_sha: '6'.repeat(40) })]),
    ],
    [
      'the pull request is not merged',
      (w) => (w[PULLS] = [releasePr({ merged_at: null, state: 'open' })]),
    ],
    [
      'the tested-tree job did not run',
      (w) => {
        const jobs = greenJobs();
        jobs.jobs.pop();
        w[jobsOfRun(501)] = jobs;
      },
    ],
    [
      'the tested-tree job failed',
      (w) => {
        const jobs = greenJobs();
        jobs.jobs[jobs.jobs.length - 1] = testedTree(TREE, 'failure');
        w[jobsOfRun(501)] = jobs;
      },
    ],
    [
      'the recorded tree is not a full lowercase hash',
      (w) => {
        const jobs = greenJobs();
        jobs.jobs[jobs.jobs.length - 1] = testedTree(TREE.slice(0, 12));
        w[jobsOfRun(501)] = jobs;
      },
    ],
    [
      'the tested-tree job names two trees',
      (w) => {
        const jobs = greenJobs();
        jobs.jobs[jobs.jobs.length - 1].steps.push({ name: `tested tree ${OTHER_TREE}` });
        w[jobsOfRun(501)] = jobs;
      },
    ],
    ['the CI runs cannot be listed', (w) => delete w[RUNS]],
    ['the commit cannot be read', (w) => delete w[COMMIT]],
    ['the pull requests cannot be read', (w) => delete w[PULLS]],
    ['an answer has a shape it does not expect', (w) => (w[PULLS] = { message: 'Not Found' })],
  ];

  it.each(declines)('declines — build runs every gate — when %s', (_why, change) => {
    const world = releaseMerge();
    change(world);
    const outcome = runVerdict(world);
    expect(outcome.status, outcome.log).toBe(0);
    expect(outcome.output).toBe('');
    expect(outcome.summary).toContain('runs every gate');
  });

  it('declines when plan pinned no commit, without asking GitHub anything', () => {
    const outcome = runVerdict(releaseMerge(), { SHA: '' });
    expect(outcome.status, outcome.log).toBe(0);
    expect(outcome.output).toBe('');
    expect(outcome.calls).toEqual([]);
  });

  it('declines when GATES is not a list of job names', () => {
    for (const gates of ['', '"lint"', '[]', '[1]']) {
      const outcome = runVerdict(releaseMerge(), { GATES: gates });
      expect(outcome.status, `GATES=${gates}: ${outcome.log}`).toBe(0);
      expect(outcome.output, `GATES=${gates}`).toBe('');
    }
  });

  it('names an unexpected failure as one, and still exits 0', () => {
    const world = releaseMerge();
    world[PULLS] = { message: 'Not Found' };
    const outcome = runVerdict(world);
    expect(outcome.status, outcome.log).toBe(0);
    expect(outcome.summary).toContain('stopped unexpectedly');
  });
});

// ── 2. The wiring around it ────────────────────────────────────────────────

describe('publish.yml · only the verdict can skip a gate, and only a gate', () => {
  const build = jobBlock(PUBLISH, 'build');
  const steps = stepsOf(build);
  const skippable = steps.filter((step) => stepKey(step, 'if')?.includes('verdict'));
  const runOf = (step: string): string | undefined =>
    stepKey(step, 'run') === undefined ? undefined : runScript(step).trim();

  it('the gate steps — and only they — are skipped, by exactly the verdict condition', () => {
    for (const step of skippable) expect(stepKey(step, 'if')).toBe(SKIP_IF);
    expect(skippable.map((step) => stepKey(step, 'name'))).toEqual([
      'Documentation check (removed API names)',
      'Duplicate type check',
      'Format',
      'Lint',
      'Typecheck',
      "Tests (with coverage — the command CI's coverage job runs)",
      'Examples (typecheck + run every one end-to-end)',
      'Generated files are current',
      'Docs truth',
      'Doc links',
    ]);
  });

  it('the steps that build, check and stage the package always run', () => {
    for (const command of [
      'npm ci',
      'npm run build',
      'npm run test:context-package',
      'npx publint',
      'npx @arethetypeswrong/cli --pack',
    ]) {
      const step = steps.find((s) => runOf(s) === command);
      expect(step, `build has no step that runs \`${command}\``).toBeDefined();
      expect(stepKey(step as string, 'if'), `\`${command}\` must never be skipped`).toBeUndefined();
    }
    const stage = steps.find((s) => stepKey(s, 'name') === 'Stage published package');
    const upload = steps.find((s) => stepKey(s, 'uses')?.startsWith('actions/upload-artifact@'));
    for (const step of [stage, upload]) {
      expect(step).toBeDefined();
      expect(stepKey(step as string, 'if')).toBeUndefined();
    }
  });

  it('CI runs every command a skipped gate would have run, in a job the verdict requires', () => {
    // `test (22)` and `test (24)` are the two legs of ci.yml's `test` job.
    const ciCommands = new Set(
      GATES.flatMap((gate) => stepsOf(jobBlock(CI, gate.replace(/ \(\d+\)$/, ''))))
        .filter((step) => stepKey(step, 'run') !== undefined)
        .flatMap((step) => commandsOf(runScript(step))),
    );
    for (const step of skippable) {
      for (const command of commandsOf(runScript(step))) {
        expect(
          ciCommands.has(command),
          `build may skip \`${command}\` (step "${stepKey(step, 'name')}"), but no ci.yml job in ` +
            `verdict's GATES runs it — skipping it would skip a gate CI never ran.`,
        ).toBe(true);
      }
    }
  });

  it('every CI job the verdict requires exists in ci.yml under that exact check name', () => {
    for (const gate of GATES) {
      const leg = /^(.+) \((\d+)\)$/.exec(gate);
      const job = jobBlock(CI, leg ? leg[1] : gate); // throws when the job is gone
      // A job-level `name:` would change the check name the Jobs API reports.
      expect(job, `ci.yml · ${gate} must keep its default name`).not.toMatch(/^ {4}name:/m);
      if (leg) expect(job).toMatch(new RegExp(`node-version: \\[[^\\]]*\\b${leg[2]}\\b[^\\]]*\\]`));
    }
  });

  it('build runs every gate when the verdict failed, and nothing reaches npm untagged', () => {
    expect(build).toMatch(/^ {4}needs: \[plan, verdict\]$/m);
    expect(build).toContain(
      "if: ${{ !cancelled() && needs.plan.result == 'success' && needs.plan.outputs.mode == 'publish' }}",
    );
    expect(jobBlock(PUBLISH, 'release')).toContain("needs.build.result == 'success'");
    // A skipped `release` publishes only on the legacy trigger, whose tag exists.
    expect(jobBlock(PUBLISH, 'publish')).toContain(
      "(needs.release.result == 'skipped' && github.event_name == 'release')",
    );
  });

  it('the verdict reads the GitHub API only, with a read-only token', () => {
    const verdict = jobBlock(PUBLISH, 'verdict');
    expect(verdict, 'no action — so no checkout and no repository code').not.toMatch(
      /^\s+(- )?uses:/m,
    );
    expect(VERDICT_SCRIPT).not.toMatch(/(^\s*|\$\()(git|npm|npx|node)\s/m);
    expect(VERDICT_SCRIPT, 'every value through env, none through ${{ }}').not.toContain('${{');
    const permissions = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(verdict)?.[1] ?? '';
    const grants = permissions
      .split('\n')
      .filter(Boolean)
      .map((line) => line.replace(/#.*/, '').trim());
    expect(grants.sort()).toEqual(['actions: read', 'contents: read', 'pull-requests: read']);
    expect(VERDICT_SCRIPT.match(/tested=true/g), 'one way to say yes').toHaveLength(1);
  });

  it('the website never gates npm: nothing on the release path builds the docs site', () => {
    const code = PUBLISH.split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/docs-next|check:site-budget/);
    // The deploy still checks the budget, before it uploads anything.
    const deploy = jobBlock(DOCS, 'build');
    const budget = deploy.indexOf('npm run check:site-budget');
    expect(budget).toBeGreaterThan(-1);
    expect(budget).toBeLessThan(deploy.indexOf('actions/upload-pages-artifact@'));
  });
});

describe('ci.yml · what the verdict trusts', () => {
  it('tested-tree records the tree it checked out in a step NAME, and runs no dependency code', () => {
    const job = jobBlock(CI, 'tested-tree');
    const steps = stepsOf(job);
    const tree = steps.find((step) => stepKey(step, 'id') === 'tree');
    expect(tree).toBeDefined();
    expect(runScript(tree as string)).toBe(
      `echo "hash=$(git rev-parse 'HEAD^{tree}')" >> "$GITHUB_OUTPUT"`,
    );
    expect(steps.map((step) => stepKey(step, 'name'))).toContain(
      'tested tree ${{ steps.tree.outputs.hash }}',
    );
    expect(job).not.toMatch(/\bnpm\b|\bnpx\b|setup-node/);
    // …and the verdict reads exactly that job and that name.
    expect(VERDICT_SCRIPT).toContain('select(.name == "tested-tree"');
    expect(VERDICT_SCRIPT).toContain('capture("^tested tree (?<tree>[0-9a-f]{40})$")');
  });

  it('every job checks out the run’s own commit, so one recorded tree speaks for all of them', () => {
    for (const id of jobIds(CI)) {
      for (const step of stepsOf(jobBlock(CI, id))) {
        if (stepKey(step, 'uses')?.startsWith('actions/checkout@')) {
          expect(step, `ci.yml · ${id} checks out something else`).not.toMatch(/^\s+ref:/m);
        }
      }
    }
  });

  it('every action the verdict’s trust rests on is pinned to a full commit SHA', () => {
    for (const file of ['ci.yml', 'publish.yml', 'docs.yml']) {
      for (const [, action] of readWorkflow(file).matchAll(/^\s+(?:- )?uses:\s*(\S+)/gm)) {
        expect(action, `${file}: ${action}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
  });

  it('the docs job is skipped on the release PR — from this repository only — and checks the budget elsewhere', () => {
    const docs = jobBlock(CI, 'docs');
    const condition = /^ {4}if: >-\n((?: {6}.*\n)+)/m.exec(docs)?.[1].replace(/\s+/g, ' ').trim();
    expect(condition).toBe(
      "!(github.event_name == 'pull_request' && github.head_ref == 'release/next' && " +
        'github.event.pull_request.head.repo.full_name == github.repository)',
    );
    expect(docs).toContain('npm run check:site-budget');
  });
});
