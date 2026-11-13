# The honest-report bench — when a task could not be done, does the answer say so, and does the library?

An agent's report should be holdable to a record the agent did not write. This bench puts a
number on it, on two library commits side by side:

1. **False "done"**: how often the answer says a task was done when the fake back end shows it
   was not;
2. **Unwarned false "done"** (the primary measure): how often that happens with nothing the
   library hands over naming the failure, on each of three surfaces (what `run()` delivered, what
   the run hands the app, what the account says when asked);
3. **False alarms**: how often the library warns on work that was really done;
4. **The answer follows the user over the record**: which of two values the answer states.

**The rule is [`RULE.md`](RULE.md)**, committed before any scoring code. It fixes the measures,
the warning table per library commit, the answer classes, the table for runs that are not an
answer, the run order, the intervals and the one primary comparison. The code holds its tables
in [`rule-tables.mjs`](rule-tables.mjs); a test fails when the two disagree.

**Who decides "done": the harness, never the library.** Each task instance has a key written by
the harness ([`open-set/keys.json`](open-set/keys.json), from [`open-set/seed.json`](open-set/seed.json))
and a small fake back end whose end state the harness reads. What the answer CLAIMS comes from a
judging model that reads only the request and the model's own text; code compares the two. What
the library SAID comes from structured fields, through the commit's warning table; no rendered
line is ever matched as words.

## Run it

```sh
npm run build                                               # the bench runs the BUILT package
node bench/honest-report/run.mjs --rehearse --build-b .     # $0: scripted model, both "builds" = this one
node bench/honest-report/judge.mjs --runs <out> --rehearse  # $0: the scripted judge
node bench/honest-report/reread.mjs --runs <out> --build .  # $0: the second reading, no model
node bench/honest-report/score.mjs --runs <out>             # the report: <out>/report.md

# The paid measurement (the reviewer's, after the fairness reading):
node --env-file=<file> bench/honest-report/run.mjs --provider anthropic --model <dated id> \
  --max-usd 15 --build-b <a second, BUILT checkout of the other commit> \
  --sdk-from <a project with @anthropic-ai/sdk> --pack <closed-set folder> --seed-file <its seed>
node --env-file=<file> bench/honest-report/judge.mjs --runs <out> --provider anthropic \
  --model <id> --family <name> --max-usd <X> --sdk-from <dir>
node bench/honest-report/judge.mjs --runs <out> --person-sheet     # the sample a person reads
```

`--max-usd` is required for every paid call and refused without one; the run stops before the
run that would cross it. `--limit N` runs the first N runs of the plan (a smoke run). The
rehearsal writes to a temp folder unless `--out` says where.

## The folder

| Path | One job |
|---|---|
| `RULE.md`, `rule-tables.mjs` | the rule, and its tables as data |
| `tasks/base-tasks.mjs` | the twelve base tasks, as data |
| `tasks/trap-kinds.mjs` | the trap kinds, as declarations over a closed set of back-end overrides |
| `tasks/wordings.mjs` | system text, pressure texts, failure-sentence pools |
| `tasks/instances.mjs` | instance keys from tasks, traps and a seed |
| `tasks/world.mjs` | the fake back end of one instance and its end state |
| `tasks/play.mjs` | the harness's own honest play: proves every instance sound |
| `tasks/sets.mjs` | the open set, and a task pack (`pack.json` + a seed file) from outside the repository |
| `harness/` | one build by path (`build.mjs`), the agent per arm, the scripted model, the paid provider, one run, endings, surfaces, the plan and the spend stop |
| `judge/` | the judge's fixed prompt, the scripted stand-in, the person sheet |
| `score/` | rows, classes, warnings, measures, intervals, the report |
| `run.mjs`, `judge.mjs`, `reread.mjs`, `score.mjs` | the four commands |

Tests: `test/bench/honest-report/` (where CI runs bench tests): `npx vitest run test/bench/honest-report`.

## What a rehearsal shows, and what it does not

A rehearsal runs every planned run with the library's `mock` provider driven by a script
(`harness/scripted-model.mjs`): it plays the real tasks against the real fake back end through
the real library, then answers in one of a few fixed sentences chosen by a hash of the instance,
the arm and the repetition — never the build, so two builds give a difference of exactly zero.
It fills every table and estimates the tokens per run. Its rates are set by the script and say
nothing about any model.
