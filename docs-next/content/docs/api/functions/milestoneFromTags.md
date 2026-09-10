---
title: milestoneFromTags
---

# Function: milestoneFromTags()

> **milestoneFromTags**(`tags`, `labelWhenUndeclared?`): [`Milestone`](/docs/api/interfaces/Milestone) \| `null`

Defined in: [src/conventions.ts:535](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L535)

Read a [Milestone](/docs/api/interfaces/Milestone) back off a commit bundle's declared `tags`, or
`null` when they carry no milestone kind tag. The kind must be one of
[MILESTONE\_KINDS](/docs/api/variables/MILESTONE_KINDS); the label is the `milestone-label:` tag when one was
declared, else `labelWhenUndeclared` (a reader passes the stop's own label —
the chart's word for the stage), else the kind itself. A stored row is
`unknown[]`-shaped until narrowed: non-strings are ignored, never a milestone.

## Parameters

### tags

readonly `unknown`[] \| `undefined`

### labelWhenUndeclared?

`string`

## Returns

[`Milestone`](/docs/api/interfaces/Milestone) \| `null`

## Example

```ts
milestoneFromTags(['milestone:llm-turn', 'milestone-label:LLM turn']);
// { kind: 'llm-turn', label: 'LLM turn' }
milestoneFromTags(['audit']);            // null — tagged, but not a milestone
milestoneFromTags(undefined);            // null — an untagged bundle
```
