---
title: NamesAndNumbersOptions
---

# Interface: NamesAndNumbersOptions

Defined in: [src/core/agent/evidence/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L88)

Options for `.namesAndNumbersFromEvidence()`.

## Properties

### code?

> `readonly` `optional` **code?**: `"check"` \| `"match"`

Defined in: [src/core/agent/evidence/types.ts:188](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L188)

How a fenced code block in a PROSE answer is read. Default `'check'` —
today's behaviour, byte for byte: the whole answer is prose.

`'match'` — each fenced block (```` ``` ```` or `~~~`, at column 0, closed)
is compared, byte for byte after removing only the Markdown wrapper,
against the programs this TURN's calls of a declared code-running tool
(`Tool.script`, which `codeRunnerTool` declares) submitted to the tool. A
block that matches one is script content: it yields no value to ground
and is labelled with that call's recorded outcome (`completed, exit 0`,
`outcome unknown`, …). A block that matches none stays prose, checked as
today, and is labelled `unmatched`. Code is never evidence: a value in the
prose that also sits in the script still needs a tool result.

Inline spans, unclosed fences and indented code are prose. A typed answer
is not scanned. There is no `'skip'`: exempting every fence would be an
exemption by formatting. See `core/agent/scripts/README.md`.

***

### decimalRounding?

> `readonly` `optional` **decimalRounding?**: `boolean`

Defined in: [src/core/agent/evidence/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L163)

Opt-in precision-bounded rounding for plain decimals. Default false.
Plain decimals become checked data even below minDigits. An exact result
wins; otherwise only one carried number may round at the written precision.
Whole numbers, identifiers, sums, ratios and unit conversions gain no new
acceptance. Numeric derivations use `computed` with `rounded` and `from`.

***

### exempt?

> `readonly` `optional` **exempt?**: readonly (`string` \| `RegExp`)[]

Defined in: [src/core/agent/evidence/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L102)

Values (or patterns) that are never flagged, whatever the extractor
thinks. A literal string is compared after normalisation; a RegExp is
matched against a whole token.

Values the USER supplied are already exempt without declaring anything —
this is for the rest: a build number your prompt does not carry, a
constant your app knows is safe.

***

### figures?

> `readonly` `optional` **figures?**: `boolean`

Defined in: [src/core/agent/evidence/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L155)

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

Defined in: [src/core/agent/evidence/types.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L113)

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

Defined in: [src/core/agent/evidence/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L134)

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

Defined in: [src/core/agent/evidence/types.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L90)

Default `'assist'` — record and flag, change nothing.

***

### recoveryInstruction?

> `readonly` `optional` **recoveryInstruction?**: [`EvidenceRecoveryInstruction`](/docs/api/type-aliases/EvidenceRecoveryInstruction)

Defined in: [src/core/agent/evidence/types.ts:169](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L169)

Extra guidance after an evidence check requests revision. At most 4000
UTF-16 code units; callbacks receive a frozen context and must return
synchronously. Invalid output or a thrown callback fails the run.
The library's internal framing and validation remain in force. The text
is request-only and never becomes evidence, user history or an exemption.

***

### shapes?

> `readonly` `optional` **shapes?**: readonly [`EvidenceShape`](/docs/api/interfaces/EvidenceShape)[]

Defined in: [src/core/agent/evidence/types.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L92)

Extra identifier shapes for this domain. Composes with the defaults.
