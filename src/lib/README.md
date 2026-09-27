**Mixed** — the leaves every layer must agree on.
Fold owners: `spokenIds.ts` (which ids a filtered sentence may NAME, and whether
the set was non-empty before the filter), `saidByPerson.ts` (which `role:'user'`
turn a PERSON wrote), `iterationBudget.ts` (how many actions a turn has left —
the number a model is told), `toolBytes.ts` (where a tool's OWN words end in a
result message the library annotated). All four live here rather than beside
their first caller so that readers in folders that cannot import each other
cannot answer the same question differently.
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
- `toolBytes.ts` — `toolBytesOf`: a result's content cut at the tool-bytes
  boundary (`LLMMessage.toolChars`, honesty layer 2). The evidence index, the
  answer's standing, the answer account and the unsupported-argument and
  empty-lookup seams read results through it, so the inputs layer's note is
  never read as the tool's words.

  ```ts
  toolBytesOf({ content: '[]\n\n[window was not in … "2h" …]', toolChars: 2 }); // '[]'
  ```
- `canonicalJson.ts`, `fnv1a.ts` — deterministic serialization and hashing.
- `lazyRequire.ts`, `sqliteUnavailable.ts`, `embedderMismatch.ts` — optional-peer
  loading and its two shared refusals.
- `libraryVersion.ts`, `storedPreview.ts` — provenance stamp; how much of
  somebody's stored data a refusal may quote.
