---
title: elicitationOf
---

# Function: elicitationOf()

> **elicitationOf**(`awaiting`): [`ElicitationRequest`](/docs/api/interfaces/ElicitationRequest)

Defined in: src/lib/mcp/elicitation.ts:133

The MCP elicitation for a pending typed ask: its question (after the
refusal's reason, on a re-ask) and one property per way to answer each open
field. Throws `InputRequestError` on a field MCP cannot carry.

## Parameters

### awaiting

[`AwaitingInput`](/docs/api/interfaces/AwaitingInput)

## Returns

[`ElicitationRequest`](/docs/api/interfaces/ElicitationRequest)
