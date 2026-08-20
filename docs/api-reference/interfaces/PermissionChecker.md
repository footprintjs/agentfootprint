[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PermissionChecker

# Interface: PermissionChecker

Defined in: [src/adapters/types.ts:792](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L792)

## Properties

### governs?

> `readonly` `optional` **governs?**: readonly [`PermissionCapability`](/agentfootprint/api/generated/type-aliases/PermissionCapability.md)[]

Defined in: [src/adapters/types.ts:825](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L825)

Which capabilities BEYOND `'tool_call'` this checker asks to be consulted
about (9.11.0). Optional and feature-detected — **absence is NO**.

`'tool_call'` is always asked and needs no declaration. Everything else is
asked only when it appears here AND the other side declares it too:

- a [ToolCapability](/agentfootprint/api/generated/type-aliases/ToolCapability.md) — asked once per declared capability, per
  dispatch of a tool whose `Tool.capabilities` names it, right after
  the `'tool_call'` check allows.
- `'skill_read'` — asked once per skill when the `read_skill` menu is
  composed (a refused skill's row disappears from what the model is
  offered) and again when the model activates one (a refused activation
  lands as the policy's own message, which the model reads and adapts to).

The reason this exists rather than "just send everything": a checker
written before these values were sent is fail-closed by design, and would
deny a capability it has no rule for. Silence keeps such a checker doing
exactly what it does today. Declare it and the framework starts asking.

#### Example

```ts
a checker that also governs which skills a role may activate
  const checker: PermissionChecker = {
    name: 'my-policy',
    governs: ['skill_read'],
    check: (req) =>
      req.capability === 'skill_read' && req.target === 'skill:payroll'
        ? { result: 'deny', rationale: 'payroll is HR-only' }
        : { result: 'allow' },
  };
```

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:793](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L793)

## Methods

### check()

> **check**(`request`): [`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md) \| `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>

Defined in: [src/adapters/types.ts:794](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L794)

#### Parameters

##### request

[`PermissionRequest`](/agentfootprint/api/generated/interfaces/PermissionRequest.md)

#### Returns

[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md) \| `Promise`\<[`PermissionDecision`](/agentfootprint/api/generated/interfaces/PermissionDecision.md)\>
