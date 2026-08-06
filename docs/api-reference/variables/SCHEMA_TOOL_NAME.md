[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SCHEMA\_TOOL\_NAME

# Variable: SCHEMA\_TOOL\_NAME

> `const` **SCHEMA\_TOOL\_NAME**: `"respond_with_schema"` = `'respond_with_schema'`

Defined in: [src/core/agent/outputEnforcement.ts:186](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/core/agent/outputEnforcement.ts#L186)

Name of the tool the schema is presented as.

It is the STRATEGY's mechanism, never the agent's surface: it is built at
request-assembly time, so it cannot reach `.tools()`, the tools slot, the
`tools.offered` event, an MCP server's served list, or the dispatcher that
runs tools and files middleware rows. The only places it exists are the
wire and the `llm_start` event — and it belongs in that event, whose whole
claim is that it reports what the model actually saw.
