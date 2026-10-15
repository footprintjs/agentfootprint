---
type: internal
---
**The provider port moved to `src/provider-contract/`.** `adapters/types.ts` (the port interfaces), the two capability readers (`forcedToolChoice.ts`, `nativeOutputSchema.ts`), `requestRefusal.ts` and `adapters/llm/contextWindow.ts` now live in their own folder below the agent, the provider decorators and `security/`, beside `memory/`. `adapters/` keeps only implementations, and nothing below it imports it, by value or by type. Eighteen upward imports left the layer table's allowance list (`npm run check:layering`). Internal paths only: every public door exports the same names.
