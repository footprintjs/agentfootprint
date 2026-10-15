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
the code that calls it. The readers stay in `lib/time-travel/`:
`lib/time-travel/servedView.ts` · `servedAt` rebuilds the request from the
record and `lib/time-travel/servedView.ts` · `receiptAt` reads the receipt
back. They
import this folder downward, and `lib/time-travel/index.ts` re-exports its
public names, so every door keeps the same exports. The law that binds the two
sides — `hash(servedAt(k)) === receiptAt(k).hash` — is documented in
`lib/time-travel/README.md` and pinned by
`test/lib/time-travel/receipt-conformance.test.ts`.

## Files
- `receipt.ts` — the receipt's shape, the salted hash (`receiptHash`), the
  digest inputs (`messageDigestInput`, `toolDigestInput`), the chained
  fingerprint (`transformHashOf`) and the mint (`buildReceipt`).
- `receiptDigests.ts` — the run's memo, so each call hashes and measures only
  what it added (`test/core/agent/receipt/receipt-incremental.test.ts`).
- `requestMeasurement.ts` — the size of the prepared request, never its text.
