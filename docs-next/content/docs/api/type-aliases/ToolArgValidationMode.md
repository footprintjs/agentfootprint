---
title: ToolArgValidationMode
---

# Type Alias: ToolArgValidationMode

> **ToolArgValidationMode** = `"enforce"` \| `"warn"` \| `"off"`

Defined in: [src/core/agent/toolArgsValidation.ts:37](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/agent/toolArgsValidation.ts#L37)

When to enforce: 'enforce' rejects before dispatch (default), 'warn'
 emits the event but executes anyway, 'off' skips validation entirely.
