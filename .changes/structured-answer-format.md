---
type: fixed
---
**Structured answers use native output when supported and accept one surrounding JSON fence.** `outputSchema` now defaults to `strategy: 'auto'`: a supplied or parser-derived JSON Schema uses the effective provider/model's native format when supported, otherwise instruction-based generation with local validation. Explicit strategies remain available. The final format guarantee follows the actual request, including reliability fallbacks; it is not a factual accuracy claim. Refusals and truncated native answers still fail; reliability cannot re-ask a native refusal or label a local fallback as native. Object intersections that cannot be safely closed are refused for native output and use the checked path under auto.

Raw JSON and one whole-answer JSON or unlabelled triple-backtick wrapper share the same strict JSON and application-schema validation. Prose around JSON, multiple fences and malformed values still fail, with the original output preserved in errors. Typed runs and claim observations use the same accepted parse.
