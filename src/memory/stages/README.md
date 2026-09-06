**Mixed** — the read/write steps of a memory pipeline, the one step that stops
being a step and becomes a served view, and one step that is both.
Walker: `loadRecent.ts`, `filterByDecay.ts`, `pickByBudget.ts`, `tokenize.ts`,
`writeMessages.ts`.
Lens: `formatDefault.ts` · `formatDefault` — it writes `scope.formatted`, the
system message the slot subflow injects, and its header states both flavours,
the chosen role `system`, and why one message rather than N.
Walker + Lens: `summarize.ts` · `summarize` walks the window, and
`summarize.ts` · `DEFAULT_SYSTEM_PROMPT` is a system prompt this folder composes
and sends on the compaction side call; the summary it writes back is a stored
`{ role: 'system', content }` entry a formatter later serves into a prompt.
`test/modelFacingScan.test.ts` files it `kind: 'ephemeral'`.

## What it reads / what it writes
- Reads `scope.loaded`, `selected` and `retrieved` (owner: `../retrieval/`).
- Writes `scope.formatted` — the message the recall slot injects — and, on the
  compaction path, a stored summary entry.
- Two surfaces here reach a model: `scope.formatted`, and the summarizer's own
  system prompt on its side call.

## The one law here
The formatter owns the message role and the wording. That was invisible once and
cost a released feature: `../asRoleRefusal.ts` · "The `asRole` refusal — one
sentence, said in every place the option could be declared" records `asRole`
being stored, read back, and never honoured, because nothing said the formatters
own the role.

## Files
- `loadRecent.ts`, `filterByDecay.ts`, `pickByBudget.ts`, `writeMessages.ts`,
  `tokenize.ts`, `types.ts`, `index.ts`.
- `summarize.ts` — the compaction step and its own extractor prompt.
- `formatDefault.ts` — the model-facing message.
