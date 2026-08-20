[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TOOL\_SESSIONS

# Variable: TOOL\_SESSIONS

> `const` **TOOL\_SESSIONS**: unique `symbol`

Defined in: [src/core/codeRunnerTool.ts:148](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/codeRunnerTool.ts#L148)

The per-tool session map, riding the `Tool` under a REGISTRY symbol.

`Symbol.for`, not a unique symbol: this package ships CJS and ESM, and a tool
built through one entry point must be readable through the other. The same
move `INNER_RUN_RECORDS` makes for `flowchartAsTool({ keepRecord })` — and
deliberately a DIFFERENT symbol, so one tool can carry both (spreading a tool
preserves symbol keys, which is why `{...tool, [SYM]: store}` composes).

Invisible to the LLM, invisible to `Tool`'s shape, reachable by a test and by
whatever inspector comes next.
