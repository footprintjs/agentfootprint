[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeRunnerToolOptions

# Interface: CodeRunnerToolOptions

Defined in: [src/core/codeRunnerTool.ts:68](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L68)

## Properties

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/agentfootprint/api/generated/type-aliases/CheckInDemand.md)\<\{ `code`: `string`; \}\>

Defined in: [src/core/codeRunnerTool.ts:98](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L98)

Demand a human check-in before code runs — `'always'`, or a predicate over
 the code string. A pause here does NOT tear the session down.

***

### description?

> `readonly` `optional` **description?**: `string`

Defined in: [src/core/codeRunnerTool.ts:76](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L76)

Description the model sees. A sensible one is composed from `scope` +
 `language` when you do not pass one.

***

### language?

> `readonly` `optional` **language?**: `string`

Defined in: [src/core/codeRunnerTool.ts:90](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L90)

Default language for the code the model writes. Default `'python'`.

***

### maxOutputChars?

> `readonly` `optional` **maxOutputChars?**: `number`

Defined in: [src/core/codeRunnerTool.ts:93](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L93)

Per-stream ceiling for what reaches the model, in characters. Default 4000.
 Anything cut is STATED in the result, never dropped quietly.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core/codeRunnerTool.ts:73](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L73)

Tool name the model sees. Default `'run_code'`.

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/codeRunnerTool.ts:101](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L101)

A credential this tool needs (declare-and-push). Resolved before execute.
 Do NOT cache it past the call: a session outliving a run outlives its token.

***

### runner

> `readonly` **runner**: [`CodeRunner`](/agentfootprint/api/generated/interfaces/CodeRunner.md)

Defined in: [src/core/codeRunnerTool.ts:71](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L71)

The backend. `localCodeRunner()` for a dev loop, `agentCoreCodeRunner(...)`
 for a real sandbox — the tool is identical across the swap.

***

### scope?

> `readonly` `optional` **scope?**: [`CodeRunnerToolScope`](/agentfootprint/api/generated/type-aliases/CodeRunnerToolScope.md)

Defined in: [src/core/codeRunnerTool.ts:88](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L88)

How long one session lives. Default `'run'` — a turn's worth of work shares
one interpreter, and nothing outlives the turn.

`'session'` keeps the interpreter across the turns of one hosted
conversation (variables persist, files persist) and REQUIRES a
session-bound run plus a composition root that calls
`agent.closeToolSessions({ sessionId })`.

`'call'` starts and stops per invocation — the safest and the slowest.

***

### timeoutMs?

> `readonly` `optional` **timeoutMs?**: `number`

Defined in: [src/core/codeRunnerTool.ts:95](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L95)

Per-execution ceiling handed to the runner.

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/codeRunnerTool.ts:131](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/codeRunnerTool.ts#L131)

Artifact arguments, declared exactly as any other tool declares them
(9.26.0): `wants: { dataset: 'dataset/rows' }`.

The model passes the `art_…` ref as the argument, the framework resolves
it before `execute` under the run's own scope — the same `wants` machinery,
with the same teaching refusals for a stale, unknown or wrong-kind ref —
and then this tool STAGES the resolved payload into the code session as a
file. The data reaches the interpreter without ever entering the context
window, which is the whole doctrine this tool exists for, now with an
inbound leg to match the outbound one.

── What the model's code reads ─────────────────────────────────────────
The staged files are named in the `AF_STAGED_INPUTS` environment variable,
a JSON object of `argument name → path`. The composed tool description
states it with a one-line example in the tool's language, so a model needs
nothing beyond the description to use it.

── Refused rather than degraded ────────────────────────────────────────
Declaring `wants` on a runner whose sessions cannot accept staged inputs
(`stageInputs` absent — `agentCoreCodeRunner` today) refuses BY NAME at
dispatch. Running the code without the data it declared would leave the
model reasoning about a file that is not there, which is the exact silent
failure this library refuses to ship.

Omitted, nothing changes: no schema properties are added, no session is
ever asked to stage, and the description is the one earlier releases
composed.
