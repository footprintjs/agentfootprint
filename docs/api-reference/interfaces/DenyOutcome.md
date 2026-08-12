[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DenyOutcome

# Interface: DenyOutcome

Defined in: [src/core/agent/middleware/types.ts:99](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/middleware/types.ts#L99)

Refuse the call. For a tool, `reason` reaches the model verbatim as the
tool result and the run continues — a denial is data the agent can adapt
to, not a crash. For a message, `reason` surfaces as a
`MessageDeniedError` at the API boundary.

## Properties

### kind

> `readonly` **kind**: `"deny"`

Defined in: [src/core/agent/middleware/types.ts:100](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/middleware/types.ts#L100)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/middleware/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/middleware/types.ts#L101)
