---
title: allow
---

# Function: allow()

## Call Signature

> **allow**(): [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

Defined in: [src/core/agent/middleware/outcomes.ts:21](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L21)

Pass the value through untouched.

### Returns

[`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`never`\>

## Call Signature

> **allow**\<`T`\>(`value`, `why`): [`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`T`\>

Defined in: [src/core/agent/middleware/outcomes.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/outcomes.ts#L29)

Replace the value and say why.

The `why` is mandatory and lands in the ledger next to the before/after
pair, so a run that was scrubbed can be read back as a run that was
scrubbed rather than as a run whose input was always that way.

### Type Parameters

#### T

`T`

### Parameters

#### value

`T`

#### why

`string`

### Returns

[`AllowOutcome`](/docs/api/interfaces/AllowOutcome)\<`T`\>
