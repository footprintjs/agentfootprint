[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeResult

# Interface: CodeResult

Defined in: [src/adapters/types.ts:1010](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L1010)

What one execution produced.

## Properties

### artifacts?

> `readonly` `optional` **artifacts?**: readonly `object`[]

Defined in: [src/adapters/types.ts:1045](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L1045)

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

Defined in: [src/adapters/types.ts:1015](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L1015)

***

### ok

> `readonly` **ok**: `boolean`

Defined in: [src/adapters/types.ts:1012](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L1012)

Did the code run to completion without an error exit?

***

### stderr

> `readonly` **stderr**: `string`

Defined in: [src/adapters/types.ts:1014](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L1014)

***

### stdout

> `readonly` **stdout**: `string`

Defined in: [src/adapters/types.ts:1013](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L1013)

***

### truncated?

> `readonly` `optional` **truncated?**: `object`

Defined in: [src/adapters/types.ts:1062](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L1062)

Present IFF output was cut, and then it says by how much.

Load-bearing, not politeness. A runner exists so big data is computed
outside the context window instead of pasted into it; a runner that
quietly slices its own output to fit is the same bug wearing a different
hat, and the model would go on to reason over a truncated table it was
never told was truncated. An unstated slice is a silent success.

#### ofChars?

> `readonly` `optional` **ofChars?**: `number`

The pre-truncation length, in characters, of whichever stream was cut.

#### stderr?

> `readonly` `optional` **stderr?**: `boolean`

#### stdout?

> `readonly` `optional` **stdout?**: `boolean`
