# Open bounded sections of a stored proof

Run this example when a model needs selected JSON from a stored evidence bundle
without receiving the entire bundle:

```sh
npm run example examples/artifacts/artifact-detail.ts
```

The default model is a scripted mock; no provider key or external source is used.
A real producer tool stores synthetic data through `ctx.artifacts.put`. The agent
then follows the mounted viewer's actual child actions, reads both sample pages
(20 of 25, then the remaining 5), and opens `/samples/20`. The result is the exact
stored source value, with `LOCAL SEED` and unknown-cause context:

```text
sample-20: retained-event-20. LOCAL SEED. Inventory mapping was not collected; physical cause remains unknown.
Source reads: 1. Fresh viewer admissions: 5. Synthetic data only.
```

`artifactDetailTool` handles safe pointers, bounded direct-child pages and explicit
completeness. The host's admission function still checks every call: the complete
issued reference, caller scope, current native run, expected kind, producer call,
size, digest identity and fresh scoped `head`/`get`. The store owns payload digest
verification. A real deployment must authenticate the caller before creating its
run identity; this example supplies a fixed synthetic identity.

The helper does not find a cause, authorize a conclusion, fetch a source, or walk
a graph. This bundle is synthetic evidence-shaped data, not output from a causal
analysis API. Host caveats stay under `context`; tool results keep their ordinary
tool-message framing. That separation does not guarantee that a model will ignore
instruction-like source text.

See [dataset-result](dataset-result.md) for declaring rowsets and redeeming them
through `wants`. Use the detail viewer when the consumer needs navigable JSON
sections instead of a dataset computation.
