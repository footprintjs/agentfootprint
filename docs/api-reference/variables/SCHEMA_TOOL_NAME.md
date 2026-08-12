[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SCHEMA\_TOOL\_NAME

# Variable: SCHEMA\_TOOL\_NAME

> `const` **SCHEMA\_TOOL\_NAME**: `"respond_with_schema"` = `'respond_with_schema'`

Defined in: [src/core/agent/outputEnforcement.ts:197](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/outputEnforcement.ts#L197)

Name of the tool the schema is presented as.

It is the STRATEGY's mechanism, never the agent's surface: it is built at
request-assembly time, so it cannot reach `.tools()`, the tools slot, the
`tools.offered` event, an MCP server's served list, or the dispatcher that
runs tools and files middleware rows. The only places it exists are the
wire and the `llm_start` event — and it belongs in that event, whose whole
claim is that it reports what the model actually saw.
