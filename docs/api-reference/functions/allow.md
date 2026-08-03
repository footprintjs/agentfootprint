[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / allow

# Function: allow()

## Call Signature

> **allow**(): [`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`never`\>

Defined in: src/core/agent/middleware/outcomes.ts:21

Pass the value through untouched.

### Returns

[`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`never`\>

## Call Signature

> **allow**\<`T`\>(`value`, `why`): [`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`T`\>

Defined in: src/core/agent/middleware/outcomes.ts:29

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

[`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`T`\>
