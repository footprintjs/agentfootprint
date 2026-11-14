**Mixed** — the legacy Agent's admitted continuation and seed support.
`conversation/continuation.ts` is the **Walker** that restores native invocation
values; `conversation/seedHistory.ts` is the **Fold** that builds accepted history.

# Legacy continuation support

These internal helpers retain the existing Agent entry points and native component
values. They add no run owner, session, cache or store. The legacy facade passes
its immutable agent identity and feature settings at each call; every continuation
is still validated before pending values are restored.
