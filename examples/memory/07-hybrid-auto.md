---
name: Hybrid — compose recent + facts + causal snapshots
group: memory
guide: ../../src/memory/README.md
defaultInput: What do you know about my recent loan application?
---

# Hybrid — production-grade memory composition

Stack multiple memory types on a single agent. Each call to
`.memory()` mounts an independent read+write subflow with its own
scope key (`memoryInjection_${id}`) so they never collide.

## The 3-layer "auto" stack

```ts
Agent.create({ provider })
  .memory(recent)    // fast, short-term — episodic + window
  .memory(facts)     // structured, dedupable — semantic + extract
  .memory(causal)    // cross-run replay — causal + topK
  .build();
```

| Layer | Purpose | Cost per turn |
|---|---|---|
| **Recent** | Last N turns of THIS conversation | ~0 (no LLM, no embedding) |
| **Facts** | Cumulative profile (name, plan, prefs) | Pattern: ~0; LLM: ~$0.001 |
| **Causal** | Decision evidence from PAST runs | One embedding call |

## Why three separate registrations (not one HYBRID strategy)?

The `MEMORY_STRATEGIES.HYBRID` strategy composes sub-strategies on a
**single store**. Real production wants **DIFFERENT stores per layer**:

- Recent → Redis (hot, ephemeral, fast)
- Facts → Postgres (durable, queryable)
- Causal → vector store + S3 (semantic + cheap blob storage)

Three `.memory()` calls match three storage backends naturally. Each
layer evolves independently — swap Redis for Memcached without
touching the facts layer.

## Registration order = injection order

Memories inject into the system prompt in the order they're
registered:

```
.memory(recent)  →  appears first   (gives the LLM "what just happened")
.memory(facts)   →  appears second  (gives "what's stable about the user")
.memory(causal)  →  appears third   (gives "what we decided last time")
```

Recommended order: **most-recent first → most-relevant last**, so the
LLM reads recency before drilling into specifics.

## Multi-store, multi-tenant

Each store handles `MemoryIdentity` independently. Forgetting one
identity (`store.forget({tenant, principal, conversationId})`)
cascades within that store but not across — make GDPR right-to-erasure
sweep all stores explicitly:

```ts
async function forgetUser(identity: MemoryIdentity) {
  await Promise.all([
    recentStore.forget(identity),
    factsStore.forget(identity),
    causalStore.forget(identity),
  ]);
}
```

## Lens

Each registered memory shows up as **its own chip** in the system
prompt slot. Hover reveals which strategy fired, how many entries
matched, and (for Causal) the cosine score of the past snapshot
that surfaced.

## When NOT to use hybrid

- **Dev / single-user demos** — pick one of the simpler strategies
  ([Window](./01-window-strategy.md) is the default)
- **Latency-critical paths** — three layers means three subflow
  boundaries. Profile before adding all three.
- **Compliance with strict data minimization** — fewer stores = fewer
  audit surfaces.

## Cost-aware tuning

Production checklist:
- [ ] Recent: cheap → always on
- [ ] Facts: pattern extractor first; upgrade to LLM only if recall
      is too low
- [ ] Causal: turn on threshold strict (0.7+); irrelevant past
      snapshots don't justify the embedding spend
- [ ] Eval the agent WITH and WITHOUT each layer — drop layers that
      don't move metrics

## Related

- All other strategies — Hybrid composes them
- **[Causal](./06-causal-snapshot.md)** — the unique-to-us layer
- [agentfootprint_memory_store_adapters.md](../../docs/store-adapters.md) — backends per layer
