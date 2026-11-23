# Answer-fact inventory

When the library cuts, replaces, holds back, or cannot read something the model could otherwise
see, capture what happened in one committed fact. An event or the text of a replacement can
explain the operation on its own surface. The saved answer assessment needs a fact it can read.
Keep the fact narrow: a kind, a source the host may disclose, and bounded counts when available.

## Recorded paths

| Hiding boundary | Committed fact | End-to-end evidence |
| --- | --- | --- |
| Result character cap, initial and resumed delivery | `recordServedLimits` appends `result-cut` to `libraryResultLimits`. It consumes the actual served cut. | `test/core/agent/assessment/recorded-result-limits.test.ts`, including live, saved and resumed controls. |
| Unredeemed result placement | `recordLibraryResultLimits` appends `placed-unread` to the same key. A content read clears the pending fact. | `test/artifacts/placement-answer-receipts.test.ts` and the recorded result tests. |
| Current-turn results removed by a Window drop or summary | `commitWindowResultDrops` uses `recordLibraryResultLimits` to record `result-dropped-from-window` for results removed by the applied history change. | `test/core/agent/assessment/standing-window.test.ts` checks both strategies with and without eviction details and verifies that a retained result produces no drop reason. |
| Unzoned times in a delivered native dataset | `captureDatasetLimit` records pending metadata. `recordServedLimits` appends `times-without-zone` for matching served refs. | Recorded result tests distinguish the served dataset from scratch, replaced and withheld refs. |
| Provider cuts the accepted prose response | `recordResponseStop` owns `llmLatestStopReason`. The grouped call maps through `responseStopFields`. | `src/core/agent/assessment/answer/completion/completion.test.ts` covers classic, dynamic and grouped calls, saved output and clearing stale cutoff. |
| Middleware withholds a result | The fold reads committed `middlewareDecisions` and produces anonymous `result-withheld`. No payload, rule words or tool attribution. | `test/core/agent/assessment/result-visibility-matrix.test.ts` checks which facts reach the answer. |
| Per-tool result ceiling | A refusal reaches `call-not-completed`. Measure and expose a safe counts fact separately before claiming the answer knows why the ceiling refused. | The architecture inventory pins the ceiling operation and owner. |
| Code runner clipping and unsuccessful execution | `clipOutput` measures the cut and `codeRunStatus` classifies the result. Initial and resumed dispatch admit the status through `readExecutedResult`. Committed `settledToolCalls` facts supply failure or partial status and permitted counts to `call-not-completed` or `work-not-finished`. | `test/core/codeRunnerTool-unknown-outcome.test.ts` covers initial and resumed calls, retained counts, saved assessments, and redaction. |

## Open gaps and follow-ups

Each row names the behavior a follow-up must prove. Some operations already leave a record. Their follow-ups need to carry the specific fact through to the answer. Ownership and sequencing live on
the task board. Run a real mock turn and a saved assessment when recording is added.

| Boundary | Fact or reason still to prove | Follow-up |
| --- | --- | --- |
| After-tool replacement | Native not-checked, absence and period facts survive when disclosure allows. Keep deny anonymous. | 3b |
| Object-shaped result and empty rowset ticket | Admitted empty row count reaches the answer without making an unread value known empty. | 3e |
| Retrieval threshold and budget | Record the library's decision to omit otherwise eligible retrieved context. Separate threshold and budget. | 3f retrieval |
| Tool choice, gate, ledger, active skill, refused skill and name collision | Identify what was eligible and omitted, with disclosure determined by the existing access policy. | 3f serving |
| Local answer inspection ceiling | The answer records the words left unread under the bare evidence gate. Provider cutoff remains a separate fact. | 3a follow-up |
| Findings collapse | Describe wire-only omission from the already committed findings. | Later, findings |
| Runbook and artifact paging | Distinguish a partially served result or page from its whole recorded source. | Later, runbook and artifact pages |
| Time axis conversion and the shifted or partly retained period | Separate the delivered unzoned count from conversion and remaining period signals. Prove the overlap with current period reasons first. | Later, time and periods |
| Evidence revision withholding tools | Show that lib-forced finalization withheld eligible pending calls without exposing their arguments. | Later, evidence revision |
| Replay omissions and deferred injection | Name a replay omission or a deferred input from committed facts appropriate to each surface. | Later, replay and injection |

## What the architecture check proves

`hidingInventoryCases.ts` names the production boundaries. The check resolves every listed
symbol, verifies the imported calls at the registered boundaries, and rejects additional callers
of those operations. It treats the cap's native and model projections as two calls to one
operation and expects one call to the recording door per delivery path. It also checks that the answer
fold reads the audited result limits, settlements, and response stop. The scenario tests above cover counts, recording scope,
and what saved assessments can use. Adding a boundary outside the inventoried operations still
requires a source read and a new inventory entry.
