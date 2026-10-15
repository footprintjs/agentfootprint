---
type: internal
---
**The request receipt and the inner-run records move to the code that writes them.** `receipt.ts`, `receiptDigests.ts` and `requestMeasurement.ts` move from `lib/time-travel/` to `core/agent/receipt/`, beside the LLM call that mints the receipt; `innerRunRecords.ts` moves from `lib/trace-toolpack/` to `core/`, beside the runner that fills the store. The readers stay where they were (`servedAt`, `receiptAt` in time-travel; `inspect_tool_run` in the trace toolpack) and now import downward, so eight upward edges leave the layering allowance list. Every door exports the same names as before.
