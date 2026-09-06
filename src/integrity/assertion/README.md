**Fold** — one typed claim about one subject, and the pure comparison that says
which two claims cannot both be true.

## What it reads / what it writes
- Reads a finite set of assertions the checks collected from the record.
- Writes nothing: `conflictsOf` returns fresh data. No I/O, no store, no clock.

## The one law here
A contradiction must be DECIDABLE from the assertions themselves. Two claims
conflict because their declared exclusion rule says so, never because a
heuristic thought they looked incompatible.

## Files
- `types.ts` — `Assertion`, and the two rules that give the algebra its teeth.
- `conflicts.ts` — the exclusion comparison, pure.
