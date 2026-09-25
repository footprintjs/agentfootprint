[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / milestoneFromTags

# Function: milestoneFromTags()

> **milestoneFromTags**(`tags`, `labelWhenUndeclared?`): [`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`

Defined in: [src/conventions.ts:546](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/conventions.ts#L546)

Read a [Milestone](/agentfootprint/api/generated/interfaces/Milestone.md) back off a commit bundle's declared `tags`, or
`null` when they carry no milestone kind tag. The kind must be one of
[MILESTONE\_KINDS](/agentfootprint/api/generated/variables/MILESTONE_KINDS.md); the label is the `milestone-label:` tag when one was
declared, else `labelWhenUndeclared` (a reader passes the stop's own label —
the chart's word for the stage), else the kind itself. A stored row is
`unknown[]`-shaped until narrowed: non-strings are ignored, never a milestone.

## Parameters

### tags

readonly `unknown`[] \| `undefined`

### labelWhenUndeclared?

`string`

## Returns

[`Milestone`](/agentfootprint/api/generated/interfaces/Milestone.md) \| `null`

## Example

```ts
milestoneFromTags(['milestone:llm-turn', 'milestone-label:LLM turn']);
// { kind: 'llm-turn', label: 'LLM turn' }
milestoneFromTags(['audit']);            // null — tagged, but not a milestone
milestoneFromTags(undefined);            // null — an untagged bundle
```
