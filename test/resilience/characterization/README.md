# Model-call characterization

Run with `npm test -- test/resilience/characterization`.

The scripted provider is the leaf. These tests exercise `withRetry`,
`withFallback`, `withCircuitBreaker`, and the Agent's reliability and
stream/complete delivery paths. Coverage stops at that provider interface.
The adapters in `src/adapters/llm` and their SDK behavior, `LLMCall`'s own
provider path, and the N-way `fallbackProvider` chain are outside this harness.
