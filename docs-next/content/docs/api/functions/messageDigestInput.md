---
title: messageDigestInput
---

# Function: messageDigestInput()

> **messageDigestInput**(`message`): `string`

Defined in: [src/lib/time-travel/receipt.ts:511](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/receipt.ts#L511)

The bytes a message's hash covers, each field behind a separator: its role,
its text, its `toolCallId`, its `toolName`, the calls it asked for (id, name,
arguments and `providerMeta`) and its `thinkingBlocks`.

WHY `toolCallId` (9.88.0). It is the JOIN KEY — `tool_use_id` on Anthropic's
wire, `tool_call_id` on OpenAI's — that pairs a tool result to the call that
asked for it. Two parallel calls whose results happen to have identical text
hashed the SAME without it, so a mis-pairing (the answer to `c1` filed under
`c2`) was invisible to the law: exactly the defect a receipt exists to catch.

WHY `toolName` TOO (9.88.0). On two shipped providers the id is not the join
key at all. `adapters/llm/GeminiProvider.ts` · `toGeminiContents` pairs a
`functionResponse` to its call BY NAME and says so in its own comment; the
id is optional there and dropped when it is not a real one.
`adapters/llm/OllamaProvider.ts` · `toOllamaMessages` puts `tool_name` on
the wire and only falls back to the id. So on those providers a receipt that
covered `toolCallId` alone still could not see the very mis-pairing the
field was added for: two `role:'tool'` messages with identical text and
SWAPPED names fingerprinted identically. It rides as its own field behind
the separator, beside the id, so a name moving between two results changes
both hashes and neither can absorb the other's bytes.

WHY `thinkingBlocks` and `providerMeta` (9.88.0). `adapters/types.ts` is
explicit that a signed thinking block MUST be echoed byte-exact or the API
rejects the turn, and `providerMeta` round-trips vendor state (Gemini's
`thoughtSignature`, without which the turn after a tool call is refused).
Both are things the model receives; a fingerprint that omitted them said two
requests were the same when one of them would be rejected. They enter as a
`stableJson` FINGERPRINT, so nothing quotable is added — a signature is an
opaque token, not content.

Still deliberately NOT covered: `injectedBy` (stripped before the request
exists) and `ephemeral` (a persistence flag, invisible to the model). Two
messages that hash the same are the same thing said to the model.

## Parameters

### message

[`LLMMessage`](/docs/api/interfaces/LLMMessage)

## Returns

`string`
