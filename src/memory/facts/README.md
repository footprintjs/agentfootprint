**Mixed** — stable claims distilled out of turns, and the system message they
become.
Fold: `extractFacts.ts`, `extractor.ts`, `patternFactExtractor.ts`,
`llmFactExtractor.ts`, `loadFacts.ts`, `types.ts` — what may still be claimed
about the user or the world.
Trace-side: `writeFacts.ts` persists them.
Lens: `formatFacts.ts` · `formatFacts` renders the loaded facts into ONE system
message, writing `scope.formatted`. `llmFactExtractor.ts` ·
`DEFAULT_SYSTEM_PROMPT` is a Lens too — the extractor prompt this folder
composes and sends on its side call, filed `kind: 'ephemeral'` by
`test/modelFacingScan.test.ts`.

## What it reads / what it writes
- Reads `scope.newMessages` (write side) and `scope.loadedFacts` (read side).
- Writes `newFacts`, the store rows, and `scope.formatted`.
- Two surfaces here reach a model: `scope.formatted`, and the LLM extractor's
  own system prompt on its side call.

## The one law here
A fact is timeless or it is not a fact — anything true only of one turn is a
beat. The formatter owns the wording and the message role; the extractors own
data.

## Files
- `extractFacts.ts`, `extractor.ts`, `patternFactExtractor.ts`,
  `llmFactExtractor.ts`, `loadFacts.ts`, `writeFacts.ts`, `types.ts`, `index.ts`.
- `formatFacts.ts` — the model-facing sentence.
- `llmFactExtractor.ts` — a Fold that composes its own extractor prompt.
