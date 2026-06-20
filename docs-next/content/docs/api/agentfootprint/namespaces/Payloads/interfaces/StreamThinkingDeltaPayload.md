---
title: StreamThinkingDeltaPayload
---

# Interface: StreamThinkingDeltaPayload

Defined in: [src/events/payloads.ts:790](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L790)

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

**Default consumer behavior:** thinking_delta events are emitted but
not surfaced to end users unless a consumer explicitly subscribes to
this event (e.g. for reasoning-as-it-streams UIs).

**Sensitive data:** `content` is raw model thinking text. Use
`RedactionPolicy.thinkingPatterns` (Phase 3) to scrub before audit-log
adapters fire. Same risk profile as `stream.token`.

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/events/payloads.ts:794](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L794)

Per-chunk delta text, NOT accumulated. ~10–50 chars typical.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:791](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L791)

***

### tokenIndex

> `readonly` **tokenIndex**: `number`

Defined in: [src/events/payloads.ts:792](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/payloads.ts#L792)
