---
title: checkSkillContract
---

# Function: checkSkillContract()

> **checkSkillContract**(`skill`, `knownToolNames?`): [`GraphProblem`](/docs/api/interfaces/GraphProblem)[]

Defined in: [src/lib/injection-engine/skillContract.ts:41](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillContract.ts#L41)

Check ONE skill's body against its tool contract. Pure + side-effect-free.

## Parameters

### skill

[`Injection`](/docs/api/interfaces/Injection)

the skill to check

### knownToolNames?

`ReadonlySet`\<`string`\>

every tool name reachable in the wider graph/agent (lets
                       the check tell a cross-skill HANDOFF from a typo). Omit to
                       check a skill in isolation (only its own tools are "known").

## Returns

[`GraphProblem`](/docs/api/interfaces/GraphProblem)[]
