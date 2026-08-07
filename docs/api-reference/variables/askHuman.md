[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / askHuman

# Variable: askHuman

> `const` **askHuman**: (`data`) => `never` = `pauseHere`

Defined in: [src/core/pause.ts:302](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/pause.ts#L302)

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
