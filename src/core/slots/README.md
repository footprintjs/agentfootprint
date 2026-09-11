**Mixed** — two slot builders resolve what the model is served; the third is a
record of it.
Lens: `buildSystemPromptSlot.ts` (joined into the prompt by
`../agent/stages/callLLM.ts` · `systemPrompt`) and `buildToolsSlot.ts` (the
served tool list, the `read_skill` offer, the step narrowing, and the
`hiddenSkillIds` publication in `buildToolsSlot.ts` · `discoverStage`).
Trace: `buildMessagesSlot.ts` — its own header says it is not the wire but the
observability projection of the conversation.
Correction to the text below: the three slots are not the whole wire. The
request is assembled in `../agent/stages/callLLM.ts` · `buildCallLLMStage` —
messages come from `scope.history` (`callLLM.ts` · `messages`), the tool list is
EMPTIED on the wrap-up (`callLLM.ts` · `registeredToolSchemas`, the
`scope.wrapUpAsked` arm that yields `EMPTY_TOOL_SCHEMAS`; the other arm is the
`scope.dynamicToolSchemas` fallback), and the staged-refs nudge is appended by
`callLLM.ts` · `wireMessages` without passing through any slot.

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

## The offer and the answer — one party per tool name (9.92.0)

**Why.** At every LLM call the model is OFFERED a list of tool contracts (the
wire; the receipt hashes each one). When the model calls a name, something
ANSWERS. Until 9.92.0 those two halves could come from different parties: the
tools slot merges `[static, provider, skill, step]` first-occurrence-wins, while
dispatch consulted a build-time map first — so a provider's contract on the
wire could be answered by a skill's `execute` (an inactive skill's, even), a
provider's `skip_step` by the framework's, and a claimant that lost both could
be dead with nothing on the record (`docs/design/2026-09-recorded-not-built.md`,
entries 1–3 and the `claim-swallowed` family).

**The law.** For every tool name on a call, exactly one party owns the OFFER
and the same party owns the ANSWER — or the record names the disagreement.
`buildToolsSlot.ts` · `mergeWire` is the one pass that produces the wire AND
the record of who won each name (`ServedToolParties`); `toolCalls.ts` ·
`lookupTool` reads that record first. Three consequences, one example each:

1. **Dispatch follows the offer.** A name on the wire resolves to the party
   whose contract the model read. A name NOT on the wire (held out by a step,
   a park or a scoping; named from a restored transcript) still dispatches —
   the capability law's held-out clause (`test/core/agent/epoch-laws.test.ts`
   1(a)–(e)) — but only to the party the model LAST read the name under, or
   the name's only holder when it was never served this run; every such
   dispatch is on the record as `agentfootprint.tools.answered_off_wire`. A
   name whose last-served party can no longer answer (a provider withdrew it)
   is refused as a recorded tool result (`toolCalls.ts` · `notServedResult`),
   never handed to a party the model was not shown under that name.

   ```ts
   // provider + a scoped skill both claim `shared_tool`; the skill never activates
   Agent.create({ provider, model })
     .toolProvider(staticTools([providerShared]))
     .skill(defineSkill({ id: 'desk', body: 'B', tools: [skillShared] }))
     .toolsFromActiveSkill();
   // the wire carries the PROVIDER's contract → the PROVIDER's execute answers.
   // The skill's execute answers no call while the provider holds the name —
   // and not after the provider withdraws it either: that call is refused,
   // because the skill's contract was never what the model read.
   ```

2. **The report's subject is the wire.** `agentfootprint.tools.shadowed`
   fires once per contested name per iteration when two contracts COMPETED
   for the wire; `schemaFrom` and `dispatchTo` both name the wire's party
   (they agree, by construction). Identity is by implementation: two skills
   sharing ONE `Tool` reference are one claim and draw nothing.

   ```ts
   // an always-visible stepped skill and a provider both claim `shared_tool`
   Agent.create({ provider, model })
     .skill(defineSkill({ id: 'desk-stepped', body: 'S', tools: [skillShared],
                          steps: [{ tool: 'shared_tool', note: 'the only step' }] }))
     .toolProvider(staticTools([providerShared]));
   agent.on('agentfootprint.tools.shadowed', (e) => console.log(e.payload));
   // { toolName: 'shared_tool', iteration: 1, schemaFrom: 'skill', schemaFromId: 'desk-stepped',
   //   dispatchTo: 'skill', dispatchToId: 'desk-stepped' }   — never 'provider', which is
   // what the pre-9.92.0 report asserted from the wrong list.
   ```

3. **A dead claim is reported.** `agentfootprint.tools.claim_swallowed`
   fires once per iteration for every party whose claim to a name is held by
   somebody else — whether its contract competed (the skill in example 1
   once activated) or never reached the merge (the same skill while
   inactive; the framework's `skip_step` between tenures; a provider tool
   whose name a static `.tool()` owns). `{ toolName, lostBy, lostById?,
   wonBy, wonById?, iteration }`, names only.

   ```ts
   agent.on('agentfootprint.tools.claim_swallowed', (e) =>
     console.log(e.payload); // { toolName: 'shared_tool', lostBy: 'skill', lostById: 'desk', wonBy: 'provider', wonById: 'static', iteration: 1 }
   );
   ```

`skip_step` is a claimant like any other: the framework's schema merges LAST,
so it rides only when nobody else put the name forward; when a provider does,
the provider answers and the step bookkeeping (`toolCalls.ts` ·
`frameworkSkipStepAnswered`) does not advance the procedure. A run with no
name collision commits byte-identical logs and served views
(`test/core/tools/byte-identity.test.ts`, fifteen references generated on 9.91.0,
a shared-reference pair among them).
