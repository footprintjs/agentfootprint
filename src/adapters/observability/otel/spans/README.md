**Support** — the adapter's only span writer and optional SDK boundary.

`writer.ts` captures the injected tracer/API once and resolves an absent API
only when a span actually starts. Parent context is evaluated before tracer
resolution, preserving the original first-span order. Every span attribute,
event and flattened fallback uses the same cap; the fallback never re-caps
prefixed content keys. Ending and stack removal keep their original order.

The adjacent tests check lazy resolution order and a failing `addEvent`.
