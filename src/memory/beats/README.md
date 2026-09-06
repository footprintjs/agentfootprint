**Mixed** — a turn compressed into narrative beats, and the paragraph they
become.
Fold: `extractBeats.ts`, `extractor.ts`, `heuristicExtractor.ts`,
`llmExtractor.ts`, `types.ts` — what may be said about what happened.
Trace-side: `writeBeats.ts` persists them.
Lens: `formatAsNarrative.ts` · `formatAsNarrative` renders selected beats into
ONE system paragraph, writing `scope.formatted`. `llmExtractor.ts` ·
`DEFAULT_SYSTEM_PROMPT` is a Lens too — the extractor prompt this folder
composes and sends on the beats side call.

## What it reads / what it writes
- Reads `scope.newMessages` (write side) and the selected beats (read side).
- Writes `newBeats`, the store rows, and `scope.formatted`.
- Two surfaces here reach a model: `scope.formatted`, and the LLM extractor's
  own system prompt on its side call.

## The one law here
The formatter owns the role and the wording of what reaches the model; every
other file here owns data. Source refs are appended only when asked for, so the
paragraph never implies evidence it is not showing.

## Files
- `extractBeats.ts`, `extractor.ts`, `heuristicExtractor.ts`, `llmExtractor.ts`.
- `writeBeats.ts`, `types.ts`, `index.ts`.
- `formatAsNarrative.ts` — the model-facing sentence.
- `llmExtractor.ts` — a Fold that composes its own extractor prompt.
