[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolArgValidationMode

# Type Alias: ToolArgValidationMode

> **ToolArgValidationMode** = `"enforce"` \| `"warn"` \| `"off"`

Defined in: [src/core/agent/toolArgsValidation.ts:37](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/agent/toolArgsValidation.ts#L37)

When to enforce: 'enforce' rejects before dispatch (default), 'warn'
 emits the event but executes anyway, 'off' skips validation entirely.
