Mixed
Map: `chart.ts` wires the single-call chart. Support: `builder.ts` and `types.ts`
own the single-call builder and its declared contracts.

# Single-call authoring

`../LLMCall.ts` owns the runtime lifecycle. `chart.ts` owns its existing one-call chart wiring and accepted-response intervention admission. This sealed folder owns the
unchanged options/input/output/state declarations and the fluent builder.
The existing facade exports the same public class and type names. No public
import path, instance key, constructor signature or builder refusal changed.
The native context recorder's runtime tests exercise this builder under mounts.
