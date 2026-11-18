**Walker** — existing tool start/end brackets and progress events.

# Tool-call observation

The factories use the existing event and tool-call ledger ports. Progress warning state remains handler-local; no additional recorder or process-wide state is created.

`observationsOperations.ts` · `emitToolEnd` is the one door every `stream.tool_end` of the Agent's tool-call stages passes. It writes `entered` from the dispatch's `ran` flag through `semantics/toolRan.ts` · `withEntered`. A tool that was entered carries `true` whether it returned or threw. An unknown tool name, rejected arguments, a blocked credential or a declined resume carries `false`. A bracket with `notExecuted` or `notDispatched` already records why the call never reached its tool. The ledger and the negative-claims row read the same bracket. The demo chart `core/agent/buildAgentMessageApiChart.ts` · `toolExec` emits unstamped brackets and calls no tool function.
