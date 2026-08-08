[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolResultOutcome

# Type Alias: ToolResultOutcome

> **ToolResultOutcome** = [`AllowOutcome`](/agentfootprint/api/generated/interfaces/AllowOutcome.md)\<`unknown`\> \| [`DenyOutcome`](/agentfootprint/api/generated/interfaces/DenyOutcome.md)

Defined in: [src/core/agent/middleware/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L149)

Everything a tool middleware may answer at the after-tool moment. Two arms,
and no `ask` — the tool has already run, so there is nothing left for a
person to prevent (see the header).

`allow()` lets the real result through. `allow(value, why)` replaces what
the MODEL reads while the run commits both versions. `deny(reason)` sends
the reason to the model instead of the result — and the run still records
the result, because the side effect happened and a record that hid it would
be a record that lies.

A tool result can be any value, so the transform arm is `unknown`. One
sharp edge follows from `allow`'s own rule: `allow(undefined, why)` is a
pass-through carrying a reason, not a replacement — there is no spelling of
"replace the result with `undefined`". To keep a result away from the model
use `deny(reason)`, which says so in the record.
