[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SemanticClarify

# Interface: SemanticClarify

Defined in: [src/lib/semantics/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L125)

The ask-vs-answer decision, as data. A tool that matched three volumes for
one WWN should not pick one silently — it should hand the question and the
candidates back, typed, so the loop (or a UI) can ask.

## Properties

### candidates

> `readonly` **candidates**: readonly `unknown`[]

Defined in: [src/lib/semantics/types.ts:129](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L129)

The candidates the question is choosing between. May be empty — an open
 question is still a question.

***

### question

> `readonly` **question**: `string`

Defined in: [src/lib/semantics/types.ts:126](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/lib/semantics/types.ts#L126)
