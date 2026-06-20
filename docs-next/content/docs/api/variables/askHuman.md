---
title: askHuman
---

# Variable: askHuman

> `const` **askHuman**: (`data`) => `never` = `pauseHere`

Defined in: [src/core/pause.ts:100](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/pause.ts#L100)

Ergonomic alias for `pauseHere(data)` — the human-in-the-loop name.

`pauseHere` describes the mechanism (control-flow throw); `askHuman`
describes the intent (ask a person to decide). Both work identically.

Called from inside a tool's `execute()` to request a pause. Throws a
`PauseRequest` that the Agent catches and forwards to the flowchart.

## Parameters

### data

`unknown`

## Returns

`never`

## Example

```ts
const approveTool: Tool<{ action: string }, string> = {
    schema: { name: 'approve', description: 'Ask human', inputSchema: {...} },
    execute: async (args) => {
      pauseHere({ question: `Approve ${args.action}?`, risk: 'high' });
      return ''; // unreachable — pauseHere always throws
    },
  };
```

## Example

```ts
const approveRefund: Tool<{ amount: number }, string> = {
    schema: { name: 'approve_refund', description: '...', inputSchema: {...} },
    execute: async ({ amount }) => {
      if (amount > 1000) askHuman({ question: `Approve $${amount}?` });
      return 'auto-approved';
    },
  };
```
