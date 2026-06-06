[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / buildListSkillsTool

# Function: buildListSkillsTool()

> **buildListSkillsTool**(`skills`): [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`

Defined in: [src/lib/injection-engine/skillTools.ts:39](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/lib/injection-engine/skillTools.ts#L39)

Build the `list_skills` tool — a no-arg tool that returns the
registered skills as `{ id, description }[]`. Lets the LLM discover
skills without paying the prompt-token cost of embedding the
catalog into every system prompt.

Pairs with `read_skill` (which actually activates a skill by id).

Returns `undefined` when there are no skills — callers should
guard or filter undefined out of their tool list.

## Parameters

### skills

readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[]

## Returns

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`
