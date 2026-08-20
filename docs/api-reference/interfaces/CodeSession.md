[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeSession

# Interface: CodeSession

Defined in: [src/adapters/types.ts:953](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L953)

One live session. `stop()` is idempotent and tolerates "already gone".

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:955](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L955)

The backend's own id for this session, when it has one.

## Methods

### execute()

> **execute**(`req`): `Promise`\<[`CodeResult`](/agentfootprint/api/generated/interfaces/CodeResult.md)\>

Defined in: [src/adapters/types.ts:956](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L956)

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

`Promise`\<[`CodeResult`](/agentfootprint/api/generated/interfaces/CodeResult.md)\>

***

### stageInputs()?

> `optional` **stageInputs**(`inputs`): `Promise`\<readonly [`StagedCodeInput`](/agentfootprint/api/generated/interfaces/StagedCodeInput.md)[]\>

Defined in: [src/adapters/types.ts:990](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L990)

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
    the returned [StagedCodeInput.path](/agentfootprint/api/generated/interfaces/StagedCodeInput.md#path) is what the code opens.
 2. Every later `execute` on this session exposes the manifest as the
    [STAGED\_INPUTS\_ENV](/agentfootprint/api/generated/variables/STAGED_INPUTS_ENV.md) environment variable — a JSON object of
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

readonly [`CodeInput`](/agentfootprint/api/generated/interfaces/CodeInput.md)[]

#### Returns

`Promise`\<readonly [`StagedCodeInput`](/agentfootprint/api/generated/interfaces/StagedCodeInput.md)[]\>

***

### stop()

> **stop**(): `Promise`\<`void`\>

Defined in: [src/adapters/types.ts:998](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/adapters/types.ts#L998)

Release the session.

Must tolerate a session the far side already reaped — an idle timeout is
the reality on every managed backend, and a `Stop` on a dead session is a
no-op, not an error.

#### Returns

`Promise`\<`void`\>
