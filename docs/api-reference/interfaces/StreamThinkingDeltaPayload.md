[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StreamThinkingDeltaPayload

# Interface: StreamThinkingDeltaPayload

Defined in: [src/events/payloads.ts:686](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L686)

Emitted (v2.14) per provider chunk that carries thinking-content
tokens. Lives in `stream.*` domain — parallel to `stream.token` for
visible-content tokens.

**Provider behavior:**
- Anthropic: fires for every `content_block_delta` with
  `delta.type === 'thinking_delta'`. May fire 100s of times per turn.
- OpenAI o1/o3: NEVER fires (OpenAI doesn't stream reasoning content
  as of early 2026). Only `thinking_end` fires at response completion.
- Custom providers: fire when `ThinkingHandler.parseChunk()` returns
  a non-empty `thinkingDelta`.

**Default consumer behavior:** thinking_delta events are suppressed
at the consumer level by `enable.thinking({ stream: false })` (Phase 3
default). Consumers explicitly opt in with `stream: true` for
reasoning-as-it-streams UIs.

**Sensitive data:** `content` is raw model thinking text. Use
`RedactionPolicy.thinkingPatterns` (Phase 3) to scrub before audit-log
adapters fire. Same risk profile as `stream.token`.

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/events/payloads.ts:690](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L690)

Per-chunk delta text, NOT accumulated. ~10–50 chars typical.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:687](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L687)

***

### tokenIndex

> `readonly` **tokenIndex**: `number`

Defined in: [src/events/payloads.ts:688](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/events/payloads.ts#L688)
