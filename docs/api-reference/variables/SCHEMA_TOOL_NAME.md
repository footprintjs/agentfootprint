[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SCHEMA\_TOOL\_NAME

# Variable: SCHEMA\_TOOL\_NAME

> `const` **SCHEMA\_TOOL\_NAME**: `"respond_with_schema"` = `'respond_with_schema'`

Defined in: [src/core/agent/outputEnforcement.ts:186](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/core/agent/outputEnforcement.ts#L186)

Name of the tool the schema is presented as.

It is the STRATEGY's mechanism, never the agent's surface: it is built at
request-assembly time, so it cannot reach `.tools()`, the tools slot, the
`tools.offered` event, an MCP server's served list, or the dispatcher that
runs tools and files middleware rows. The only places it exists are the
wire and the `llm_start` event — and it belongs in that event, whose whole
claim is that it reports what the model actually saw.
