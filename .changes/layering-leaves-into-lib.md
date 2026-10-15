---
type: internal
---
**Shared leaves moved into `src/lib/`.** `conventions.ts`, `moments.ts`, `traceToolNames.ts`, `humanizeLLMError.ts` and `sha256.ts` moved into `src/lib/`; `stableJson` (out of the receipt) and the tool-name check (`assertValidToolName`, `warnIfInvalidToolName`, out of `core/tools.ts`) became `lib/stableJson.ts` and `lib/toolName.ts`; `RECEIPT_KEY` joined the other scope-key names in `lib/conventions.ts`. Thirty upward imports are gone from the layer table's allowance list, and `src/lib/`'s leaves now import nothing in `src/` outside themselves (checked by `npm run check:layering`). Internal paths only: every public door exports the same names.
