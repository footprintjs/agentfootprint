# `src/core/agent/stages/` — the ReAct loop's stage functions

One file per stage of the Agent chart, mounted by `buildAgentChart` /
`buildDynamicAgentChart` (never imported by consumers):

| file | stage |
|---|---|
| seed.ts | run-start state seeding (history, counters, injection arrays) |
| pickEntry.ts | off-loop entry scoring for `.entryBy()` skill graphs |
| window.ts | `.window()` compaction (loop head when configured) |
| deliver.ts | messages-slot delivery (role-checked, sequence-checked) |
| callLLM.ts | provider invocation + streaming + reliability retry loop |
| route.ts | the decider: tool-calls / output-retry / final |
| toolCalls.ts | tool dispatch (pausable): permission gate → middleware → validation → credentials → execute; the read_skill gate |
| outputRetry.ts | `.outputSchema()` re-ask branch |
| reliabilityExecution.ts | in-loop reliability rules |
| prepareFinal.ts / breakFinal.ts | final answer + `$break` |

## Tool-result wiring (9.16.0)

`toolCalls` maintains TWO scope keys as each result lands (collect during
traversal — a pause mid-batch commits the partial batch, resume paths append):

- `lastToolResult` — the last result; unchanged contract, kept for every
  existing reader (context-bisect's proximate-tool key among them);
- `toolResults` — EVERY result of the iteration's batch, in call order with
  `toolCallId`, reset at dispatch start. This is what `on-tool-return`
  triggers and skill-graph routes read (via the injection-engine mappers), so
  a parallel batch routes on all its calls, not only the last.

Any NEW dispatch path must write both (and apply `capResults` — see the note
on the five `tool_end`-emitting paths in toolCalls.ts).
