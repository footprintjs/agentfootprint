# Single-call authoring

`../LLMCall.ts` owns the runtime and chart wiring. This sealed folder owns the
unchanged options/input/output/state declarations and the fluent builder.
The existing facade exports the same public class and type names. No public
import path, instance key, constructor signature or builder refusal changed.
The native context recorder's runtime tests exercise this builder under mounts.
