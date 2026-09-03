---
title: NamesAndNumbersOptions
---

# Interface: NamesAndNumbersOptions

Defined in: [src/core/agent/evidence/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L55)

Options for `.namesAndNumbersFromEvidence()`.

## Properties

### exempt?

> `readonly` `optional` **exempt?**: readonly (`string` \| `RegExp`)[]

Defined in: [src/core/agent/evidence/types.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L69)

Values (or patterns) that are never flagged, whatever the extractor
thinks. A literal string is compared after normalisation; a RegExp is
matched against a whole token.

Values the USER supplied are already exempt without declaring anything —
this is for the rest: a build number your prompt does not carry, a
constant your app knows is safe.

***

### minDigits?

> `readonly` `optional` **minDigits?**: `number`

Defined in: [src/core/agent/evidence/types.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L80)

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

Defined in: [src/core/agent/evidence/types.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L101)

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

Defined in: [src/core/agent/evidence/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L57)

Default `'assist'` — record and flag, change nothing.

***

### shapes?

> `readonly` `optional` **shapes?**: readonly [`EvidenceShape`](/docs/api/interfaces/EvidenceShape)[]

Defined in: [src/core/agent/evidence/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L59)

Extra identifier shapes for this domain. Composes with the defaults.
