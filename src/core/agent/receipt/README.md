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

## What the digest can establish

The digest joins its fields with control-character separators. JSON encoding escapes
control characters, while raw text fields keep their contents. A matching digest is
evidence for comparing recorded request pieces within a run. Both the input encoding
and the truncated digest can be ambiguous.

## Files
- `receipt.ts` — the receipt's shape, the salted hash (`receiptHash`), the
  digest inputs (`messageDigestInput`, `toolDigestInput`), the chained
  fingerprint (`transformHashOf`) and the mint (`buildReceipt`).
- `receiptDigests.ts` — the run's memo, so each call hashes and measures only
  what it added (`test/core/agent/receipt/receipt-incremental.test.ts`).
- `requestMeasurement.ts` — the size of the prepared request, never its text.
- `servedRow.ts` — the value-free ranges of whole retained history entries
  offered at the provider port. The call stage writes at most one row next to
  its receipt. The row's consumer is the native attempt series.

## Tools left out of a call

An accepted request can add `toolSelection` to its receipt. The attempt's
`consumer` identifies the call. Each `absent` row contains a visible tool name
and the selection decision that excluded it. A `bounded` flag means the saved
list is incomplete. An absent field leaves the tool selection unknown.

The recorder retains up to 1,024 omission rows per user turn. A new question
starts a fresh allowance. When restoring an interrupted turn on another executor, the
checkpoint does not prove how many rows remain. The recorder leaves selection
evidence out of subsequent receipts while that allowance is unknown.
