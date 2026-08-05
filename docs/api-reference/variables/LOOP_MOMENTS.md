[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LOOP\_MOMENTS

# Variable: LOOP\_MOMENTS

> `const` **LOOP\_MOMENTS**: readonly \[`"input"`, `"before-tool"`, `"after-tool"`, `"window"`, `"output"`\]

Defined in: [src/core/agent/moments.ts:41](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/agent/moments.ts#L41)

Every moment of one agent turn where a rule may act, in the order the loop
reaches them.

```
input → [ window → … LLM … → before-tool → tool → after-tool ]* → output
```

`watch` attends all five and more; `act` attends exactly these. The
difference is what a rule may DO there — an observer reports, a rule
changes what happens next.
