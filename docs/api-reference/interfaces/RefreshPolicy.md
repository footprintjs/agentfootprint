[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RefreshPolicy

# Interface: RefreshPolicy

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:73](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L73)

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

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:79](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L79)

Re-inject the Skill body once the run has consumed this many input
tokens since the Skill was last surfaced. Recommended: 50_000 for
200k-context models; 20_000 for 32k-context models.

***

### via

> `readonly` **via**: `"tool-result"`

Defined in: [src/lib/injection-engine/factories/defineSkill.ts:84](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/lib/injection-engine/factories/defineSkill.ts#L84)

How to re-inject. `'tool-result'` synthesizes a fresh tool result
carrying the body text (recency-first). Other modes reserved.
