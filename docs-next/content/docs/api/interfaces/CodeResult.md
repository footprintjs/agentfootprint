---
title: CodeResult
---

# Interface: CodeResult

Defined in: [src/provider-contract/types.ts:1390](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1390)

What one execution produced.

## Properties

### artifacts?

> `readonly` `optional` **artifacts?**: readonly `object`[]

Defined in: [src/provider-contract/types.ts:1441](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1441)

Files the run produced, described rather than inlined — the whole point is
 that big data does not enter the window. All fields beyond the original
 `{ name, bytes, uri? }` are ADDITIVE (9.22.0) and honest about absence:
 a runner that only knows the file exists states exactly what it always
 did.

 **ABSENT and `[]` are different facts, and only one of them is about the
 code.** `[]` says this execution produced no files. ABSENT says this
 RUNNER does not report produced files at all — it has no declared output
 location to collect from, so "the code produced nothing" is a claim it is
 not in a position to make. `localCodeRunner` is in the second camp today
 (see its module header): it runs the code in a child process whose cwd is
 the caller's own working directory, and treating every file that appeared
 there as an output would be a guess about which files mattered, made on
 the machine least able to afford it. A runner that WANTS to produce
 output artifacts owes three things: a declared output location the code
 is told about, a bounded read-back of what landed there, and a `bytes`
 that is the payload's real length — then `codeRunnerTool` mints every
 data-carrying entry with no further wiring.

 `data` is the in-band payload, present ONLY when the adapter can hand
 the bytes back (a local runner reading its own working directory, a
 managed sandbox that returns file contents). When a store is attached,
 `codeRunnerTool` mints every data-carrying entry into the artifact
 store and the model's result names the ref — entries without `data`
 stay described-only, because minting needs bytes and inventing them is
 worse than stating the gap. `mediaType` is the adapter's own statement
 when it knows one; `ref` is stamped by whoever minted the file into an
 artifact store (today: `codeRunnerTool`'s mint-on-output).

***

### exitCode?

> `readonly` `optional` **exitCode?**: `number`

Defined in: [src/provider-contract/types.ts:1408](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1408)

The exit status — exactly when the runner reported one. Never inferred
 from an error flag, never defaulted.

***

### ok?

> `readonly` `optional` **ok?**: `boolean`

Defined in: [src/provider-contract/types.ts:1403](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1403)

Did the code run to completion without an error exit? WHAT THE RUNNER
REPORTED, nothing more.

`true` or `false` only when the backend said so: an exit status, or its
own error verdict. ABSENT when it reported neither — the outcome is
unknown, and an absent `ok` is never success. (Before this was optional,
`agentCoreCodeRunner` filled `true` from silence.) `false` covers two
different facts, told apart by the next two fields: a program that exited
non-zero (`exitCode`), and a backend error with no exit status
(`reason: 'service-error'`), where the run is unconfirmed.

***

### reason?

> `readonly` `optional` **reason?**: `"service-error"`

Defined in: [src/provider-contract/types.ts:1411](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1411)

Present when the outcome is not an exit status — see [CodeRunReason](/docs/api/type-aliases/CodeRunReason).
 With `'service-error'`, `ok` is `false` and `exitCode` is absent.

***

### stderr

> `readonly` **stderr**: `string`

Defined in: [src/provider-contract/types.ts:1405](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1405)

***

### stdout

> `readonly` **stdout**: `string`

Defined in: [src/provider-contract/types.ts:1404](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1404)

***

### truncated?

> `readonly` `optional` **truncated?**: [`CodeTruncation`](/docs/api/interfaces/CodeTruncation)

Defined in: [src/provider-contract/types.ts:1451](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L1451)

Present IFF output was cut — see [CodeTruncation](/docs/api/interfaces/CodeTruncation). An unstated
 slice is a silent success.
