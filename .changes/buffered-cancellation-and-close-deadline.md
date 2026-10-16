---
type: fixed
---
**Cancellation also stops events already buffered by a stream parser, and a gateway close obeys its timeout.** A single transport read can contain several text and usage events. Fetch-based adapters now recheck the caller's signal between those events, so cancelling after one event cannot produce more text or a terminal success from the same read. The InvokeModel gateway also applies `timeoutMs` while waiting for the response body's close: a transport that never finishes cancelling now rejects with the typed timeout instead of holding the caller open. No retry is added; a timeout after text was delivered must still never replay the answer. Tests use injected transports only.
