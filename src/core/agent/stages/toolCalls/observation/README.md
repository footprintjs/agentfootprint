**Walker** — existing tool start/end brackets and progress events.

# Tool-call observation

The factories use the existing event and tool-call ledger ports. Progress warning state remains handler-local; no additional recorder or process-wide state is created.

`observationsOperations.ts` · `emitToolEnd` is the one door every `stream.tool_end` passes. It writes `entered` there, from the `ran` flag each dispatch path hands it (`semantics/toolRan.ts` · `withEntered`): `false` on a call whose tool was never entered (an unknown tool name, rejected arguments, a blocked credential, a declined resume), `true` beside the `error` of a tool that ran. A success, and a bracket that carries `notExecuted` or `notDispatched`, keeps its bytes. The ledger and the negative-claims row read the stamped bracket, so they cannot disagree with the record. Example: an unknown name arrives as `{ error: true }` with `ran: false` and is emitted as `{ error: true, entered: false }`.
