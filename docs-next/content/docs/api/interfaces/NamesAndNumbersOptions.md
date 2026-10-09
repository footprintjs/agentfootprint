---
title: NamesAndNumbersOptions
---

# Interface: NamesAndNumbersOptions

Defined in: [src/core/agent/evidence/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L87)

Options for `.namesAndNumbersFromEvidence()`.

## Properties

### exempt?

> `readonly` `optional` **exempt?**: readonly (`string` \| `RegExp`)[]

Defined in: [src/core/agent/evidence/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L101)

Values (or patterns) that are never flagged, whatever the extractor
thinks. A literal string is compared after normalisation; a RegExp is
matched against a whole token.

Values the USER supplied are already exempt without declaring anything —
this is for the rest: a build number your prompt does not carry, a
constant your app knows is safe.

***

### figures?

> `readonly` `optional` **figures?**: `boolean`

Defined in: [src/core/agent/evidence/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L154)

The figures dial. Default `false` — off, byte-identical.

A FIGURE is a number wearing a unit of measure: `53.2%`, `6.3 TB`,
`24.8TB`, `120 ms`, `41,200 IOPS` (`figures.ts` · `FIGURE_UNITS`). Under
`minDigits` such a number is prose to the default extractor — so an
invented "53.2% used, 6.3 TB free" passed as clean. With the dial on, a
figure is data whatever its digit count, and every NUMBER the results do
not carry (a figure, or a bare number at or over `minDigits`) is asked one
more question before it is flagged: is it a declared derivation of the
numbers they do carry — a rounding, a column sum, a like-unit ratio or
difference of column sums, a complement of a percentage, or a 1000/1024
unit conversion (`figures.ts` · `explainFigure`)? One that is lands in
`EvidenceVerdict.computed`, named with its derivation; one that is not is
`unsupported` like any invented value, and the sentences say it matched
no value AND no derivation.

Whole numbers under `minDigits` with no unit ("3 issues", "24 hours")
stay prose. See `figures.ts` for the derivation set and its bounds.

***

### minDigits?

> `readonly` `optional` **minDigits?**: `number`

Defined in: [src/core/agent/evidence/types.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L112)

How many digits a BARE number needs before it is treated as data rather
than prose. Default `4`.

`3 issues`, `24 hours`, `47 flaps` and `892 CRC errors` are ordinary
English and must never trip the gate; `41,200` is a reading off a screen.
Four digits is where that line sits in the material we measured. Lower it
only if your domain's numbers are genuinely small and you accept the false
positives that follow.

***

### nudge?

> `readonly` `optional` **nudge?**: `boolean`

Defined in: [src/core/agent/evidence/types.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L133)

The staged-refs nudge. Default `false` — off, byte-identical.

When an iteration's context carries tool results staged by reference
(`artifacts.placement` tickets) AND a tool the model can currently call
declares `wants` over one of their kinds, the library appends ONE short
line at the END of that request naming the refs and the spender tool:
derived numbers come from the tool, not from mental arithmetic. Composed
entirely from declarations (`Tool.resultKind` / `Tool.wants`) — no app
prose — and placed late because the measured failure was recency: the
app's own "use the compute tool" instruction sat at the top of the
context while the numbers sat at the bottom, and the model summed them
in its head. The line is request-only (never history) and recomposed per
iteration, so it exists exactly while both conditions hold. Each firing
lands as `agentfootprint.agent.grounding_nudged`.

Advisory — the postures above stay the guarantee. An agent with no
artifact placement or no `wants`-declaring tool arms nothing and keeps
byte-identical requests.

***

### posture?

> `readonly` `optional` **posture?**: [`EvidencePosture`](/docs/api/type-aliases/EvidencePosture)

Defined in: [src/core/agent/evidence/types.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L89)

Default `'assist'` — record and flag, change nothing.

***

### recoveryInstruction?

> `readonly` `optional` **recoveryInstruction?**: [`EvidenceRecoveryInstruction`](/docs/api/type-aliases/EvidenceRecoveryInstruction)

Defined in: [src/core/agent/evidence/types.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L160)

Extra guidance after an evidence check requests revision. At most 4000
UTF-16 code units; callbacks receive a frozen context and must return
synchronously. Invalid output or a thrown callback fails the run.
The library's internal framing and validation remain in force. The text
is request-only and never becomes evidence, user history or an exemption.

***

### shapes?

> `readonly` `optional` **shapes?**: readonly [`EvidenceShape`](/docs/api/interfaces/EvidenceShape)[]

Defined in: [src/core/agent/evidence/types.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L91)

Extra identifier shapes for this domain. Composes with the defaults.
