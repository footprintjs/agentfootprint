[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / allow

# Function: allow()

## Call Signature

> **allow**(): [`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`never`\>

Defined in: [src/core/agent/middleware/outcomes.ts:21](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/agent/middleware/outcomes.ts#L21)

Pass the value through untouched.

### Returns

[`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`never`\>

## Call Signature

> **allow**(`value`, `why`): [`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`never`\>

Defined in: [src/core/agent/middleware/outcomes.ts:30](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/agent/middleware/outcomes.ts#L30)

Pass the value through untouched, and say why you were comfortable.

The row still reads `changed: false` — nothing moved — but it carries the
reason, which is what a rule that remembers an earlier decision needs:
"approved by dana@ops at 14:02" belongs in the record of the call it
silently permitted, not only in the record of the call that asked.

### Parameters

#### value

`undefined`

#### why

`string`

### Returns

[`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`never`\>

## Call Signature

> **allow**\<`T`\>(`value`, `why`): [`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`T`\>

Defined in: [src/core/agent/middleware/outcomes.ts:38](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/agent/middleware/outcomes.ts#L38)

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
