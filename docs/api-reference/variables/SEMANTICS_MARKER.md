[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SEMANTICS\_MARKER

# Variable: SEMANTICS\_MARKER

> `const` **SEMANTICS\_MARKER**: `"af_semantics"` = `'af_semantics'`

Defined in: [src/lib/semantics/types.ts:48](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/lib/semantics/types.ts#L48)

The reserved key that makes a semantic envelope recognizable. Reserved
vocabulary on the tool-result wire (the `af_absent` / `af_coverage`
precedent): a plain object carrying `af_semantics: true` that validates
cleanly is an envelope; every other value any tool has ever returned keeps
its bytes.
