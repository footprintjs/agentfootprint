---
type: added
---
**Bedrock Converse prompt caching is model-aware and measurable.** Supported exact model and documented geography-profile IDs receive bounded `cachePoint` blocks; unknown models and custom profile ARNs receive none. Nova omits tool checkpoints and unsupported TTL fields. Both Converse response paths preserve optional cache counters, including measured zero. `cacheStrategyFor(provider, model)` and resilience decorators share the same declaration. Explicit policies without provider/model support give one development warning per agent build. Default policies warn only for a model-aware provider with an unrecognized model; Mock and Ollama defaults stay silent. Fixed run metadata distinguishes explicit from default policy sources. The cache meter now accepts the engine event envelope delivered by `.watch()`, as well as typed-stream forwarding. Tests and the runnable example use scripted SDK responses without AWS calls.


**Type compatibility (breaking for direct readers). Migration:** `LLMProvider.promptCaching` now accepts either a static declaration or a model function. Consumers that read `.mode` directly must use the shared `promptCachingFor(provider, model)` resolver from `agentfootprint/cache` before inspecting the declaration. Existing static provider declarations remain supported.
