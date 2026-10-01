# bench/time: the English-reader bench (time step T6b)

This bench measures what `.time({ reader: englishTimeReader() })` changes. With the reader, every
time phrase a person types in chat is proposed and then confirmed with a pre-filled, one-click
confirmation that names the window and its zone. The bench compares that arm with the same agent
without the reader. The registered rule, cases, protocol and margins are in [RULE.md](RULE.md).
Version 2 of the rule, [RULE-v2.md](RULE-v2.md) (`--rule t6b-v2`), splits v1's T2 for the run
clock that time G16 serves on every request; v1 stays frozen and is still the default.

```sh
npm run build                          # the bench runs the built package
node bench/time/run.mjs                # the scripted mock, every variant once, $0
node --env-file=<file with ANTHROPIC_API_KEY> bench/time/run.mjs \
  --provider anthropic --max-usd 3.00 --concurrency 4 --sdk-from <project with @anthropic-ai/sdk>
node bench/time/run.mjs --rescore bench/time/runs/<dir>   # re-read saved runs, no model call
```

| File | Job |
|---|---|
| `cases.mjs` | the clock anchor, the two tools, the cases with their planted truths, the simulated person |
| `harness.mjs` | runs one (case, arm, repetition) and keeps the tools' read log, the asks, the time rows, the late time line of each request, and the usage |
| `metrics.mjs` | turns one saved run into one row, and rows into tables, read from the record and the truth only |
| `rule.mjs` | `RULE.md` written as code, so the verdict is computed |
| `rule-v2.mjs` | `RULE-v2.md` written as code: v1's own clauses, with T2 split into T2a/T2b and T7 added |
| `run.mjs` | the command: it shifts the clock to the anchor, interleaves the arms under a seeded shuffle, enforces the cap and writes `results.json`, `report.md` and `raw/` |

Paid runs are committed under `runs/`.
