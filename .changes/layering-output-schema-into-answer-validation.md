---
type: internal
---
**`outputSchema.ts` moves from `core/` to `answer-validation/`.** The answer's declared shape (`OutputSchemaParser`, its default instruction, `applyOutputSchema`, `OutputSchemaError`) now lives beside the validator that applies it, so `answer-validation` no longer imports `core` and one upward edge leaves the layering allowance list. Every public export keeps its name and its door.
