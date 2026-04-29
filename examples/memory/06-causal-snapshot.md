---
name: Causal memory — store footprintjs snapshots, replay decisions
group: memory
guide: ../../src/memory/causal/
defaultInput: Why was my application rejected last week?
---

# Causal — the differentiator no other library has

`agentfootprint` captures decision evidence as first-class events
during traversal (via footprintjs's `decide()` / `select()` and the
commit log). **Causal memory persists those snapshots** so the agent
can replay them on follow-up questions — answering from EXACT past
facts instead of re-deriving reasoning.

```
┌── Turn 1 (Monday) ─────────────────────────────────────────┐
│   user: Should I approve loan #42? score=580 dti=0.45      │
│   agent: → decide()                                        │
│           rule "tier-A" didn't match (score < 600)         │
│           rule "manual-review" didn't match (dti > 0.43)   │
│           defaulted to "rejected"                          │
│   final: "Rejected. score=580 below threshold of 600."     │
│   ╰─→ snapshot stored, indexed by query embedding          │
└────────────────────────────────────────────────────────────┘

┌── Turn 2 (Friday — DIFFERENT conversation) ───────────────┐
│   user: Why was my application rejected last week?        │
│   ↓ embed query → cosine search → find Monday snapshot    │
│   ↓ inject DECISIONS projection                           │
│   agent: "Rejected because creditScore=580 was below      │
│           the threshold of 600. The 'manual-review' rule  │
│           didn't trigger because dti=0.45 exceeded 0.43." │
└───────────────────────────────────────────────────────────┘
```

**Zero hallucination**, because the LLM reads the actual decision
evidence — it doesn't reconstruct.

## Why no other library has this

| Library | Stores | What's missing |
|---|---|---|
| LangGraph | Checkpoints (state) | No reasoning chain |
| Strands | Conversations (messages) | No decision evidence |
| OpenAI Assistants | Threads | Opaque reasoning |
| **agentfootprint** | **Snapshots with `decide()` evidence** | — |

Other libraries can't add this without rebuilding their core.
`footprintjs` was designed for explainability from day one — capturing
WHY (decisions + commit log) alongside WHAT (state) — and Causal
memory persists that.

## Anatomy

```ts
import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
} from 'agentfootprint';
import { openaiEmbedder } from '@some-embedder-pkg';

const causal = defineMemory({
  id: 'causal',
  type: MEMORY_TYPES.CAUSAL,
  strategy: {
    kind: MEMORY_STRATEGIES.TOP_K,
    topK: 1,                            // best-matching past run only
    threshold: 0.7,                     // strict — drop weak matches
    embedder: openaiEmbedder({ model: 'text-embedding-3-small' }),
  },
  store: new InMemoryStore({ embedder: openaiEmbedder({...}) }),
  projection: SNAPSHOT_PROJECTIONS.DECISIONS,
});
```

## Four projection modes — choose how much past detail to inject

| `SNAPSHOT_PROJECTIONS.X` | What gets injected | Use when |
|---|---|---|
| `DECISIONS` | `decide()`/`select()` evidence + final answer | "Why?" follow-ups (default) |
| `NARRATIVE` | Rendered prose narrative of the run | Explaining at length |
| `COMMITS` | Per-stage state writes | Detailed audit |
| `FULL` | Entire snapshot (use sparingly) | Debugging / replay |

## The training-data bonus (v2.1+)

The snapshot data shape **IS** what RL/SFT/DPO pipelines need:

```
SnapshotEntry {
  query:        // user's question     ← SFT prompt
  finalContent: // agent's answer      ← SFT completion
  decisions:    // why                 ← process-RL trajectory
  toolCalls:    // tool trace          ← tool-use RL data
  evalScore:    // attached by         ← RLHF/DPO ranking
                //   evalRecorder
}
```

Every production run becomes a labeled trajectory. v2.1 adds
`causalMemory.exportForTraining({ format: 'sft' | 'dpo' | 'process' })`
to project this into HuggingFace / OpenAI / Anthropic fine-tune
formats. See [agentfootprint_causal_memory_for_training.md](../../docs/training.md).

## Strict threshold — same as Top-K

```ts
threshold: 0.7   // when no past snapshot meets this, return EMPTY
```

No fallback. **Garbage past context primes the LLM toward a wrong
answer**, worse than no context.

## Compliance / GDPR

`MemoryStore.forget(identity)` cascades to causal snapshots —
right-to-erasure works the same as for any other memory type. Causal
storage is bound by the same `MemoryIdentity` tuple
(`tenant / principal / conversationId`) so audit + isolation are
identical.

## Related

- **[Top-K](./04-topK-strategy.md)** — semantic recall for raw text
- **[Extract](./05-extract-strategy.md)** — distill facts on write
- **[Hybrid](./07-hybrid-auto.md)** — combine causal + recent + facts
