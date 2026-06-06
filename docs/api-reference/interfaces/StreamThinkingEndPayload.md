[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StreamThinkingEndPayload

# Interface: StreamThinkingEndPayload

Defined in: [src/events/payloads.ts:721](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L721)

Emitted (v2.14) once per LLM call where thinking blocks were
produced. Pairs with the leading `stream.thinking_delta` events when
streaming, OR fires standalone for non-streaming providers (OpenAI).

Use this event for live per-iteration UIs (chat-bubble reasoning
pills, retry-rate dashboards, telemetry). The `blocks` field carries
the same content that lands on `LLMMessage.thinkingBlocks` — read it
here for live display instead of post-walking `scope.history` after
the run completes (the framework's "collect during traversal" rule).

**`tokens` field population:**
- Anthropic: `undefined` currently — Anthropic's `response.usage`
  doesn't break out thinking tokens (bundled in `output_tokens`).
  May change in future Anthropic API revisions.
- OpenAI o1/o3: populated from
  `response.usage.completion_tokens_details.reasoning_tokens`.
- Custom providers: populated when handler computes it during
  `normalize()`.

**Sensitive data:** the `blocks` field carries reasoning content.
Same risk profile as `stream.token` — wildcard (`*`) recorders
piping to external sinks (Datadog, CloudWatch, OTel) will see this.
Treat thinking content with the same redaction posture you give
visible response tokens. `providerMeta` is already stripped by the
framework before persistence (Phase 6 invariant), so the blocks
here match the audit-log surface bytes-exactly.

## Properties

### blockCount

> `readonly` **blockCount**: `number`

Defined in: [src/events/payloads.ts:723](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L723)

***

### blocks?

> `readonly` `optional` **blocks?**: readonly `ThinkingBlock`[]

Defined in: [src/events/payloads.ts:738](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L738)

v2.14+ — the normalized thinking blocks for this LLM call.

Same data the framework persists to `LLMMessage.thinkingBlocks`
(post-`providerMeta` strip). Lets live consumers render the
model's chain-of-thought per iteration without scope-walking
after the run.

Empty / undefined when no thinking content was produced this
call (handler returned `[]`). Non-empty when at least one
thinking or redacted_thinking block landed.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:722](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L722)

***

### tokens?

> `readonly` `optional` **tokens?**: `number`

Defined in: [src/events/payloads.ts:725](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L725)

***

### totalChars

> `readonly` **totalChars**: `number`

Defined in: [src/events/payloads.ts:724](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/payloads.ts#L724)
