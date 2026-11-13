**Fold** — the receipt each LLM call mints: what the model was handed, as hashes
and references, folded once from the request the call composed.

## What it reads / what it writes
- Reads its arguments only: the composed request, its pieces and the run's
  digest memo. Nothing here reads scope, executes or emits.
- Writes nothing itself. The call-llm stage and the message-API charts commit
  the receipt under `RECEIPT_KEY` (owner: `lib/conventions.ts` · `RECEIPT_KEY`);
  the mint is `receipt.ts` · `buildReceipt`.

## Why it lives in core
The receipt is minted by the call (`core/agent/stages/callLLM.ts`,
`core/LLMCall.ts`, `core/agent/messageApiReceipt.ts`), so the mint sits with
the code that calls it. The readers stay in `time-travel/`:
`time-travel/servedView.ts` · `servedAt` rebuilds the request from the
record and `time-travel/servedView.ts` · `receiptAt` reads the receipt
back. They
import this folder downward, and `time-travel/index.ts` re-exports its
public names, so every door keeps the same exports. The law that binds the two
sides — `hash(servedAt(k)) === receiptAt(k).hash` — is documented in
`time-travel/README.md` and pinned by
`test/time-travel/receipt-conformance.test.ts`.

## Separators are not escaped

A digest input joins its parts with ASCII control characters (`receipt.ts` · `SEP`, `CALL_SEP`,
`CALL_FIELD_SEP`, `FIELD_SEP`). Only a JSON-encoded part (`digestJson`) is sure to be free of them,
because `JSON.stringify` escapes control characters. A raw string part — a prompt, a message's
`content`, a `toolName`, a `toolCallId`, a call's `id` and `name`, a run id — can contain one, and
nothing refuses or escapes it. So the separators make accidental ambiguity unlikely, not
impossible: two different messages can give the same `messageDigestInput`. Example: moving a
U+001E from the end of `content` to the start of `toolCallId` does not change the joined string,
so the two messages hash the same. Escaping or length-prefixing the raw parts would change every
message hash, so it is not done here.

## Files
- `receipt.ts` — the receipt's shape, the salted hash (`receiptHash`), the
  digest inputs (`messageDigestInput`, `toolDigestInput`), the chained
  fingerprint (`transformHashOf`) and the mint (`buildReceipt`).
- `receiptDigests.ts` — the run's memo, so each call hashes and measures only
  what it added (`test/core/agent/receipt/receipt-incremental.test.ts`).
- `requestMeasurement.ts` — the size of the prepared request, never its text.
