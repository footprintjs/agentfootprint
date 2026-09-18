---
title: ContingentRow
---

# Interface: ContingentRow

Defined in: [src/core/agent/findings/types.ts:289](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L289)

A value the model USED — in its answer, or as an argument of a later
call — that came only from results the model itself declared `open`,
`noise` or `ruled-out` (9.110.0): a theorem built on a lemma the prover
had already set aside. Declared standings plus the evidence corpus's
carriers (`evidence/evidenceIndex.ts · EvidenceCorpus.carriers`); no
inference, no judge, no second model — `findings/contingent.ts` is the
one rule. One row per contingent VALUE per moment (the answer, or the
call whose arguments used it), never per carrier.

`value` is the token as the extractor normalized it (`evidence/extract.ts`
decides which tokens are data; `evidence/normalize.ts` the spelling), cut
at `CONTINGENT_VALUE_CHARS` with the cut stated. `carriers` names EVERY
result that carried it, in wire order, each with its standing — the whole
list, because the rule is "every carrier non-fact": a value with one
`fact` carrier, an undeclared carrier, or more carriers than the corpus
lists (`ValueCarriers.truncated`) files no row. `iteration` is the
moment's iteration — the answer's, or the dispatching call's.

## Properties

### carriers

> `readonly` **carriers**: readonly [`ContingentCarrier`](/docs/api/interfaces/ContingentCarrier)[]

Defined in: [src/core/agent/findings/types.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L293)

***

### declaredOn

> `readonly` **declaredOn**: `DeclaredOn`

Defined in: [src/core/agent/findings/types.ts:291](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L291)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:294](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L294)

***

### kind

> `readonly` **kind**: `"contingent"`

Defined in: [src/core/agent/findings/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L290)

***

### value

> `readonly` **value**: `string`

Defined in: [src/core/agent/findings/types.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L292)
