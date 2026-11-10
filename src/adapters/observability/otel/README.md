**Support** — the implementation behind the public `otel.ts` entry point.

Reads the same dispatcher envelopes and flow-recorder evidence; writes the
same spans through a consumer's tracer. `types.ts` owns the existing public
contracts. `strategy.ts` captures options in their existing order and wires
one set of owners per strategy:

- `attributes/`: pure bounding and projections;
- `spans/`: lazy API resolution and outgoing span writes;
- `turns/`: live turns, bounded closed turns, and run/session metadata;
- `content/`: tool proposal snapshots and model-read content;
- `events/`: synchronous dispatch, explainability, and late-event placement.

The rule: the extraction changes ownership, not exported data or timing.
Captured switches remain captured; `serviceName` and `onError` remain live
reads at their original use sites. All owners share the same maps and stop
flag. The lifecycle is synchronous and adds no scheduling boundary.

The public suites remain under `test/observability-providers/`; the adjacent
owner tests cover the seams. `docs/architecture/otel-split.md` records the map
written before the first source move. No internal module imports the facade.
