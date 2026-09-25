[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ALWAYS\_SERVED\_TOOLS

# Variable: ALWAYS\_SERVED\_TOOLS

> `const` **ALWAYS\_SERVED\_TOOLS**: readonly `string`[]

Defined in: [src/core/agent/toolChoice/types.ts:39](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/toolChoice/types.ts#L39)

The framework's own doors, never narrowed away: the skill menu
(`read_skill`, `list_skills` — `core/agent/buildToolRegistry.ts`), the
procedure escape (`skip_step` — `lib/injection-engine/skillSteps.ts ·
SKIP_STEP_TOOL_NAME`) and the hand-to-the-screen tool (`present` —
`artifacts/present.ts · PRESENT_TOOL_NAME`). Literals here so this file
stays a leaf; `test/core/agent/toolChoice/narrow.test.ts` pins them to
the owners' constants. The `'tool-forced'` schema tool never enters the
slot (it is appended at request assembly), so it needs no entry.
