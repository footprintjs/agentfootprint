[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DecisionValue

# Interface: DecisionValue

Defined in: [src/core/checkin.ts:151](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/checkin.ts#L151)

What a person CHOSE, when the answer is a value rather than a yes or a no.

The ask got its typed half in 9.24.0 — [AskComponent](/agentfootprint/api/generated/interfaces/AskComponent.md) names a registered
screen component and the props it renders with. The ANSWER never did: a
decision was `approved` plus a free-text `note`, so a picked row, a brushed
date range or a chosen option had to travel as PROSE for the model to parse
back out. That is the exact failure the typed ask exists to prevent, surviving
on the return leg.

Deliberately shaped like the ask, for the same reasons:
  • `kind` is CONSUMER vocabulary — meaningful to whoever registered the
    component, opaque here. Never a type name from this library.
  • `value` is small inline JSON, because it rides the resume call and lands
    in the run's history. Anything large belongs behind [from](/agentfootprint/api/generated/interfaces/DecisionValue.md#from).
  • `from` is the artifact the choice was made AGAINST. A row id means
    nothing on its own; it means something in a dataset.

── Why `coverage` is here, and it is the field people skip ─────────────────
A person who filtered 5,000 rows to 3 and picked one has not chosen from
5,000. Without this field that pick is indistinguishable from an informed
choice over the whole set, and the difference is the whole value of a human
in the loop. It is the same distinction `coverage()` draws for a tool —
what was checked, and what a clean answer does not rule out — applied to the
person, because on this turn the person IS the tool.

Every field must survive `structuredClone`: a decision rides the checkpoint.

## Properties

### coverage?

> `readonly` `optional` **coverage?**: `object`

Defined in: [src/core/checkin.ts:165](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/checkin.ts#L165)

What the person could actually see when they chose.

`seen` of `total`, and the filter that narrowed it. A pick made over a
filtered view is a different fact from a pick made over everything, and
only the screen knows which happened.

#### filter?

> `readonly` `optional` **filter?**: `string`

#### seen

> `readonly` **seen**: `number`

#### total

> `readonly` **total**: `number`

***

### from?

> `readonly` `optional` **from?**: `string`

Defined in: [src/core/checkin.ts:157](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/checkin.ts#L157)

The artifact the choice was made against, when there was one.

***

### kind

> `readonly` **kind**: `string`

Defined in: [src/core/checkin.ts:153](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/checkin.ts#L153)

Consumer vocabulary for what this value IS — e.g. `'row-choice'`.

***

### value

> `readonly` **value**: `unknown`

Defined in: [src/core/checkin.ts:155](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/checkin.ts#L155)

The chosen value itself. JSON, clone-safe, small.
