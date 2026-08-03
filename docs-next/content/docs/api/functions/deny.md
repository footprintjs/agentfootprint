---
title: deny
---

# Function: deny()

> **deny**(`reason`): [`DenyOutcome`](/docs/api/interfaces/DenyOutcome)

Defined in: src/core/agent/middleware/outcomes.ts:49

Refuse the call.

For a tool the reason reaches the model verbatim, as the tool's result,
and the loop continues — the agent gets to adapt. For a message it
surfaces as a `MessageDeniedError`.

## Parameters

### reason

`string`

## Returns

[`DenyOutcome`](/docs/api/interfaces/DenyOutcome)
