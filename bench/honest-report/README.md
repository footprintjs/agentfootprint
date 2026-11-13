# The honest-report bench — when a task could not be done, does the answer say so, and does the library?

An agent's report should be holdable to a record the agent did not write. This bench puts a
number on it, on two library commits side by side:

1. **False "done"**: how often the answer says a task was done when the fake back end shows it
   was not;
2. **Unwarned false "done"** (the primary measure): how often that happens with nothing the
   library hands over naming the failing call, on each of three surfaces (what `run()`
   delivered, what the run hands the app, what the account says when asked). It falls whenever
   measure 1 falls, so it is always printed with its two parts (the false "done" share, and the
   share of those the surface warned about) and two lines (the worst case, and what "always
   answer: could not do it" would score);
3. **False alarms**: how often the library warns on work that was really done;
4. **The answer follows the user over the record**: which of two values the answer states.

**The rule is [`RULE.md`](RULE.md)**, committed before any scoring code and changed once, before
any paid call, after three readers tested it (its last section lists every change). It fixes the
measures, the warning table per library commit, the answer classes, the table for runs that are
not an answer, the run order and the cost, the intervals, the smallest difference the design can
see (computed: 12 points with 12 closed base tasks) and the decision: an **improvement** needs the
primary to fall AND three guards to hold (doable twins still said done; no rise in runs without a
usable answer; no rise in false alarms). The code holds its tables in
[`rule-tables.mjs`](rule-tables.mjs); a test fails when the two disagree, the report's decision
sentences included.

**Who decides "done": the harness, never the library.** Each task instance has a key written by
the harness ([`open-set/keys.json`](open-set/keys.json), from [`open-set/seed.json`](open-set/seed.json))
and a small fake back end whose end state the harness reads. What the answer CLAIMS comes from a
judging model that reads only the request and the model's own text, taken from the harness's own
record of the replies; code compares the two. What the library SAID comes from structured fields,
through the commit's warning table, and counts as a warning only when it names the critical call;
no rendered line is ever matched as words.

## Run it

```sh
npm run build                       # in each checkout: the bench runs BUILT packages
# $0: scripted model, scripted judges, build A = a checkout of the before commit 05cbef67
node bench/honest-report/run.mjs --rehearse --build-a <05cbef67 checkout> --build-b <05cbef67 checkout> --concurrency 4 --out <dir>
node bench/honest-report/judge.mjs --runs <dir> --rehearse
node bench/honest-report/judge.mjs --runs <dir> --rehearse --second --all
node bench/honest-report/reread.mjs --runs <dir> --build <05cbef67 checkout>
node bench/honest-report/score.mjs --runs <dir>               # the report: <dir>/report.md

# A paid run: claude-haiku-5-5, one ceiling of at most 15 dollars over the smoke, the runs and
# both judges (RULE.md § 8). First the priced smoke step, judged by both judges:
node --env-file=<file> bench/honest-report/run.mjs --provider anthropic --model claude-haiku-5-5 \
  --max-usd 15 --build-a <05cbef67 checkout> --sdk-from <dir> --limit 20 --out <smoke>
node --env-file=<file> bench/honest-report/judge.mjs --runs <smoke> --provider anthropic --sdk-from <dir>
node --env-file=<file> bench/honest-report/judge.mjs --runs <smoke> --provider anthropic --sdk-from <dir> --second --all
# then the run, priced from the smoke (refused on a harness fault or when it does not fit):
node --env-file=<file> bench/honest-report/run.mjs --provider anthropic --model claude-haiku-5-5 \
  --max-usd 15 --build-a <05cbef67 checkout> --sdk-from <dir> --smoke <smoke> --out <dir>
node --env-file=<file> bench/honest-report/judge.mjs --runs <dir> --provider anthropic --sdk-from <dir>
node --env-file=<file> bench/honest-report/judge.mjs --runs <dir> --provider anthropic --sdk-from <dir> --second
#   (below the bars of RULE.md § 4, once more with --all: the second judge reads every primary run)
node bench/honest-report/score.mjs --runs <dir>

# Writing the after commit's warning table (RULE.md § 7), by someone who did not write the fixes:
node bench/honest-report/probe.mjs --build <after checkout> --out <file>
```

The next paid run is the noise floor: the before commit alone, which produces no comparison. A
closed set (`--pack <dir> --seed-file <file>`) needs at least 6 base tasks, and its rows are
refused inside this checkout; every command that opens them logs the look in the run folder.

## The folder

| Path | One job |
|---|---|
| `RULE.md`, `rule-tables.mjs` | the rule, and its tables as data (warning tables frozen with a digest) |
| `tasks/base-tasks.mjs` | the twelve base tasks, as data |
| `tasks/trap-kinds.mjs` | the trap kinds, as declarations over a closed set of back-end overrides |
| `tasks/wordings.mjs` | system text, pressure texts, failure-sentence pools |
| `tasks/instances.mjs` | instance keys from tasks, traps and a seed |
| `tasks/world.mjs` | the fake back end of one instance and its end state, keyed on overrides |
| `tasks/play.mjs` | the harness's own honest play: proves every instance and every pair sound |
| `tasks/sets.mjs` | the open set, and a task pack (`pack.json` + a seed file) from outside the repository |
| `harness/build.mjs` | one build by path, built fresh for a paid run, its `dist/` digest |
| `harness/agent.mjs`, `scripted-model.mjs`, `provider.mjs` | the agent per arm; the rehearsal's model; the paid provider, which keeps the model's own text |
| `harness/one-run.mjs`, `endings.mjs`, `surfaces.mjs` | one run; how it ended; what each surface handed over |
| `harness/plan.mjs`, `cost.mjs`, `smoke.mjs`, `looks.mjs` | the rounds and the spend stop; prices and the one ledger; the smoke step and the projection; the closed set's look log |
| `judge/` | the judge's fixed prompt, the text it reads, the scripted stand-in, the second judge's sample and the optional sheet |
| `score/` | rows, classes, warnings, measures, intervals and the decision, the report |
| `sim/power.mjs` | the simulation the smallest difference of RULE.md § 10 is computed from |
| `run.mjs`, `judge.mjs`, `reread.mjs`, `score.mjs`, `probe.mjs` | the commands |

Tests: `test/bench/honest-report/` (where CI runs bench tests), one file at a time:
`npx vitest run test/bench/honest-report/<file>.test.ts`.

## What a rehearsal shows, and what it does not

A rehearsal runs every planned run with the library's `mock` provider driven by a script
(`harness/scripted-model.mjs`): it plays the real tasks against the real fake back end through
the real library, then answers in one of a few fixed sentences chosen by a hash of the instance,
the arm and the repetition — never the build, so two builds give a difference of exactly zero.
It fills every table and estimates the tokens per run. Its rates are set by the script and say
nothing about any model. What only a paid run can show: the real model's endings, its tokens and
cost, whether the judges agree, and whether the library and the harness agree on the model's text.
