**Support** — pure law about what may ENTER the window, and the record shapes
the Deliver stage commits.

## What it reads / what it writes
- Reads a delivered injection and the current window; answers "may this go here,
  and is it already there?".
- Writes nothing itself. The Deliver stage commits `deliveredMessageKeys`
  (owner: `../stages/deliver.ts` · `scope.deliveredMessageKeys`).

## The one law here
This folder is the exact counterpart of `../window/turns.ts`, which owns what may
LEAVE. Entry law and exit law stay separate files so neither can quietly assume
the other.

## Files
- `rules.ts` — where a delivered injection may go, and whether it is there.
- `types.ts` — the two outcome shapes, plain data so they survive the record.
