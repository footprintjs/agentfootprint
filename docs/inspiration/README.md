# Inspiration

The academic shoulders agentfootprint stands on, organized into two pillars.

```
                THE WHY                          THE HOW
        (user-visible win)              (engineering discipline)
              ▼                                   ▼
   ─────────────────────────         ─────────────────────────
        Connected data                Modular boundaries
       (Palantir lineage)           (Liskov ADT + LSP lineage)
   ─────────────────────────         ─────────────────────────
              ▼                                   ▼
   Fewer iterations to find        Clean boundaries make
   the answer · less re-work       connection tractable
```

## Pages

| Pillar | Page | One-line summary |
|---|---|---|
| **THE WHY** | [connected-data-palantir.md](./connected-data-palantir.md) | Palantir's 2003 thesis (connect data, not analysts) returns at agent runtime. Disconnected state burns iterations and tokens. agentfootprint connects four classes of agent data (state · decisions · execution · memory). |
| **THE HOW** | [modularity-liskov.md](./modularity-liskov.md) | Liskov's ADT + LSP work, applied to flowcharts. Subflows are CLU clusters. CacheStrategy / LLMProvider / ToolProvider are LSP-substitutable. Locality of reasoning is enforced as a runtime invariant. |
| **THE SCALING SPINE** | [strategy-everywhere.md](./strategy-everywhere.md) | Strategy + Bridge + Hexagonal + Algebraic-Effects, applied as ONE pattern across cache / observability / cost / status / lens. v2.6 cache layer is the proof-of-concept; v2.8 generalizes it. AWS-first vendor priority (AgentCore observability → CloudWatch → X-Ray). |

Future entries (planned): the ReAct paper · Parnas information hiding · Hewitt actors · Anthropic Skills · flow-based programming.

## How to read these

These pages are the **rationale** behind the library design — they're written for:

- Contributors who want to understand WHY a boundary is shaped the way it is before changing it
- Library evaluators comparing frameworks at the architectural level
- People who want to learn from the same sources we learned from

If you just want to use the library, start at [`docs/guides/quick-start.md`](../guides/quick-start.md) instead. The inspiration pages are not required reading.

## Why these two pillars together

Liskov gives us **boundaries that don't leak** — every framework interface is substitutable, every subflow hides its internals.

Palantir gives us **connections within those boundaries** — the agent can follow a thread across stages without re-discovering it on every iteration.

Boundaries alone produce a clean but dumb library. Connections alone produce a fast but unmaintainable one. Both together is the design.
