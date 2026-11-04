**Lens** — the existing bounded trace views and evidence readers that compose results for a debugging model.

`../traceToolpack.ts` remains the canonical entry and forwards only `traceToolpack`, `callTraceTool` and the existing lightweight `TRACE_TOOL_NAMES` export. This folder moves complete existing units; it does not add another query implementation.

- `recursiveFactory.ts` keeps the factory, both recursive descent doors and offline invocation together. Its offline context is still created once.
- `toolCallJournal.ts` owns the lazy history/ledger/event join and tool-call inspection. Its nested readers and caches stay inside the original reader function.
- `contextErrors.ts`, `findInTrace.ts`, `runOverview.ts`, `nodeView.ts`, `sliceView.ts`, `backtrackView.ts`, `valueQueries.ts` and `narrativeView.ts` own their existing tool views.
- `findingEvidence.ts` reads the recorded integrity findings and dispositions. `innerRecords.ts` reads retained inner records and their control-dependence lookup.
- `packIndex.ts` builds the same per-pack index. `navigationHints.ts`, `parameterSchemas.ts`, `valueLines.ts`, `writerHints.ts` and `structuralLimits.ts` supply the same navigation, schema and bounded display facts.
- `artifactFacts.ts` is the one internal owner of the two existing weak registries. They remain absent from the canonical exports and are never cloned or made per-pack.

All values still pass through the original `../bounded.ts` owner. The pack never re-runs the recorded operation or reconstructs a redacted value. Missing and bounded records keep their existing uncertainty messages.
