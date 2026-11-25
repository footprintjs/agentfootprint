---
title: CodeCommandOptions
---

# Interface: CodeCommandOptions

Defined in: [src/provider-contract/types/code.ts:318](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L318)

How one [CodeSession.runCommand](/docs/api/interfaces/CodeSession#runcommand) is bounded.

## Properties

### checkpoint?

> `readonly` `optional` **checkpoint?**: `string`

Defined in: [src/provider-contract/types/code.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L341)

A line the command prints when it reaches a point you care about — for
example `make && echo STEP_DONE` with `checkpoint: 'STEP_DONE'`. The
result then says, on `checkpointSeen`, whether stdout held that exact line,
read BEFORE any cut, so a marker printed past `maxOutputChars` is still
found.

It proves the command reached that line and nothing more: not that it
exited cleanly, and not that anything after it ran. Its absence proves
nothing about why. One line, no line breaks.

***

### maxOutputChars?

> `readonly` `optional` **maxOutputChars?**: `number`

Defined in: [src/provider-contract/types/code.ts:329](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L329)

Per-stream ceiling for this command's output, in characters. The
 runner's own `maxOutputChars` when absent. A cut is stated on `truncated`.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/provider-contract/types/code.ts:326](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L326)

Stop waiting when this fires.

***

### timeoutMs?

> `readonly` `optional` **timeoutMs?**: `number`

Defined in: [src/provider-contract/types/code.ts:324](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/code.ts#L324)

Stop waiting after this many milliseconds. What happens to the command
depends on the backend, and the error says which: a local child process is
killed; a managed sandbox may keep running it.
