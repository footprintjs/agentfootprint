[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / NamesAndNumbersOptions

# Interface: NamesAndNumbersOptions

Defined in: [src/core/agent/evidence/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/evidence/types.ts#L53)

Options for `.namesAndNumbersFromEvidence()`.

## Properties

### exempt?

> `readonly` `optional` **exempt?**: readonly (`string` \| `RegExp`)[]

Defined in: [src/core/agent/evidence/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/evidence/types.ts#L67)

Values (or patterns) that are never flagged, whatever the extractor
thinks. A literal string is compared after normalisation; a RegExp is
matched against a whole token.

Values the USER supplied are already exempt without declaring anything —
this is for the rest: a build number your prompt does not carry, a
constant your app knows is safe.

***

### minDigits?

> `readonly` `optional` **minDigits?**: `number`

Defined in: [src/core/agent/evidence/types.ts:78](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/evidence/types.ts#L78)

How many digits a BARE number needs before it is treated as data rather
than prose. Default `4`.

`3 issues`, `24 hours`, `47 flaps` and `892 CRC errors` are ordinary
English and must never trip the gate; `41,200` is a reading off a screen.
Four digits is where that line sits in the material we measured. Lower it
only if your domain's numbers are genuinely small and you accept the false
positives that follow.

***

### posture?

> `readonly` `optional` **posture?**: [`EvidencePosture`](/agentfootprint/api/generated/type-aliases/EvidencePosture.md)

Defined in: [src/core/agent/evidence/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/evidence/types.ts#L55)

Default `'assist'` — record and flag, change nothing.

***

### shapes?

> `readonly` `optional` **shapes?**: readonly [`EvidenceShape`](/agentfootprint/api/generated/interfaces/EvidenceShape.md)[]

Defined in: [src/core/agent/evidence/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/evidence/types.ts#L57)

Extra identifier shapes for this domain. Composes with the defaults.
