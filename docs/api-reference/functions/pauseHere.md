[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / pauseHere

# Function: pauseHere()

> **pauseHere**(`data`): `never`

Defined in: [src/core/pause.ts:273](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/pause.ts#L273)

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
