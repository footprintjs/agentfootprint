[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MockProviderOptions

# Interface: MockProviderOptions

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L36)

## Properties

### chunkDelayMs?

> `readonly` `optional` **chunkDelayMs?**: `LatencyMs`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:91](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L91)

For `stream()`: delay between successive chunks (ms). Pass a
single number for a fixed delay or a `[min, max]` tuple for a
uniformly random delay per chunk (e.g. `[30, 80]` for typing-like
cadence). Default 30ms.

Has no effect on `complete()`.

***

### delayMs?

> `readonly` `optional` **delayMs?**: `LatencyMs`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:82](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L82)

Alias for `thinkingMs`. Kept for back-compat with prior revisions.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:37](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L37)

***

### replies?

> `readonly` `optional` **replies?**: readonly [`MockReply`](/agentfootprint/api/generated/type-aliases/MockReply.md)[]

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:62](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L62)

Scripted replies for multi-turn / tool-using agents. Each entry
is consumed in order — iteration 1 reads `replies[0]`, iteration
2 reads `replies[1]`, and so on. Use Partial<LLMResponse> to
inject `toolCalls`:

```ts
mock({
  replies: [
    { toolCalls: [{ id: '1', name: 'lookup', args: { id: 42 } }] },
    { content: 'Found it: refunds take 3 business days.' },
  ],
});
```

**Exhaustion semantics:** if the agent calls the LLM more times
than there are replies, `complete()` / `stream()` throw a clear
error. This makes mock-script bugs loud, not silent. Tune the
agent's `maxIterations` to bound the call count.

Takes precedence over `reply` and `respond` when set.

***

### reply?

> `readonly` `optional` **reply?**: `string`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:39](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L39)

Fixed response content. Overrides `respond` when set.

***

### respond?

> `readonly` `optional` **respond?**: (`req`) => `string` \| `Partial`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:71](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L71)

Build the response from the request. Returns either a plain
string (renders as content with no tool calls) or a partial
`LLMResponse` so consumers can simulate tool calls + multi-turn
loops without needing a separate `scripted()` helper.

Default: echoes the last user message.

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

#### Returns

`string` \| `Partial`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

***

### stopReason?

> `readonly` `optional` **stopReason?**: `string`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:93](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L93)

Fixed stop reason to return. Default 'stop'.

***

### thinkingMs?

> `readonly` `optional` **thinkingMs?**: `LatencyMs`

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:80](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L80)

Simulated wall-clock delay per request (ms).
Pass a single number for a fixed delay or a `[min, max]` tuple for
a uniformly random delay (e.g. `[3000, 8000]` for "real LLM"
thinking time). Default 0 (instant).

Aliased via `delayMs` for backward compatibility.

***

### usage?

> `readonly` `optional` **usage?**: `Readonly`\<\{ `cacheRead?`: `number`; `cacheWrite?`: `number`; `input?`: `number`; `output?`: `number`; \}\>

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:95](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L95)

Override usage counts returned. Default: chars/4 heuristic.
