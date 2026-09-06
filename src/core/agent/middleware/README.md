**Mixed** — the governance chain: three verbs walked forwards over a call and
backwards over its result.
Walker: `runChain.ts` (the one place a chain is walked), `outcomes.ts`,
`types.ts`.
Trace: `ledger.ts` — one writer for one committed key, where a chain's decisions
become record.
Support: `errors.ts`, `index.ts`.

## What it reads / what it writes
- Reads the call (or its result) and the caller's own middleware list.
- Writes the decisions through `ledger.ts` only; `deny` raises
  `MessageDeniedError`.

## The one law here
Every decision is recorded, including the boring ones. A chain that allowed
silently and a chain that never ran must not look the same afterwards.

## Files
- `runChain.ts` — the Chain-of-Responsibility driver.
- `outcomes.ts` — `allow` / `deny` / `ask`, as smart constructors.
- `ledger.ts` — `recordDecisions`.
- `types.ts`, `errors.ts`, `index.ts` — shape, refusal, barrel.
