**Mixed** — the leaves every layer must agree on.
Fold owners: `spokenIds.ts` (which ids a filtered sentence may NAME, and whether
the set was non-empty before the filter), `saidByPerson.ts` (which `role:'user'`
turn a PERSON wrote), `iterationBudget.ts` (how many actions a turn has left —
the number a model is told). All three live here rather than beside their first
caller so that a composer inside the skill-graph fence and the agent loop outside
it cannot answer the same question differently.
Support: `canonicalJson.ts`, `fnv1a.ts`, `lazyRequire.ts`, `libraryVersion.ts`,
`sqliteUnavailable.ts`, `embedderMismatch.ts`, `storedPreview.ts`.
Every subfolder here has its own role and its own README.

## What it reads / what it writes
Nothing on scope. These are zero- or near-zero-import leaves: values in, values
out, all detached (`spoken()` returns a fresh `{ named, held }`).

## The one law here
One owner per fact. When two layers must agree about a fact and cannot import
each other, the fact moves HERE — that is exactly why `spokenIds.ts` exists
(`spokenIds.ts` · "── WHY THIS IS A LEAF AND NOT A HELPER IN THE GATE") and why the writers of library-authored turns import the
prefixes the recogniser matches on (`saidByPerson.ts`).

## Files
- `spokenIds.ts` — `named` vs `held`; `held` is required, not optional.
- `saidByPerson.ts` — the opening registry and the `injectedBy` marker.
- `iterationBudget.ts` — `iterationsRemainingOf`, computed once.
- `canonicalJson.ts`, `fnv1a.ts` — deterministic serialization and hashing.
- `lazyRequire.ts`, `sqliteUnavailable.ts`, `embedderMismatch.ts` — optional-peer
  loading and its two shared refusals.
- `libraryVersion.ts`, `storedPreview.ts` — provenance stamp; how much of
  somebody's stored data a refusal may quote.
