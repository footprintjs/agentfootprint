---
title: ContingentRow
---

# Interface: ContingentRow

Defined in: [src/core/agent/findings/types.ts:344](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L344)

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

Defined in: [src/core/agent/findings/types.ts:348](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L348)

***

### declaredOn

> `readonly` **declaredOn**: `DeclaredOn`

Defined in: [src/core/agent/findings/types.ts:346](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L346)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:349](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L349)

***

### kind

> `readonly` **kind**: `"contingent"`

Defined in: [src/core/agent/findings/types.ts:345](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L345)

***

### turn?

> `readonly` `optional` **turn?**: `number`

Defined in: [src/core/agent/findings/types.ts:356](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L356)

The conversation turn the row was filed in (`AgentState.turnNumber`) —
stamped by the one writer while an honesty layer is armed (the inputs
layer, the answer layer), absent otherwise. The ledger crosses turns on a continued
conversation, and `iteration` restarts at 1 every run.

***

### value

> `readonly` **value**: `string`

Defined in: [src/core/agent/findings/types.ts:347](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/findings/types.ts#L347)
