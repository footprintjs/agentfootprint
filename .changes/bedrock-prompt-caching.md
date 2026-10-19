---
type: added
---
**Bedrock Converse prompt caching is model-aware and measurable.** Supported exact model and documented geography-profile IDs receive bounded `cachePoint` blocks; unknown models and custom profile ARNs receive none. Nova omits tool checkpoints and unsupported TTL fields. Both Converse response paths preserve optional cache counters, including measured zero. `cacheStrategyFor(provider, model)` and resilience decorators share the same declaration. A requested policy without provider/model support gives one development warning per agent build and fixed run-configuration metadata. The cache meter now accepts the engine event envelope delivered by `.watch()`, as well as typed-stream forwarding. Tests and the runnable example use scripted SDK responses without AWS calls.
