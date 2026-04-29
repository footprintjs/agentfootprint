[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RefreshPolicy

# Interface: RefreshPolicy

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:70](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L70)

When (if ever) to re-deliver a Skill's body in long-running runs.

Even on providers with strong system-prompt adherence, attention to
the system slot decays past long contexts. `refreshPolicy` re-injects
the body via tool result past a token threshold so the LLM sees it
fresh again.

**v2.4 status:** the field is reserved + typed; the runtime hook
lands in v2.5 as part of the long-context attention work. Specifying
`refreshPolicy` today is non-breaking — the engine ignores it until
the hook is implemented.

## Properties

### afterTokens

> `readonly` **afterTokens**: `number`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:76](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L76)

Re-inject the Skill body once the run has consumed this many input
tokens since the Skill was last surfaced. Recommended: 50_000 for
200k-context models; 20_000 for 32k-context models.

***

### via

> `readonly` **via**: `"tool-result"`

Defined in: [agentfootprint/src/lib/injection-engine/factories/defineSkill.ts:81](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/factories/defineSkill.ts#L81)

How to re-inject. `'tool-result'` synthesizes a fresh tool result
carrying the body text (recency-first). Other modes reserved.
