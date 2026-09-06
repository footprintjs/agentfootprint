**Map** — a check over what is DECLARED: a tool catalog in, a CI-gateable
verdict out about names and descriptions that are confusable, before any run
happens.

## What it reads / what it writes
- Reads the declared catalog only (names, descriptions, schemas).
- Writes a report. No run, no scope, no model.

## The one law here
A lint judges declarations, not behaviour. Every rule is structural and
pluggable, so a finding can always be traced to the rule that made it.

## Files
- `analyze.ts` — the confusability analysis.
- `rules.ts` — the pluggable structural rule pack.
- `format.ts` — the human rendering.
- `cli.ts` — the CI gate's core (the `bin/` script is a humble shell).
- `types.ts`, `index.ts`.
