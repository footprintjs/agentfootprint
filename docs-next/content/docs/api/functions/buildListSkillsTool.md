---
title: buildListSkillsTool
---

# Function: buildListSkillsTool()

> **buildListSkillsTool**(`skills`): [`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`

Defined in: [src/lib/injection-engine/skillTools.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillTools.ts#L39)

Build the `list_skills` tool — a no-arg tool that returns the
registered skills as `{ id, description }[]`. Lets the LLM discover
skills without paying the prompt-token cost of embedding the
catalog into every system prompt.

Pairs with `read_skill` (which actually activates a skill by id).

Returns `undefined` when there are no skills — callers should
guard or filter undefined out of their tool list.

## Parameters

### skills

readonly [`Injection`](/docs/api/interfaces/Injection)[]

## Returns

[`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| `undefined`
