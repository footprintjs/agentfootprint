---
title: AnswerCoverage
---

# Interface: AnswerCoverage

Defined in: [src/core/agent/coverage/answer.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/answer.ts#L78)

A TYPED answer's limits, as data — the three coverage lists the prose block
would print, plus the values a tool's `assume` rule filled this turn (the
inputs layer, honesty layer 2), which the prose answer prints as its
"Assumed" block. The value of `AgentState.answerCoverage`,
`turn_end.answerCoverage` and `agent.answerCoverage()`.

`assumed` is the SAME reading of the SAME rows the block prints
(`arguments/serve.ts` · `assumedLinesFor`): one entry per distinct (tool,
argument, value), in the order the rows were filed, a row a before-tool
rewrite superseded left out. `value` is the tool's own argument view —
`'REDACTED'`, with `hidden: true`, when that view hides the argument.
Present only when a value was assumed. `periods` (honesty step 7b) is the
data twin of the block's `Period:` lines, present only when a call declared one.

## Extends

- [`Coverage`](/docs/api/interfaces/Coverage)

## Properties

### assumed?

> `readonly` `optional` **assumed?**: readonly `object`[]

Defined in: [src/core/agent/coverage/answer.ts:82](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/answer.ts#L82)

***

### cannotCover

> `readonly` **cannotCover**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L97)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`cannotCover`](/docs/api/interfaces/Coverage#cannotcover)

***

### checked

> `readonly` **checked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L95)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`checked`](/docs/api/interfaces/Coverage#checked)

***

### notChecked

> `readonly` **notChecked**: readonly [`CoverageItem`](/docs/api/interfaces/CoverageItem)[]

Defined in: [src/core/agent/coverage/types.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/types.ts#L96)

#### Inherited from

[`Coverage`](/docs/api/interfaces/Coverage).[`notChecked`](/docs/api/interfaces/Coverage#notchecked)

***

### periods?

> `readonly` `optional` **periods?**: readonly `object`[]

Defined in: [src/core/agent/coverage/answer.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/coverage/answer.ts#L81)

The periods the calls declared (honesty step 7b) — one per declaring
 call, as declared; present only when one did.
