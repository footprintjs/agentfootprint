---
title: CodeSession
---

# Interface: CodeSession

Defined in: [src/provider-contract/types.ts:1178](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1178)

One live session. `stop()` is idempotent and tolerates "already gone".

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/provider-contract/types.ts:1180](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1180)

The backend's own id for this session, when it has one.

## Methods

### execute()

> **execute**(`req`): `Promise`\<[`CodeResult`](/docs/api/interfaces/CodeResult)\>

Defined in: [src/provider-contract/types.ts:1181](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1181)

#### Parameters

##### req

###### code

`string`

###### language?

`string`

###### signal?

`AbortSignal`

###### timeoutMs?

`number`

#### Returns

`Promise`\<[`CodeResult`](/docs/api/interfaces/CodeResult)\>

***

### readFile()?

> `optional` **readFile**(`path`, `options`): `Promise`\<[`CodeFile`](/docs/api/interfaces/CodeFile)\>

Defined in: [src/provider-contract/types.ts:1236](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1236)

OPTIONAL — read ONE file back out of the session, whole or not at all.

`path` is relative to the session's working directory and may not leave
it. An absolute path, a `..` that climbs above the working directory, a
backslash, a leading `~` or a NUL is refused by name before anything is
sent (`CodeSandboxError`, reason `'path-refused'`) — one rule,
`sandboxPath`, shared by every adapter.

The answer is the file the BACKEND returned for that path, paired to it
by what the backend said it returned. A file the adapter cannot pair with
the path it asked for is refused, never guessed at — a backend that
answers with another file, or with two, has not answered this read.

`maxBytes` is required: a read names its bound. A file over it is refused
(reason `'file-too-large'`), never cut — a truncated file handed back as
the file is the silent success this port refuses everywhere else.

Feature-detect with `canReadCodeFiles(session)`.

#### Parameters

##### path

`string`

##### options

[`CodeReadOptions`](/docs/api/interfaces/CodeReadOptions)

#### Returns

`Promise`\<[`CodeFile`](/docs/api/interfaces/CodeFile)\>

***

### runCommand()?

> `optional` **runCommand**(`command`, `options?`): `Promise`\<[`CodeCommandResult`](/docs/api/interfaces/CodeCommandResult)\>

Defined in: [src/provider-contract/types.ts:1251](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1251)

OPTIONAL — run ONE shell command in the session.

It runs arbitrary shell, so an adapter offers it only when the runner was
built with `commands: true`; otherwise the member is ABSENT. Feature-detect
with `canRunCodeCommands(session)`. The command runs in the session's
working directory with the environment `execute` gets, staged-input
manifest included.

The result says only what the backend reported. The exit status comes
from the backend or not at all: when it reported none, `exitCode` is
absent — unknown, never inferred from an error flag and never defaulted.
stdout and stderr are bounded, and a cut is stated on `truncated`.

#### Parameters

##### command

`string`

##### options?

[`CodeCommandOptions`](/docs/api/interfaces/CodeCommandOptions)

#### Returns

`Promise`\<[`CodeCommandResult`](/docs/api/interfaces/CodeCommandResult)\>

***

### stageInputs()?

> `optional` **stageInputs**(`inputs`): `Promise`\<readonly [`StagedCodeInput`](/docs/api/interfaces/StagedCodeInput)[]\>

Defined in: [src/provider-contract/types.ts:1215](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1215)

OPTIONAL (9.26.0) — put payloads INTO the session, so code can read data
that never travelled through the context window.

── Why it is a new member rather than an argument to `execute` ──────────
The port's only input was the code STRING, and 9.22.0 stated the honest
consequence rather than working around it: pushing a resolved artifact
through that door would mean inlining megabytes into an argv, in
language-specific quoting, past operating-system argument limits. This is
the session file-write verb that note said it was waiting for.

── The contract, which is two promises not one ─────────────────────────
 1. The payloads are written where the session's code can read them, and
    the returned [StagedCodeInput.path](/docs/api/interfaces/StagedCodeInput#path) is what the code opens.
 2. Every later `execute` on this session exposes the manifest as the
    [STAGED\_INPUTS\_ENV](/docs/api/variables/STAGED_INPUTS_ENV) environment variable — a JSON object of
    `name → path`. That second promise is what makes the model's code
    portable: it reads one variable, on every backend that stages.

Staged inputs live as long as the SESSION and are released by `stop()`.

── Absent, never faked ─────────────────────────────────────────────────
A backend that cannot write into its own session LEAVES THIS ABSENT.
Feature-detect with `canStageCodeInputs(session)`; `codeRunnerTool`
refuses by name when a tool declares artifact inputs and the runner cannot
carry them, because running the code without the data it declared would be
the accepted-and-silently-wrong failure.

#### Parameters

##### inputs

readonly [`CodeInput`](/docs/api/interfaces/CodeInput)[]

#### Returns

`Promise`\<readonly [`StagedCodeInput`](/docs/api/interfaces/StagedCodeInput)[]\>

***

### stop()

> **stop**(): `Promise`\<`void`\>

Defined in: [src/provider-contract/types.ts:1259](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1259)

Release the session.

Must tolerate a session the far side already reaped — an idle timeout is
the reality on every managed backend, and a `Stop` on a dead session is a
no-op, not an error.

#### Returns

`Promise`\<`void`\>
