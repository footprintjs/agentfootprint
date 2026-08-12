[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / canResume

# Function: canResume()

> **canResume**(`error`): `boolean`

Defined in: [src/core/runCheckpoint.ts:342](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/core/runCheckpoint.ts#L342)

Can `agent.resumeOnError(checkpoint)` plausibly succeed for this failure?

`true` for the transient classes resume exists for; `false` for the ones
where replaying the same request reproduces the same refusal (a request too
large for the context window, rejected credentials, a malformed request).
Branch on this instead of reading the message — a retry loop that resumes a
non-resumable failure is an expensive infinite loop.

## Parameters

### error

`unknown`

## Returns

`boolean`

## Example

```ts
import { canResume, RunCheckpointError } from 'agentfootprint';

try {
  await agent.run({ message });
} catch (err) {
  if (err instanceof RunCheckpointError && canResume(err.cause)) {
    await agent.resumeOnError(err.checkpoint);
  } else {
    throw err; // fix the request; the checkpoint is evidence, not a retry handle
  }
}
```
