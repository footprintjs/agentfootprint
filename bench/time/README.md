# bench/time: the English-reader bench (time step T6b)

This bench measures what `.time({ reader: englishTimeReader() })` changes. With the reader, every
time phrase a person types in chat is proposed and then confirmed with a pre-filled, one-click
confirmation that names the window and its zone. The bench compares that arm with the same agent
without the reader. The registered rule, cases, protocol and margins are in [RULE.md](RULE.md).

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
| `run.mjs` | the command: it shifts the clock to the anchor, interleaves the arms under a seeded shuffle, enforces the cap and writes `results.json`, `report.md` and `raw/` |

Paid runs are committed under `runs/`.
