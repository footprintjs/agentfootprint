[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / toolSessionKey

# Function: toolSessionKey()

> **toolSessionKey**(`ctx`, `scope`): `string` \| `undefined`

Defined in: [src/core/toolSessions.ts:189](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/toolSessions.ts#L189)

Derive the isolation key a tool should hold a session under.

ONE implementation, exported, because the derivation is the security
boundary. Returns `undefined` when the facts the scope needs are absent —
which is a refusal to guess, not a failure: the caller decides whether to
narrow the scope loudly or refuse the call.

```
session →  t=<tenant|_>/p=<principal|_>/s=<sessionId>     requires sessionId
run     →  t=<tenant|_>/p=<principal|_>/r=<runId>         requires runId
call    →  c=<toolCallId>                                 always available
```

**`sessionId` alone must never key a live session.** The hosting port says
why in its own words: a `sessionId` "is not identity and must never be
trusted as identity on its own: anyone who can reach the host can put any
string here, including someone else's." A code interpreter keyed on
`sessionId` alone hands a live sandbox — files, environment, half-run state —
to anyone who guesses one. Tenant and principal are in the key whenever they
exist; a deployment that has no principal is thereby STATING it is
single-principal rather than quietly assuming it.

`'shutdown'` is not a key scope: it is when everything goes, not a thing to
hold one session under. Ask for it and you get `undefined`.

## Parameters

### ctx

`Pick`\<[`ToolExecutionContext`](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md), `"toolCallId"` \| `"runId"` \| `"sessionId"` \| `"identity"`\>

### scope

[`TeardownScope`](/agentfootprint/api/generated/type-aliases/TeardownScope.md)

## Returns

`string` \| `undefined`

## Example

```ts
const key = toolSessionKey(ctx, 'run');
  if (!key) throw new Error("run_code: scope 'run' needs a run …");
```
