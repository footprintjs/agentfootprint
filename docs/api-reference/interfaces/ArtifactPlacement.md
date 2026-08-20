[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactPlacement

# Interface: ArtifactPlacement

Defined in: [src/artifacts/placement.ts:37](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/placement.ts#L37)

The dial. One field today; a plain object so field number two (a
 per-kind override, say) can arrive additively.

## Properties

### maxInlineChars

> `readonly` **maxInlineChars**: `number`

Defined in: [src/artifacts/placement.ts:53](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/placement.ts#L53)

The threshold, in characters of the finalized result text. Over it, the
result is checked into the store and the model reads the claim ticket.
Positive whole number; anything else is refused at build.

**It moves what routing predicates read.** The substitute replaces the
result string everywhere downstream — history, `lastToolResult`,
`toolResults` — which is where skill-graph `when` edges and `rule`
triggers look. Turning placement on, or changing this number, can
therefore change which edge fires for a graph that matches on result
TEXT. That is the layering (routing judges what the model was told, not a
string the conversation never contained), stated here because it is not
guessable from a number: an edge that must survive the dial should key on
the tool name (`onToolReturn`) or a declared `status` (`onToolStatus`).
