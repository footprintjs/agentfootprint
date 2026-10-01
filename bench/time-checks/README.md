# bench/time-checks: the result-checks bench (time step T8)

This bench measures what step T8 changes. Under `.time()` each call's READ is compared with what
it ASKED; a narrower, wider or shifted read, or a window older than the source keeps, makes the
answer "not sure", is printed in the limits block, and reaches the model as one late line before
it answers. The bench runs the same sheet on the build before T8 (`off`) and this build (`on`),
interleaved. The registered rule, cases, protocol and margins are in [RULE.md](RULE.md).

```sh
npm run build                                   # arm on: this checkout
git worktree add --detach <dir> e0d981ba        # arm off: the commit before T8
ln -sfn "$PWD/node_modules" <dir>/node_modules && (cd <dir> && npm run build)
node bench/time-checks/run.mjs --baseline <dir>                 # the scripted mock, $0
node --env-file=<file with ANTHROPIC_API_KEY> bench/time-checks/run.mjs --baseline <dir> \
  --provider anthropic --max-usd 3.00 --concurrency 4 --sdk-from <project with @anthropic-ai/sdk>
node bench/time-checks/run.mjs --rescore bench/time-checks/runs/<dir>   # re-read saved runs
```

| File | Job |
|---|---|
| `cases.mjs` | the clock anchor, the tools and their stores, the cases with the person's window, the simulated person |
| `harness.mjs` | runs one (case, arm, repetition) on that arm's build; keeps each store's own read log, the time rows, the standing, the model's own final words, the late line of each request, the usage |
| `labels.mjs` | the deterministic labeller: scoped, hedged, facts, counted, claims past what was read |
| `metrics.mjs` | the truth (the reads against the person's window), one row per run, the tables |
| `rule.mjs` | `RULE.md` as code, so the verdict is computed |
| `run.mjs` | the command: shifts the clock, loads both builds, interleaves the arms under a seeded shuffle, enforces the cap, writes `results.json`, `report.md` and `raw/` |

Paid runs are committed under `runs/`.

## The pause/shift follow-up (`RULE-shift.md`, rule `time-rule-shift`)

A second registered rule on the same sheet: the pause case (`lookback-after-pause`) and two
controls (`c-lookback-hour`, `c-clamp-7d`), arm `before` = a reference build that served the two
ranges to compare, arm `after` = this build, which serves the library's conclusion
(`coverage/period.ts` · `shiftedConclusion`). Same harness, truth and labeller; its own arms, plan
and verdict.

```sh
node bench/time-checks/run-shift.mjs --before <reference dir>          # the scripted mock, $0
node --env-file=<file with ANTHROPIC_API_KEY> bench/time-checks/run-shift.mjs --before <dir> \
  --provider anthropic --max-usd 0.60 --concurrency 4 --sdk-from <project with @anthropic-ai/sdk>
```

| File | Job |
|---|---|
| `rule-shift.mjs` | `RULE-shift.md` as code: the rows it reads (`shiftRowOf`), the tallies, the verdict |
| `run-shift.mjs` | the command: both builds, the seeded interleave, the cap, `results.json`, `report.md`, `raw/` |
