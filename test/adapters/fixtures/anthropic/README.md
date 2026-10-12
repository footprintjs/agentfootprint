# Sanitized recorded Anthropic content blocks

These two fixtures derive from the `rawThinking` arrays retained in two real
application recordings using `claude-sonnet-4-5-20250929`. The adapter retained
the full provider `message.content` array there, before thinking normalization.
The recorded block order, block field names and exact `caller: { "type": "direct" }`
metadata are preserved.

All thinking, assistant text, signatures, tool identifiers, tool names and tool
arguments have been replaced with fixed synthetic values. The complete input
object is synthetic, including its field names. No private conversation,
credential, source path, recording identifier or original signature is included.
The synthetic signature is not valid for sending to Anthropic.

These are **sanitized captured content-block shapes**, not full HTTP responses,
SSE captures or evidence of which field caused a particular live failure. The
tests explicitly construct synthetic message envelopes and SDK stream wrappers
around them. They never send requests to a model.

Neither capture contained `citations` or `toolset_name`. The separate metadata
matrix tests those fields using explicitly synthetic SDK-contract fixtures;
it does not claim they came from these recordings. Keep those two provenance
categories distinct when adding fixtures.
