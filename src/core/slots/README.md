# `src/core/slots/` — the 3-slot context model

## What lives here

The three slot subflow builders — one per context slot an LLM API receives.

```
slots/
├── buildSystemPromptSlot.ts    Resolves the system-prompt content.
├── buildMessagesSlot.ts        Resolves the conversation history.
├── buildToolsSlot.ts           Resolves the tool schemas.
└── helpers.ts                  Shared utils (fnv1a, truncate, breakdown, composeSlot).
```

## The 3-slot abstraction

Every LLM API call accepts exactly three payloads:

| Slot | Role | Example source |
|---|---|---|
| **SystemPrompt** | Who the LLM is, what rules it follows | Static instruction, skill body, RAG-injected context |
| **Messages** | The conversation history | User message, assistant responses, tool results |
| **Tools** | Which tools the LLM can call | Static registry, dynamic per-iteration filtering |

Nothing else exists at the LLM wire. Every piece of content the agent engineers lands in one of these three slots — this is THE abstraction the library is built on.

## Architectural decisions

### Decision 1: Each slot is a subflow, not a stage

A slot subflow mounts with a well-known ID (`sf-system-prompt`, `sf-messages`, `sf-tools` from `conventions.ts`). ContextRecorder pattern-matches on those IDs to detect slot boundaries and emit `context.slot_composed` at exit.

Using a subflow (even one-stage) gives us:
- A detectable boundary for recorders
- Isolated scope so slots can't accidentally trample each other
- Drill-down visualization for free

### Decision 2: Slots write to CONVENTION SCOPE KEYS, not typed fields

Inside each slot, the compose stage writes:

```typescript
scope.$setValue(INJECTION_KEYS[slot], injections);           // InjectionRecord[]
scope.$setValue(COMPOSITION_KEYS.SLOT_COMPOSED, summary);    // SlotComposition
```

The keys come from `conventions.ts`. The shape comes from `recorders/core/types.ts`. **ContextRecorder reads these exact keys** — that's the builder↔recorder protocol.

This decoupling means slot implementations can evolve independently of the recorder. New source (e.g. RAG + rerank) appends InjectionRecords with `source: 'rag'` and the recorder picks it up with zero change.

### Decision 3: InjectionRecord carries *evidence*, not just *outcome*

Every injected piece records the why:

```typescript
interface InjectionRecord {
  contentSummary: string;    // WHAT (redaction-safe)
  rawContent?: string;        // WHAT (full content, redacted upstream if needed)
  contentHash: string;        // Stable id for dedup
  slot: ContextSlot;          // WHERE — one of 3 slots
  source: ContextSource;      // FROM — rag / skill / memory / instructions / user / tool-result / custom
  asRole?: ContextRole;       // messages: system | user | assistant | tool
  asRecency?: ContextRecency; // messages: latest | earlier
  sectionTag?: string;        // system-prompt: XML-ish section tag
  reason: string;             // WHY — human-readable justification
  retrievalScore?: number;    // WHY — numeric evidence
  rankPosition?: number;
  threshold?: number;
  budgetSpent?: { tokens: number; fractionOfCap: number };
  expiresAfter?: ContextLifetime;  // iteration | turn | run | persistent
}
```

The `reason` + `source` + `score` fields turn "the LLM saw X" into "the LLM saw X because RAG retrieved it with score 0.92 from the customer-support index." That's the debugging gold context engineering requires.

### Decision 4: Slot budgets are per-slot, explicit, reported

Every `SlotComposition` record carries `{ cap, used, headroomChars }`. The recorder emits `context.slot_composed` at slot exit. When drops happen (overflow), they're reported in `droppedSummaries`.

This gives the consumer a per-iteration, per-slot view of "what did we try to put in, what fit, what got dropped, what's the headroom." No guessing.

### Decision 5: `inputMapper` / `outputMapper` on the mount, NOT global scope

Slot subflows have isolated scope — they receive a typed input via `$getArgs()` and the parent reads results via `outputMapper`. Parent scope is never shared implicitly.

This makes slot subflows independently testable and prevents cross-slot state leaks.

## How ContextRecorder reads this

ContextRecorder observes at the footprintjs recorder layer:

1. `onSubflowEntry(event)` — if `subflowId` is a slot ID (`sf-system-prompt`, `sf-messages`, `sf-tools`), push onto the active-slot stack.
2. `onWrite(event)` — if `key` matches `INJECTION_KEYS[activeSlot]`, diff against seen hashes and emit `context.injected` for each new entry.
3. `onWrite(event)` — if `key` matches `COMPOSITION_KEYS.SLOT_COMPOSED`, emit `context.slot_composed`.
4. `onSubflowExit(event)` — pop the active-slot stack.

Consumer sees a clean stream of `context.*` events with full evidence. No raw scope inspection required.

## When to add a new slot source

New source = new value in `ContextSource` enum + slot builders that produce `InjectionRecord`s with that source. Examples planned for Phase 5:

- `rag` — retrievals with `retrievalScore` + `rankPosition`
- `skill` — skill-activated content with `sourceId` = skill id
- `memory` — stored memories with `sourceId` = memory id, optional `retriever`
- `instructions` — guidance rules with `sectionTag`
- `tool-result` — tool outputs with `sourceId` = toolCallId, `asRole = 'tool'`

Adding a new source is non-breaking (the recorder is source-agnostic).
