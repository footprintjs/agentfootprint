---
type: changed
bump: minor
---
**Findings keeps tool definitions and system instructions stable for prompt caching.** Current result IDs and model-declared standings now travel in a bounded, request-only DATA frame after the cached history, instead of per-call schema enums and system text. Citation admission still checks the accepted request's actual unique executed results. Host `findings.maxContextBytes` bounds the frame; whole omissions and unknown source data remain explicit. Call-scoped layout evidence keeps saved and resumed requests reproducible; older records retain their recorded layout. Global cache-off and provider/host restrictions still apply, and collapse, tool changes or window rewrites can still miss cache. No live cache saving or model-quality result has been measured by this change's offline tests.
