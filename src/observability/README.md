**Fold** — post-hoc localization: which piece of context made this answer wrong.

## What it reads / what it writes
- Reads a finished run's context pieces and its record.
- Writes nothing into a run. Every answer carries its own evidence grade
  (`'guessed'` | `'proven'`).

## The one law here
The grade travels with the answer. A finder that ranks by similarity says
"guessed"; only a finder that re-ran the agent and flipped the outcome may say
"proven".

## Files
- `contextError/finders/` — the six pluggable finders and their contract.

Names nearby that are not this folder: `src/recorders/observability/` is the
Tier-3 recorder set, and `src/strategies/` holds the exporters.
`src/debug/finders.ts` re-exports this folder under a shorter name; it says it
absorbed these files, and it did not.
