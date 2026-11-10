# OpenTelemetry adapter owners

The adapter's public contract stays at `src/adapters/observability/otel.ts`.
This map was written before extracting its 2,342-line implementation.

| Owner in `otel/` | Responsibility | Rule |
| --- | --- | --- |
| `types.ts` | Existing public declarations | Preserve every exported shape and option contract. |
| `attributes/` | Bounds, evidence rendering, payload projections | Preserve field order, content switches and size rules. |
| `spans/` | Lazy tracer, parenting, span writes and fallback | Every exported non-content value passes the same bounding funnel. |
| `turns/` | Live turns and bounded closed/forgotten retention | Only the named run/session can own a late score. |
| `content/` | Proposal snapshots and model-read tool results | Changed keys and code-runner programs stay withheld. |
| `events/` | Existing dispatch, explainability and late-event handlers | Preserve synchronous dispatch and close order. |
| `strategy.ts` | Validation, option capture and lifecycle wiring | Preserve option read timing and live error hooks. |

The adapter reads event/payload types, the standing type, the integrity
ledger's `filedNothing`, wire serialization, SHA-256, lazy loading, and the
shared delivery-error sink. The flow-recorder channel uses footprintjs event
types. These remain adapter dependencies; no upstream module depends on an
internal owner, and no owner imports the facade.

The original closures share per-strategy maps, the lazily cached tracer/API,
captured configuration switches, and the strategy's replaceable error hook.
The split preserves those references. It adds no promise, run selector,
public alias, content policy, or new cache. The existing fixtures pin complete
span output, including parent links, field insertion order and error status.
