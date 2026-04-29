[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / askHuman

# Variable: askHuman

> `const` **askHuman**: (`data`) => `never` = `pauseHere`

Defined in: [agentfootprint/src/core/pause.ts:100](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/pause.ts#L100)

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
