[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolDispatchCallOptions

# Interface: ToolDispatchCallOptions

Defined in: [src/core/tools.ts:633](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L633)

Options for one [ToolDispatch.call](/agentfootprint/api/generated/interfaces/ToolDispatch.md#call).

## Properties

### allowAbsent?

> `readonly` `optional` **allowAbsent?**: `boolean`

Defined in: [src/core/tools.ts:647](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L647)

Declare an inner ABSENCE survivable (9.76.0). By default a dispatch
consumer that composes answers (runbookAsTool) propagates an inner
`absent()` as its own answer — "the inventory found nothing" IS the
runbook's result, and pretending to a verdict over it would be the
confident-partial-answer failure. Pass `true` when the caller can carry
on without this source and will state the gap itself (usually as a
coverage entry). The raw dispatch delivered on `ctx.tools` returns every
result untouched either way — the propagation policy belongs to the
consumer that wraps it.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/tools.ts:635](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/tools.ts#L635)

Abort signal for the inner call. Defaults to the outer call's own.
