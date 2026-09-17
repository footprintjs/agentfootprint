---
title: CodeSession
---

# Interface: CodeSession

Defined in: [src/adapters/types.ts:1056](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1056)

One live session. `stop()` is idempotent and tolerates "already gone".

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:1058](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1058)

The backend's own id for this session, when it has one.

## Methods

### execute()

> **execute**(`req`): `Promise`\<[`CodeResult`](/docs/api/interfaces/CodeResult)\>

Defined in: [src/adapters/types.ts:1059](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1059)

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

### stageInputs()?

> `optional` **stageInputs**(`inputs`): `Promise`\<readonly [`StagedCodeInput`](/docs/api/interfaces/StagedCodeInput)[]\>

Defined in: [src/adapters/types.ts:1093](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1093)

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

Defined in: [src/adapters/types.ts:1101](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L1101)

Release the session.

Must tolerate a session the far side already reaped — an idle timeout is
the reality on every managed backend, and a `Stop` on a dead session is a
no-op, not an error.

#### Returns

`Promise`\<`void`\>
