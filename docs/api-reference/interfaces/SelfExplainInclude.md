[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SelfExplainInclude

# Interface: SelfExplainInclude

Defined in: [src/lib/trace-toolpack/selfExplain.ts:71](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L71)

How much of a turn's evidence the binding keeps.

Both default to TRUE, which is the point: the tools that read them
(`read_narrative`, `inspect_tool_call`) are on the catalog either way,
and a tool that answers "⚠ no evidence" by default is a tool that
teaches the model not to call it. Turn one off when the cost matters
more than the answer — a very long-running turn, or a run whose
narrative would repeat what the structured tools already say.

## Properties

### events?

> `readonly` `optional` **events?**: `boolean`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:79](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L79)

A bounded tail of the run's typed events → tool-call timings and
outcomes in `inspect_tool_call`. Default true. Off means no wildcard
event subscription is made at all, not a subscription that is ignored.

***

### narrative?

> `readonly` `optional` **narrative?**: `boolean`

Defined in: [src/lib/trace-toolpack/selfExplain.ts:73](https://github.com/footprintjs/agentfootprint/blob/35335c51cb97cbd7d2d4de6ef3c2bc69a62d68d5/src/lib/trace-toolpack/selfExplain.ts#L73)

The run's plain-English story → the `read_narrative` tool. Default true.
