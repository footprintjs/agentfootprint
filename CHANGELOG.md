# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [9.1.0] - 2026-08-08

**The index stops half-reading a chunk and calling it success.**

Round three of the same production field report. `indexCorpus` defaulted its
`maxChunkChars` — how much of a chunk the embedder actually reads — to **2,000
characters for every embedder**, because that is the measured cliff of the
on-device `localEmbedder`. The integration was running `byHeading({ maxChars:
2500 })` against an embedder whose real window is 8,192 tokens. Result:
**6 of 26 chunks embedded CLIPPED** — indexed by their opening, stored and
served whole as the passage — so retrieval could not find wording plainly
visible in the `<source>` block the model was shown. Nothing threw. Nothing
scored zero. The box's own two defaults simply disagreed with each other, and
the disagreement was invisible.

### The ceiling is declared by the embedder — `Embedder.maxInputChars`

The number lives where the knowledge is. An indexer's own default is a guess
about a backend it has never met, so it has to be the smallest ceiling any
embedder might have — which then cuts every larger embedder short.

`Embedder` gains an optional `maxInputChars`: the longest input, in
characters, that this embedder represents faithfully. Every shipped embedder
fills it in:

| embedder | `maxInputChars` | where the number comes from |
|---|---|---|
| `localEmbedder()` | `2000` | measured — the default model's 512-wordpiece-token cliff |
| `openaiEmbedder()` | `32000` | the documented 8,191-token window, at 4 characters a token |
| `bedrockEmbedder()` | `32000` | Titan's documented 8,192-token window, same conversion |
| `staticEmbedder()` | `1000000` | no transformer, so no context window — nothing is ever clipped |
| `mockEmbedder()` | `1000000` | reads every character in a loop |

`indexCorpus`, `indexFolder` and `indexDocuments` read the embedder's declared
ceiling **in preference to** their own 2,000-character default. An explicit
`maxChunkChars` on the call still wins over both — you are allowed to know your
corpus is denser than the arithmetic assumes. An embedder that declares nothing
gets today's behaviour exactly, unchanged.

Three deliberate limits, stated rather than hidden: the characters-per-token
figure is an **assumption** (4, the English-prose rule of thumb — code, tables
and CJK tokenise denser, which is what `maxChunkChars` is for); a model this
library does not know declares **no** ceiling rather than a guessed one, the
same rule `.dimensions` already applies; and `localEmbedder({ maxInputChars })`
is accepted because the cliff belongs to the **model**, not to the factory.

### Truncation became visible

A run that clipped anything now says so — **once**, on `console.warn`, naming
the count, the ceiling in effect *and where that ceiling came from*, and the
two fixes (re-split smaller, or raise `maxChunkChars`). `IndexReport` gains
**`truncatedCount`** beside the existing `truncated` list: the list is what you
debug with, the count is what you assert on and what a dashboard row can hold.
`indexDocuments` — which returns a count and has no report — warns on the same
terms, with fix advice appropriate to a door that does not split.

The list has been in the report since 8.10.0. Nobody reads a report that says
everything went fine, which is exactly how this survived a week of real
traffic: an invisible failure is indistinguishable from success.

### Behaviour changes

- **A corpus indexed with a hosted embedder and a raised splitter ceiling now
  embeds whole where it used to clip.** Chunk content hashes are unchanged, so
  an incremental re-index will NOT re-embed on its own — force a re-index (or
  change the `embedderId`) if you were affected, since the stored vectors are
  the clipped ones.
- **`console.warn` fires from `indexCorpus` / `indexDocuments`** when something
  was clipped. Runs that clip nothing are as silent as before.
- **`IndexReport` has one more field.** Additive; code reading the report is
  unaffected unless it constructs one.

### Docs

The splitter's `maxChars` and the indexer's `maxChunkChars` are now documented
**together**, on the [indexing](docs-next/content/docs/build/indexing.mdx) page,
in the [RAG guide](docs-next/content/docs/build/rag.mdx), on the
[embedders](docs-next/content/docs/build/embedders.mdx) page and in both
docstrings — because each is safe alone and they only collide when a consumer
raises the splitter's ceiling, which is precisely what the field did.

## [9.0.0] - 2026-08-08

**The 8.x deprecation ledger, executed. Nothing new; nothing behaves
differently. Names that had a replacement now have only the replacement.**

8.0.0 consolidated 26 export subpaths into 10 doors and promised every old path
would keep working for all of 8.x. It did. This release collects on the other
half of that promise: sixteen alias subpaths leave `package.json`, and every
option, string, method and field that shipped an 8.x deprecation notice is
removed with it.

There is no new capability here and no changed behaviour. **If your code has no
deprecation warnings on 8.20.0, it compiles and runs unchanged on 9.0.0.**

### Removed — the sixteen door aliases

Each removed path re-exported the *same symbols* the door carries, never copies,
so this is a find-and-replace on import lines. No name moved; no name was lost.

| you were importing from | import from |
|---|---|
| `agentfootprint/llm-providers` | `agentfootprint/providers` |
| `agentfootprint/embedders` | `agentfootprint/providers` |
| `agentfootprint/tool-providers` | `agentfootprint/providers` |
| `agentfootprint/thinking` | `agentfootprint/providers` |
| `agentfootprint/memory-providers` | `agentfootprint/memory` |
| `agentfootprint/observability-providers` | `agentfootprint/observe` |
| `agentfootprint/strategies` | `agentfootprint/observe` |
| `agentfootprint/stream` | `agentfootprint/observe` |
| `agentfootprint/status` | `agentfootprint/observe` |
| `agentfootprint/locales` | `agentfootprint/observe` |
| `agentfootprint/debug` | `agentfootprint/observe` |
| `agentfootprint/debug/finders` | `agentfootprint/observe` |
| `agentfootprint/observability/contextError/finders` | `agentfootprint/observe` |
| `agentfootprint/hosting-providers` | `agentfootprint/hosting` |
| `agentfootprint/injection-engine` | `agentfootprint/context` |
| `agentfootprint/identity` | `agentfootprint/security` |

What ships now is exactly: the root barrel, the ten doors (`/providers`,
`/memory`, `/rag`, `/cache`, `/observe`, `/events`, `/context`, `/resilience`,
`/hosting`, `/security`), one retained alias (`/reliability`, below), and
`./package.json`. `typesVersions` was trimmed in lockstep — a stale row there is
the quiet failure mode where the editor types a path Node refuses.

`test/api-conformance/door-aliases.test.ts` pins the absence of all sixteen and
drives the TypeScript checker over the shipped `.d.ts` files to prove each door
still carries every name it absorbed; `test/api-conformance/subpath-exports.test.ts`
pins the two manifest tables and proves, by object identity, that each absorbed
implementation barrel is served by its door as the same object.

### Removed — options, strings, methods, fields

| removed | replacement | since |
|---|---|---|
| `AgentBuilder.recorder(rec)` | `AgentBuilder.watch(rec)` — same list, same order, same attachment, and variadic | deprecated 8.0.0 |
| `defineSkill({ viaToolName })` | drop it — `'read_skill'` is the only activation tool the library builds; gate on a `rule` trigger or a `skillGraph()` edge | deprecated 8.7.0 |
| `skillsFromDir(dir, { viaToolName })` | drop it — same reason | deprecated 8.7.0 |
| `WindowRefusalReason` member `'summary-not-smaller'` | `'replacement-not-smaller'` | renamed 8.14.0 |
| type `FoldRefusal` | `WindowRefusal` | renamed 7.17 |
| type `FoldRefusalReason` | `WindowRefusalReason` | renamed 7.17 |
| `WindowStrategy` exported from `agentfootprint/memory` | `MemoryWindowStrategy` | renamed 7.27.1 |
| `CompactionRecord.foldedStageIds` | `WindowRecord.removedStageIds` | family name published 7.17 |
| `CompactionRecord.foldedMessageCount` | `WindowRecord.removedMessageCount` | family name published 7.17 |
| `ContextBudgetPressurePayload.capTokens` | `cap`, read with `unit` | renamed 8.14.0 |
| `ContextBudgetPressurePayload.projectedTokens` | `projected`, read with `unit` | renamed 8.14.0 |
| `BudgetPressureRecord.capTokens` | `cap`, read with `unit` | renamed 8.14.0 |
| `BudgetPressureRecord.projectedTokens` | `projected`, read with `unit` | renamed 8.14.0 |

Three of those are worth a sentence each, because the *reason* is the migration:

- **`viaToolName` named a door that was never built.** The evaluator activates
  an `llm-activated` skill by matching `ctx.activatedInjectionIds`, only
  `read_skill` writes that array, and nothing ever read the field. 8.7.0 made a
  non-`'read_skill'` value a mount-time refusal; 9.0.0 deletes the option. Even
  `viaToolName: 'read_skill'` is refused — the option is gone, not narrowed, and
  a caller passing the default is still a caller who believes it does something.
  The **mount** refusal from 8.7.0 stays, because an injection can reach an agent
  without passing through the factory (a hand-built object, or one deserialized
  from an 8.x artifact).
- **`capTokens` / `projectedTokens` asserted a unit the channel does not use.**
  The three context slots emit `agentfootprint.context.budget_pressure` counting
  CHARACTERS, a window strategy emits the same event counting TOKENS, and
  `contextBudget` is on by default — so one subscriber routinely got both, and
  "cap 200" could mean either. 8.14.0 added `unit` + `cap` + `projected` beside
  the old pair; 9.0.0 keeps only the honest three. `cap` / `projected` are now
  **required** on `BudgetPressureRecord` (a record carrying neither pair would be
  a record with no numbers on it); `unit` stays optional there and required on
  the payload, so a third-party slot builder still compiles and a consumer can
  always answer what was counted. The strategy-facing seam
  (`WindowStrategyResult.budgetPressure`) keeps its own `capTokens` spelling on
  purpose — a strategy declares its own `unit`, so there the name is honest.
- **`foldedStageIds` / `foldedMessageCount` were fold-flavoured names on a family
  field.** They live on `WindowRecord`, which every window strategy writes, and
  only one of the three shipped strategies folds anything — so the alias made
  `slidingWindow` and `tokenBudget` read like they were missing a field.

### Three grace errors, deleted in 10.0.0

`AgentBuilder.recorder()`, `defineSkill({ viaToolName })` and
`skillsFromDir(…, { viaToolName })` keep their NAMES for one major as throwing
stubs. Each throws at build/definition time — before any run, so the failure is
deterministic and lands in development — with a message that names the
replacement and says when the signpost comes down.

Deleting the type member alone would have been a silent DOWNGRADE for the two
`viaToolName` cases: an object literal gets an excess-property error, but an
options bag arriving through a variable does not, and the value would then be
*ignored* where 8.7.0 refused it. So the field is read at run time exactly once
more, to say it is gone.

### Two things deliberately kept

- **`agentfootprint/reliability` survives.** It is the only home of the
  reliability GATE's `CircuitOpenError` — a different class from the provider
  decorator's `CircuitOpenError` that `/resilience` carries, with a different
  constructor and a different `instanceof` answer. Removing the path would not
  rename that class; it would make it unreachable, and a consumer could no
  longer `instanceof`-check the error their own gate throws. The full alias
  discipline still applies to it, scoped to that one exception plus
  `CircuitState`, which is declared in both breaker files as
  `'closed' | 'open' | 'half-open'` — two declarations, one type, pinned as such.
- **`buildRunSteps(events)` survives, still `@deprecated`.** Its deprecation is
  a *preference*, not a migration: live consumers should attach
  `runStepRecorder()` and read `getSteps()` (O(N), the house pattern) instead of
  re-walking an event log (O(N²) across repeated calls). But the shim is the only
  way to build steps from a saved event list — replay, post-hoc analysis, tests —
  and no recorder can do that job, so removing it would delete a capability
  rather than a spelling. It stays until something replaces the use case.

### Two ledger items that needed no work

Named here so the ledger is closed honestly rather than quietly:

- **Typestate builder one-shots.** No `@deprecated` typestate marker exists in
  `src/`. The builder's "set twice" guards (`.compaction()`, `.window()`) are
  live refusals, not deprecations — nothing to remove.
- **Budget-picker ordering.** No deprecated ordering option exists in `src/`.
  `RetrievalEvidence.selectionOrder` is a documented current field, not a
  transitional one — nothing to remove.

### Upgrading

1. Rewrite import lines against the door table above. Nothing else in the file
   changes — every name is the same symbol on the new door.
2. `.recorder(` → `.watch(`.
3. Delete every `viaToolName`.
4. `capTokens` → `cap`, `projectedTokens` → `projected` (and read `unit`);
   `foldedStageIds` → `removedStageIds`, `foldedMessageCount` →
   `removedMessageCount`; `'summary-not-smaller'` → `'replacement-not-smaller'`;
   `FoldRefusal[Reason]` → `WindowRefusal[Reason]`; `WindowStrategy` from
   `agentfootprint/memory` → `MemoryWindowStrategy`.

## [8.20.0] - 2026-08-07

**The corpus stops promising what it does not contain.**

Round two of the same production field report that drove 8.19.0 — the same
integration, now running all four of those fixes, coming back with what the
next week of real traffic found. Three findings again, and the first one is
the reason this release exists: the default splitter could manufacture the
exact chunk shape that makes a model fabricate a citation.

### A heading is a label, not a passage — the splitter floor

`byHeading()` emitted heading-only and heading-plus-preamble chunks, and those
chunks do not retrieve badly — they retrieve **too well**. Similarity is a
density measure: a heading plus one preamble sentence concentrates its topic's
vocabulary with none of its substance. Measured in the field: a 180-character
chunk (`## Findings` plus one sentence promising them) outranked the
1,032-character body of its own section at 0.430. The model was handed a
passage that PROMISES findings, contains none — and fabricated a plausible
file path to fill the gap. A fabricated citation born entirely from a
chunking default.

The fix is one coherent rule across the structural splitters:

- **`minChars` — a floor, merged FORWARD.** `byHeading` and `byParagraph`
  take a `minChars` option, default `min(250, maxChars / 4)` — 250 at the
  default target, ~60 tokens, comfortably above the measured 180-character
  failure and a quarter of the target so merged chunks (short section + full
  neighbour ≈ 1,250 chars ≈ 310 tokens) stay far inside the measured
  512-wordpiece embedder cliff. A section whose body is under the floor joins
  the NEXT chunk **under its own heading** — the preamble sentence survives,
  leading the chunk it introduces, and the citation still names the section a
  reader would look up. Nothing is ever dropped. Adjacent shorts whose bodies
  together clear the floor become one chunk of their own; a trailing short
  merges backward (the one edge with no next); a document that is one short
  section ships whole.
- **Heading-plus-whitespace is never emitted, unconditionally.** Even at
  `minChars: 0`. A chunk with no body is a coordinate, not a passage — the
  same distinction `indexDocuments` enforces one layer up when it refuses a
  passage-less document. A document that is nothing but headings yields no
  chunks at all.
- **The long-section variant of the same bug is closed.** A section too long
  to fit whole used to pack its heading LINE as its own paragraph unit — and
  when the first body paragraph could not pack with it, the heading shipped
  alone. The heading is now glued to the first body paragraph; it can never
  again be a chunk by itself.
- **The family was inspected, and two members are exempt by design.**
  `fixedWithOverlap` cuts uniformly sized chunks *by request* — imposing a
  250-char floor on `fixedWithOverlap({ chars: 120 })` would repeal the
  caller's own choice, and its only runt (the file tail) has always folded
  backward. `wholeDocument` is one chunk per document by definition.

**LOUD behaviour change: re-indexing an existing corpus produces different
chunks.** Incremental re-index will re-embed where boundaries moved (content
hashes change) — that is the fix working, not a regression. Today's default
can fabricate citations; the new default cannot ship the chunk shape that
did. Pin `minChars: 0` only if you must reproduce the old cuts, and know that
heading-only chunks are refused regardless. Two smaller consequences, named:
a chunk may now exceed `maxChars` by up to the floor (in addition to the
overlap) when a short neighbour merged into it, and `minChars ≥ maxChars` is
refused as the configuration contradiction it is.

### A recording keeps a vector's shape, not its bytes

One retrieval turn's recording measured **2.76 MB — about 1.1 MB of it
embedding floats.** The memory-read subflow's boundary output carries each
retrieved entry, and each entry carried its full vector; the snapshot's
subflow results then carried the same entries again through every state
mirror the engine keeps. Nobody reads those floats: retrieval debugging needs
the score, the passage, the document, and the rejected candidates — all in
the retrieval evidence, none of it a vector.

Recordings now keep `{ dims, norm }` where a vector was — dimensionality and
L2 norm, the two facts that make a vector recognisable without shipping its
bytes. Applied uniformly at the recording boundary: `BoundaryRecorder`
subflow/run payloads at capture time, and `recordRun`'s snapshot and event
tail at freeze time, covering both spellings the memory layer writes
(`embedding` on entries, `embeddings` on write-side batches). The projection
is copy-on-write (payloads without vectors pass through by reference,
shared entries stay shared) and idempotent. Live run state, stores, and the
retrieval evidence are untouched — this is about what a RECORDING retains,
not what the run computes with.

**Behaviour change:** recordings are smaller and their `embedding` fields are
summaries. `recordEmbeddings: true` on `recordRun` or `boundaryRecorder`
restores raw vectors for the rare consumer that replays them offline.
`summarizeEmbeddings` / `summarizeVector` / `EmbeddingSummary` are exported
from `agentfootprint/observe` so recording post-processors can apply or
recognise the same projection.

### The corpus as a build artifact — `exportCorpus` / `staticVectorStore`

The field deployment runs on a runtime whose disk does not survive the
process — while its build machine holds both the embedding credentials and a
durable disk. The corpus therefore wants to be an artifact of the BUILD, and
this release gives that shape first-class words (vendor- and runtime-neutral;
any immutable or serverless runtime has this problem):

- **`exportCorpus(store, identity?)`** (`agentfootprint/rag`) — every entry
  of a corpus namespace as one plain-JSON `CorpusBundle`:
  `{ entries: [{ id, text, vector, metadata }], embedder: { id, dimensions },
  namespace }`. Plain JSON on purpose — the runtime that needs this is
  exactly the runtime that cannot open a database file. It refuses an empty
  namespace (naming the identity-mismatch cause), entries with no vector or
  no passage (a bundle never ships an unservable or uncitable entry), and a
  namespace that mixes embedding spaces (no single query embedder could
  search both).
- **`staticVectorStore(bundle, embedder?)`** (`agentfootprint/memory`,
  re-exported from `/rag`) — a read-only `MemoryStore` over the bundle,
  `supportsVectorSearch: true`, ranking by the same cosine as the reference
  store. Every write method refuses teachingly (a static corpus that
  silently accepted writes would lose them with the process). Pass the
  runtime's embedder and a fingerprint mismatch is refused **at load** —
  the `sqliteVectorStore` rule, applied at the door: dimensions always
  decide; ids decide only when both sides named themselves. At search time a
  wrong-length query or a mismatched `embedderId` throws by name instead of
  ranking to an empty page — the loud version of the mismatch machinery
  that already caught this integration's own embedder-id format change.
  Entries are served in the exact shape the retrieval formatter reads
  (passage on `value.content`, provenance under `value.metadata`) — the
  8.19.0 blank-citation lesson, enforced at the seam.
- **`importCorpus(store, bundle, identity?)`** — the inverse, into any
  writable vector-capable store: seed an in-memory corpus at boot, or
  migrate between machines without re-embedding (and re-billing) anything.
- **CLI:** `agentfootprint-index ./docs --to ./corpus.json` builds a bundle
  directly — same pipeline, one JSON artifact for the deploy to carry.

### The threshold docstring learns another embedder's numbers

The `threshold` guidance on `defineRAG` / `topK` (and the rag guide's
threshold section) now carries field-measured score bands for Amazon Titan
Text V2 alongside the existing sentence-transformer note: 0.55–0.57 for a
direct hit, ~0.49 for the right section diluted, 0.36–0.42 for noise — **the
0.7 default retrieves NOTHING on that embedder, silently**; ~0.5 separates
its signal from its noise. One vendor's measured example of the general
rule: the right threshold is a property of the embedder, and the rejected
candidates on `agentfootprint.memory.retrieved` are how you read yours.

## [8.19.0] - 2026-08-07

**The corpus says what it retrieved.**

Four findings from a production RAG deployment — a first-contact report, from
someone building against the published package on a cloud runtime. Three of
them are the same shape: a call that accepted something it could not honour and
reported success anyway. The first is the worst kind of bug this library can
ship, because the run looked like it worked.

### A retrieved passage reaches the prompt with its text in it

The formatter read a chunk's passage from `value.content`. A `Chunk` from this
library's own `agentfootprint/rag` door — `indexCorpus`, `indexFolder`, the
`agentfootprint-index` CLI — keeps its passage on **`text`**. So every corpus
built with the indexing door rendered like this:

```
<source id="refunds.md#3" doc="refunds.md" heading="Refund timing" score="0.87">

</source>
```

Right document, right heading, right score, **no passage**. The model was handed
the coordinates of an answer and not the answer, and nothing in the run said so:
the report said `embedded: 8`, the retrieval record listed the right chunks with
the right provenance, and the agent answered from its own weights while looking
grounded. It was reported from production as "the citation is perfect and the
body is empty", and it was never a corner case — it was every corpus the `rag`
door built.

`chunkText` now reads `content` **or** `text`, so both shapes render (`content`
wins if a value somehow carries both). `indexDocuments` accepts `text` as well
for the same reason, and the repo's own RAG example now prints the passages
alongside the citations, because the two are different claims and only one of
them was being checked.

**Behaviour change:** a document passed to `indexDocuments` carrying **neither**
key is now refused, before anything is embedded:

```
indexDocuments: 1 document(s) carry no passage — neither `content` nor `text`
holds a non-empty string: notes.md#4.
  Indexing them would embed the empty string and store a citable id with
  nothing to cite …
```

An unrenderable passage and an absent one are different facts. The first is now
rendered; the second is refused where it can still be fixed, rather than
discovered months later as a blank citation.

### `maxChars` — a count bound is not a size bound

`topK` says how MANY passages reach the prompt and nothing about how much text
that is. In the field, ten chunks cut by `byHeading()` off ordinary
documentation measured **11,153 characters** against a `systemPrompt` slot whose
default budget is 4,000 — an overflow produced entirely by defaults on both
sides.

`defineRAG({ maxChars })` is the missing bound: a character budget spent across
the retrieved passages in rank order, tail dropped.

```ts
defineRAG({ id: 'docs', store, embedder, topK: 5, maxChars: 2000 });
```

The spend is **recorded, never silent**. Passages past the budget are refused
with the new `reason: 'over-char-budget'` on
`agentfootprint.memory.retrieved`, and the record carries `maxChars` and
`charsUsed` beside the counts it already carried.

`maxChars` has **no default**, and that is a decision rather than an omission.
Defaulting it would mean this release quietly stops injecting passages that
8.18.0 injected — a retrieval regression that reads to a user as "the model
doesn't know that", which is the failure class this library exists to make
loud. Nothing truncates today either: the slot warns once and emits
`agentfootprint.context.budget_pressure`, so a run is already honest about an
over-run. What it lacked was a way to bound one. The two numbers now sit side by
side in the RAG guide, because they live on different objects and the
arithmetic between them is easy to miss: `topK` defaults to **3**,
`contextBudget.systemPrompt` defaults to **4000 characters**, and retrieved
passages share that slot with the system prompt, steering, facts and skill
bodies.

It composes with `retrieval` rather than excluding it (unlike
`topK`/`threshold`): the strategy picks the candidates, `maxChars` bounds their
size. `defineMemory` refuses it on the CAUSAL type, which has no passage pool to
spend a budget across.

It is **not** the splitters' `maxChars`, which bounds one chunk at index time
and defaults to 1000 — that one is why the arithmetic lands where it does. Ten
chunks off a 1000-character splitter is ten thousand characters before a single
`<source>` tag is added, which is the 11,153 above almost exactly.

### A store now declares whether it can serve vectors back

`search()` is optional on `MemoryStore`, so "can this store do vector search?"
was answered by asking whether the method exists. That answers the wrong
question. `AgentCoreStore` **has** a `search()` — it ranks server-side, over the
records the backend's own extraction strategies derived, and never over the
embeddings written into it. Handed one, `indexCorpus` type-checked, ran, embedded
the whole corpus, billed for it, and reported `embedded: 214` over an index
nothing could ever read.

`MemoryStore` gained one declared bit, `supportsVectorSearch`, and the
corpus-building calls read it:

```
indexCorpus: `AgentCoreStore` cannot serve vectors back, so indexing a corpus
into it would report success and retrieve nothing.
  It declares `supportsVectorSearch: false`: its search() ranks on the SERVER's
  side, over a population the backend derived itself …
  Fix:  index into a vector-capable store — InMemoryStore (dev/tests) or
  sqliteVectorStore (durable, one file), …
  Keep `AgentCoreStore` for what it is good at: conversation memory through
  `defineMemory`, where the backend's own retrieval is the point.
```

`indexCorpus`, `buildIndexChart`, `indexFolder` and `indexDocuments` all refuse
it, before a byte is embedded. `InMemoryStore` and `sqliteVectorStore` declare
`true`; `AgentCoreStore` and `RedisStore` declare `false`.

**Behaviour change:** building a corpus into `AgentCoreStore` or `RedisStore` is
refused where it used to run. Neither could ever serve those vectors back —
`RedisStore` has no `search()` at all, so the same mistake already failed one
layer later, when `defineRAG` refused the store *after* the whole index had been
embedded and billed. The refusal moved to the call that starts the spending.

**Absence is not a `false`.** A store that declares nothing behaves exactly as it
did before this existed — which is every adapter written against an earlier
release, including yours. Reading it is opt-in on the adapter's side, and the
refusal only ever fires on a store that asked for it.

### `bedrockEmbedder()` — Titan Text Embeddings V2

A fourth shipped embedder, on `agentfootprint/providers`, next to
`openaiEmbedder` / `localEmbedder` / `staticEmbedder`. Lazy-requires
`@aws-sdk/client-bedrock-runtime` (an optional peer dep, like every other AWS
adapter here), and takes no `apiKey` — Bedrock authenticates through the normal
AWS credential chain, and a second way to configure that is a second way to get
it wrong.

```ts
import { bedrockEmbedder } from 'agentfootprint/providers';

const embedder = bedrockEmbedder({ region: 'us-east-1' });            // 1024-d
const small = bedrockEmbedder({ region: 'us-east-1', dimensions: 512 });
```

Titan V2 returns 1024 dimensions by default and supports 512 and 256. The size
you ask for is sent to the model **and** reported as `.dimensions`, so the two
cannot disagree; a size Titan does not produce is refused, and a model this
library does not know the size of has to state its own.

**Its `id` carries the dimension count** — `bedrock:amazon.titan-embed-text-v2:0:512`
— and that is deliberate, against the usual rule that an embedder id leaves the
size to the store's `<id>@<dims>` fingerprint. Titan V2 at 512 and Titan V2 at
1024 are different embedding spaces from one model id, and the size alone
cannot separate them either, because V1 and V2 both answer at 1024. Entries
store the id **alone** in `embeddingModel`, and that is the only thing the
read-side `embedderId` filter compares — so the size belongs in the id, and a
fingerprint that restates it once is the cheaper mistake.

## [8.18.0] - 2026-08-07

**Output contracts are loud, and a message is always a message.**

Ten findings, one shape between them: this library accepted something it could
not honour, and said nothing until the failure surfaced somewhere that could
not explain it. Eight are the "output contracts" batch of the act/window audit.
Two came out of clean-room probing of the published bytes, and one of those is
the worst kind — a mistake that LOOKED like it worked.

Six of these change what a run does; four refuse a configuration or an input
that used to be accepted. All ten are below.

### `agent.run('go')` — a bare string IS the message

`AgentInput` has one required field, so a lone string has exactly one possible
reading, and every chat SDK takes it. This library took it two different ways:

- **`Agent.run('go')`** reached the messages slot as `content: undefined` and
  threw `TypeError: Cannot read properties of undefined (reading 'length')`
  from five frames inside the engine, naming nothing.
- **`LLMCall.run('go')`** did **not** throw. It called the model with an
  **empty conversation** and returned the answer, so the mistake was
  indistinguishable from working code.

A bare string is now adapted — `run('go')` ≡ `run({ message: 'go' })` — on
`Agent`, `LLMCall`, `Sequence`, `Parallel`, `Conditional`, `Loop` and
`LlmRouter`, through one shared door (`src/core/runInput.ts`). The `Runner`
port and `RunnerBase` declare the union, so a custom runner shares it too.

Everything that is **not** a message is refused before the run starts, with a
typed `InvalidRunInputError` (`ERR_INVALID_RUN_INPUT`) naming the door and the
shape that arrived — never the value, because a refused input is still the
caller's data:

```
Agent.run: `message` must be a string — pass a message: run('your message')
or run({ message: 'your message' }) (received an object with keys: text,
whose `message` is undefined).
```

**Behaviour change:** an empty or whitespace-only message is refused. It is not
a shorter question — `Agent` used to send a `content: ''` turn (which real
provider wires reject) while `LLMCall` sent no turn at all, so the two runners
disagreed about what it meant and neither answer was right. To run on the
system prompt alone, say so in the message. Nothing is billed and no half-run
has to be explained: the refusal happens before the executor is created.

### A turn with no text never enters the conversation

The `undefined` content above had six other ways in, all landing on the same
line — `buildMessagesSlot` composing `truncate(m.content, 80)`. Each source now
normalizes (one sane reading) or refuses teachingly (more than one). None of
them was fixed at the crash line, because hiding it there would have hidden
which source leaked.

- **A tool that returns nothing** — `safeStringify` returned
  `JSON.stringify(value)`, which is `undefined` for `undefined`, a function and
  a symbol, while its signature promised `: string`. An `async execute()` that
  did its work and forgot to `return` killed the run one turn later. It is now
  total: a value-less return becomes the self-describing
  `(this tool returned no value)` — not `''`, because the model has to be able
  to tell "no value" from "the empty answer". `stream.tool_end` still carries
  the real return value, `undefined` included.
- **A human-answer pause resumed with nothing** — `agent.resume(checkpoint)`
  after `askHuman()` / `pauseHere()` now raises `PauseAnswerRequiredError`
  (`ERR_PAUSE_ANSWER_REQUIRED`), naming the tool and both spellings
  (`resume(cp, 'the answer')` vs `resume(cp, '(no answer)')`). That pause
  exists to collect a value and the value becomes the tool's result, so "no
  answer" and "carry on" are two different conversations. Nothing runs before
  it raises and the checkpoint is unchanged.
- **A middleware that rewrites a message to something that is not text** —
  denied, naming the middleware, per this file's own law that a middleware
  which throws is a denial and never a pass. It used to be assigned, producing
  `s.slice is not a function` at the input phase and an unattributed
  "unexpected result shape" at the output phase.
- **A declared `slot: 'messages'` injection with missing or empty content** —
  refused at the declaration funnel, beside the existing role refusal. Two
  contentless declarations also collided on the delivery ledger's key, so one
  was silently swallowed.
- **A restored checkpoint carrying a hole** — `validateCheckpoint` checked
  `Array.isArray(history)` and never looked inside, one field away from
  `originalInput.message`, which has been string-checked since it was written.
  It now checks every turn, at the door a persisted artifact comes in.
- **The slot itself** is the net, and it does not coerce: a message that gets
  through anyway is named — position, role, and where it came from (an
  injection, a tool call, the run input, the history).

### A middleware `ask` at the message boundary was silently an ALLOW

`MessageOutcome` has no `ask` arm, so TypeScript refuses it at the call site.
A JS consumer, an `as any`, or a link written for the tool chain and reused
here reached the runtime — where the ask fell straight through the value test
and filed an **allow** row. A rule that believed it had paused for a person had
approved the message, and the ledger agreed with the rule.

It is now a denial naming the middleware, which is the answer
`askPolicy: 'refuse'` already gave the tool chain wherever no pause exists to
carry an ask. Ask at a tool moment, where a pause exists, or decide with
`allow()` / `deny()`.

### A malformed provider stream chunk says which provider, and what the contract is

`LLMProvider` is a port anyone can implement. A non-terminal chunk with no
`content` died on `chunk.content.length` as
`Cannot read properties of undefined (reading 'length')`, naming neither the
provider nor the shape it missed. The commonest way to get there is ending the
stream with a marker of one's own instead of `done: true` — so the refusal says
what the terminal chunk looks like.

### `.outputSchema(parser)` now JUDGES by default

`retries: 0` — the default, and the whole of what `.outputSchema(parser)` means
on its own — used to mount nothing in the loop. The chart was byte-identical to
an agent with no contract at all: no judging, no `outputAttempts` row, no
event. A `run()` caller received a contract-violating string with nothing
anywhere saying that a contract had been declared, let alone missed.

`retries: 0` now means **judge, do not re-ask**. No retry branch is mounted, no
extra turn is spent, no extra token is billed — the request bytes are
unchanged. What changes is that the run knows, and says.

### The run says when the contract is not met

Three channels, the same three a limit that cuts a turn short uses, because
before this there were none:

1. **`agent.outputContractUnmet()`** — committed state carrying the stage, the
   validator's own words, the attempts, the re-asks that were billed, whether a
   fallback is configured, and `brokenBy`. `undefined` when the answer passed.
2. **`agentfootprint.agent.output_contract_unmet`** — one new typed event
   (73 across 20 domains now). A rise in `'json-parse'` is a model that stopped
   honouring the instruction; a rise in `'schema-validate'` is drift.
3. **One `console.warn`**, naming what to do next.

`run()` still returns the raw answer and `runTyped()` still throws
`OutputSchemaError`. Neither changed: a caller who wants a raise asks for one,
and a caller who does not should still be able to find out.

### An output rule that breaks a good answer is named, and stops the re-asking

**Behaviour change.** An `act({ output })` middleware runs before the schema is
judged — correctly, because the string it produces is the one the caller
receives. But a rule that rewrites a valid answer into an invalid one used to
burn **every** retry chasing its own damage: the model answered correctly, the
rule broke it, the run paid for another turn, and the model answered correctly
again. The ledger read `[retried, retried, exhausted]` with the validator
complaining about text the model never wrote.

The run now judges the pre-chain answer too, but only when a link actually
changed something. If the model's answer passed and the rewrite is what failed,
the run stops re-asking and names the rule — in the `outputAttempts` row
(`brokenBy`), in the event, in `outputContractUnmet()`, and in the warning.
Re-asking cannot fix a rule: a deterministic one breaks the next answer
identically, so the retries buy a repeat of the same ending. An answer that was
*already* bad still spends its retries — the stop applies only when the
middleware is the cause.

### `.outputFallback()` says which door reaches its tiers

The tiers produce a typed `T`, so `runTyped()` and `parseOutputAsync()` engage
them and **`run()` cannot** — substituting a fallback into a string return
would hand a caller a different answer than the model gave, invisibly. An agent
consumed through `run()` (a server route, a queue worker, `standingAgent`)
therefore gets no fallback, and nothing used to say so. The unmet-contract
warning and event now carry `fallbackConfigured`.

With `canned` set, `runTyped()` is **structurally unable to throw** — which is
the point of a safety net, and also why N billed re-asks ending in a static
object could not be observed at all.
`agentfootprint.resilience.output_canned_used` now carries `retriesSpent`, and
one warning fires when the canned value lands after re-asks that were paid for.

### `.outputFallback()` is checked at `.build()`, in either order

The requirement is set MEMBERSHIP — a fallback is degradation for a contract,
so an agent with one and not the other is incoherent. Order was never the
requirement, but the refusal was on order: `.outputFallback().outputSchema()`
threw while `.outputSchema().outputFallback()` was fine, and both end with the
same agent. The coherence check and the `canned` validation now run at
`.build()`, where the parser is guaranteed to exist. Same fail-fast guarantee,
one moment later, and the two lines can be written in whichever order reads
better.

### "Already set" names the door that set it

`.window()`, `.compaction()` and `.act({ window })` are three doors into one
setting, and how much you were told depended on which direction you approached
from: `.window()` named the strategy and then talked about `.compaction()` even
when `.act({ window })` had set it, while `.act()` said "set by .window() or
.compaction()" — an `or` that was sometimes neither. The door is now recorded
where it becomes true and named in all three refusals, in every direction.

### Compatibility

- **New:** `run(string)` on every runner; `InvalidRunInputError`,
  `PauseAnswerRequiredError`, `agent.outputContractUnmet()`,
  `agentfootprint.agent.output_contract_unmet`, `OutputAttempt.brokenBy`,
  `retriesSpent` on the two fallback events.
- **Refused where it used to be accepted:** an empty/whitespace-only message; a
  non-message `run()` input (these crashed or silently mis-ran before); a
  resume with no answer on a human-answer pause (crashed before); a middleware
  `ask` or non-text `allow` at the message boundary; a contentless declared
  message injection; a checkpoint whose history carries a turn without text; a
  malformed provider stream chunk (crashed before).
- **Moved, not changed:** `.outputFallback()` coherence and `canned` validation
  from the call site to `.build()`.
- **Changed on a working path:** `.outputSchema(parser)` with default options
  now judges the answer, may warn, and may write `outputAttempts` /
  `outputContractUnmet`. The answer, the request bytes, the chart shape, the
  turn count and the bill are unchanged. And an output rule that breaks a
  passing answer no longer spends the run's retries.
- No renames, no removals, no signature narrowings.

## [8.17.0] - 2026-08-07

**The record goes through the tool boundary.**

8.16.0 let an agent answer "why did you do that?" from its own recorded turn.
`inspect_tool_call` resolved a tool call end to end and then stopped at a wall:

```
⚠ boundary: what happened INSIDE the tool is not traced — this is the envelope
  (arguments in, result out) plus what the run itself decided about it.
```

That is the true answer for a tool that reaches into a payments API. It was
needlessly true for a tool that IS a footprintjs flowchart: that tool recorded
every stage it ran, and then threw the recording away, because nobody was
holding it.

### `flowchartAsTool({ keepRecord: true })` — the tool keeps its own record

Each invocation's inner record is now filed under the `toolCallId` the outer run
already uses to name that call. One id, two levels — which is what makes the
descent a lookup rather than a correlation puzzle.

```ts
flowchartAsTool({
  name: 'weather_advice',
  description: 'Decide whether to bike tomorrow.',
  flowchart: adviceChart,
  keepRecord: true,        // ← off by default
  keepRecordLimit: 20,     // ← bounded LRU window (this is the default)
  redact: { keys: ['apiKey'] },
});
```

- **Off by default, and zero-cost off.** No store, no extra recorder, no
  capture — the byte-identical path the tool had before the option existed.
- **Bounded.** The last `keepRecordLimit` invocations (default 20), least
  recently USED dropped first; reading refreshes recency so a record under
  investigation is not evicted by a turn happening beside it. Records dropped
  to stay under the cap are COUNTED, and the session is told.
- **All three exits are recorded.** A run that threw and a run that paused are
  complete records of what happened, and "why did it fail?" is the question
  most likely to come next.
- **Capture failure is filed, not swallowed.** If the record cannot be taken,
  a row is kept carrying the reason — a missing row is indistinguishable from
  a call that was never made.

`redact` is new on the same options object: a `RedactionPolicy` applied to the
inner executor before every invocation. footprintjs scrubs at commit time, so a
covered key never enters the inner commit log at all — which is what makes a
kept record safe to serve back to a model.

### `inspect_tool_run` — the descent rung

`inspect_tool_call` now ends with the call that opens the inside, in place of
the boundary marker, whenever a record exists:

```
inside: this tool kept its own record of the run — 4 step(s), ok.
        Descend with inspect_tool_run({ toolCallId: 'c1' }).
```

The new tool serves the inner run with the SAME drill vocabulary, one level
down — overview by default, plus `find` (free text → inner ids), `variable`
(why is an inner value what it is), `runtimeStageId` (one inner step), and
`runtimeStageId` + `key` (that field in full). The inner views are the pack's
own tools built over the inner artifact bag through `openRecording`, so there
is no second implementation of "what did this step write" to drift.

```
INSIDE TOOL CALL c1 — 'weather_advice' ran a recorded flowchart (4 committed step(s), ok).
SLICE for 'advice' — reads via: custom-fn
Advise transit (rain#3) [wrote: advice, because]
  Validate the forecast (validate-forecast#1) ← via rainChancePct [wrote: checks, usable, rainChancePct]
    Fetch the forecast (fetch-forecast#0) ← via forecast [wrote: forecast]
  Weigh the rain (weigh-the-rain#2) ← [control: Rain chance at or above the 60% bike threshold]
⚠ the ids above are INNER ids — they name steps of weather_advice's own chart, not of the
  run that called it. trace_node / get_value / trace_slice do not accept them.
```

Two id namespaces, said out loud on every answer: a model that pastes an inner
id into `trace_node` should meet a boundary, not a mystery.

An inner record carries one thing a saved recording never can — **control
edges**. `openRecording` has to say "⚠ control edges unavailable" because a
lookup function does not serialize; an inner record is live in process, so the
wrapping tool attaches a fresh `controlDepRecorder()` per invocation and the
inner slice shows the decision RULE that routed execution.

`inspect_tool_run` mounts **unconditionally**, like `inspect_tool_call`, and
answers honestly when there is nothing to open — naming `keepRecord` (nothing
keeps records), listing the calls that CAN be opened (wrong id), or naming
`keepRecordLimit` and the drop count (evicted). A tool that vanishes when the
answer is "none" cannot say which switch turns it on.

`TRACE_TOOL_NAMES` gains `inspect_tool_run` — the builder's `.selfExplain()`
name reservation is read from that one list, so the new name is reserved the
day it ships. Ten tool definitions now land on the tools slot for the one
activated iteration; an agent that opts into `.selfExplain()` should raise
`contextBudget: { tools: 7000 }`.

### Wiring is the builder's job

`.build()` collects the inner-record store off every statically registered
(`.tool()` / `.tools()`) and skill-declared chart tool, and hands one merged
lookup to the trace artifacts. Mounting the tool and calling `.selfExplain()`
is the whole configuration. A chart tool delivered through a `.toolProvider()`
is resolved per iteration against a live context, so there is no build-time
moment at which the list exists — register it statically as well if you want
the descent, and `inspect_tool_run` says so meanwhile.

New exports on `agentfootprint/observe` (and `/debug`) for consumers assembling
artifacts by hand: `innerRunStore`, `innerRunsOf`, `mergeInnerRuns`,
`INNER_RUN_RECORDS`, `DEFAULT_INNER_RUN_LIMIT`, and the `InnerRunRecord` /
`InnerRunLookup` / `InnerRunStore` / `InnerRunSummary` / `InnerRunOutcome` /
`KeepsInnerRuns` types. `TraceToolpackArtifacts` gains an optional `innerRuns`.

### The demo

`examples/features/50-through-the-tool-boundary.ts` — a weather-advice agent
whose ONE tool is a 4-stage footprintjs chart. Turn 1: *"Should I bike to work
in Chicago tomorrow?"* Turn 2: *"Why did you say it'll rain?"* — answered
through visible `find_in_trace` → `inspect_tool_call` → `inspect_tool_run`
calls that cite the inner stage (`validate-forecast#1`), the exact field
(`rainChancePct = 82`) and the rule that consumed it. The chart's own stage
counters are printed either side and are unchanged: explaining the decision did
not re-make it. Fixture data and a scripted model by default ($0, no network);
`AGENTFOOTPRINT_DEMO_LIVE_DATA=1` fetches a real forecast from Open-Meteo (a
keyless public API), `ANTHROPIC_API_KEY` switches on a live model
(`claude-haiku-4-5` by default).

## [8.16.0] - 2026-08-07

**The agent can now answer "why did you do that?" without re-doing it.**

`.selfExplain()` shipped in 8.12.0 with six tools over the previous completed turn.
Used in anger, it had four gaps — and every one of them was the same shape: the
evidence existed, and the model had no way to reach it.

### `find_in_trace(query)` — free text in, step ids out

Every other trace tool needs a name you already have: a step id, a state key, a
variable. But a follow-up question arrives in the user's words — *"why did you say
order 7712 was out of warranty?"* — and the model's only options were to guess a
state key or read the whole narrative.

This searches stage names and descriptions, state keys, every committed value and
the narrative, and hands back **pointers**. Every hit line ends with the exact call
that opens it, so a search result is a menu of drills rather than an answer to be
believed:

```
FOUND 3 match(es) for '7712' in 12 stage(s), 36 state key(s), 40 committed step(s) …
- tool-calls#22 wrote 'history' (append): …"Order 7712: sku KB-88…  → get_value('tool-calls#22', 'history')
- narrative line 41: … wrote lastToolResult …                       → read_narrative({ offset: 41 })
```

Case-insensitive substring; `maxHits` defaults to 10 and hard-caps at 25; each hit
serves a bounded **window** around the match, never the value. Values are serialized
one `(step, key)` payload at a time and discarded — a search never builds a
serialization of the whole log to look through, and one that exhausts its scan
budget says so rather than reporting "no match".

It searches the redacted commit log, because that is the only copy that exists. A
miss names what never enters the record at all — run input, env, pre-run state,
closures, and anything redaction removed — so "not found" cannot be misread as
"did not happen".

### `inspect_tool_call(toolCallId)` — four records, joined

A tool call is the most-asked-about thing in an agent run and the most scattered.
The args the model **proposed** are on an assistant turn; the args it **actually ran
with** are in the middleware ledger (and only when a rule changed them); the result
is a `role:'tool'` turn; the timing exists only in the event stream. One id, four
lookups — so the tool does the join:

```
TOOL CALL c2 — check_inventory
step: tool-calls#22 — drill with trace_node('tool-calls#22')
proposed by the model: {"sku":"KB-88"}
ran with: {"sku":"KB-88","limit":5} — CHANGED at before-tool by 'clamp-limit': "page size capped at 5"
result: "Stock for KB-88: 12 units available…"
outcome: ok
duration: 4ms
```

The proposed/ran-with split is the reason it exists. A governance rule that rewrites
args is invisible in the conversation: the model reads its own proposal in history
and the tool ran on something else, and that difference is often exactly what "why
did it do that?" is asking about.

Every source that is missing says so with ⚠ rather than being guessed at: no event
tail means `duration: ⚠ unavailable` with the reason (the commit log records what
each step WROTE and has no clock), not a fabricated number. A bad id never throws —
it comes back naming the run's real tool call ids. Outcomes are `ok` / `error` /
`denied by '<rule>'` / `paused`, and `⚠ unknown` when nothing supports a claim.

### Behaviour change — the captured turn now carries three things, and both new parts default ON

`SelfExplainBinding` captured the snapshot. It now also captures, at the same
terminal flush so all three describe one turn:

- the run's **narrative** (`getLastNarrativeEntries()`), and
- a bounded **tail of the run's typed events** (default 2,000 per turn).

Both are controlled by a new option and **both default to `true`**:

```ts
.selfExplain({ include: { narrative: true, events: true }, maxEvents: 2000 })
```

That default is the behaviour change. An agent built with `.selfExplain()` now
subscribes a wildcard event listener and retains a per-turn event tail it did not
retain before — a few hundred KB for a typical turn, bounded and rotated per run so
turn N+1 never carries turn N's events. `include: { events: false }` makes **no**
subscription at all rather than one that is ignored; `include: { narrative: false }`
skips the narrative read.

The default is `true` because the tools that read these parts are on the catalog
either way, and a tool that answers "⚠ no evidence" by default is a tool that
teaches the model not to call it.

`bindTo()` accepts the bare `getSnapshot` function it always accepted, plus a new
object form carrying all three sources at once. One call, not three connections —
the `BoundaryRecorder` lesson in this codebase is that a seam needing three separate
wirings gets two of them.

### Behaviour change — `read_narrative` now mounts under `.selfExplain()` inline mode

`read_narrative` was eager-only: `traceToolpack` mounted it when the artifacts
carried a narrative, and the lazy pack behind `.selfExplain()` never did, because
narrative presence is a property of a run that has not happened yet at build time.

The lazy pack's template is now built over an artifact bag that declares every
optional part, so it mounts the same nine tools every time. That fixed list is what
the tool catalog and the builder's name reservation are both keyed on. When a
resolved run turns out not to carry a part, the tool says which switch turns it back
on rather than quietly disappearing from the catalog or answering emptily.

**`read_narrative` is therefore now a reserved tool name in inline mode.** A
consumer tool named `read_narrative` on an agent with `.selfExplain()` now fails at
build with the existing teaching refusal — previously it would have been allowed,
and would have shadowed nothing. Same for `find_in_trace` and `inspect_tool_call`.

The full inline reservation is now nine names: `run_overview`, `find_in_trace`,
`trace_node`, `trace_slice`, `backtrack`, `who_wrote`, `get_value`,
`inspect_tool_call`, `read_narrative` (delegate mode still reserves only
`explain_run`). The list is **derived** from the pack (`TRACE_TOOL_NAMES`) rather
than retyped beside it, so a tool added to the pack is reserved the same day it
ships.

### `run_overview` gains a COST line

When the run priced itself, the overview now ends with what it spent:

```
COST: ~$0.012300 (in 900 / out 120 tokens) — estimated by the run's pricing table,
not a bill — via get_value('call-llm#14', 'cumEstimatedUsd').
```

Only when `cumEstimatedUsd` is committed and **greater than zero**. It is seeded to
0 on every agent run and only moves under a configured `pricingTable`, so a zero
means "this run was not priced" — and printing `$0.00` for it would be a number that
lies.

### `openRecording(recording)` — a saved run, reopened as evidence

`recordRun(agent)` freezes a run into `{ snapshot, events, structure }`, the shape
the viewers read. The trace toolpack reads a different shape. Until now a team with
a recording on disk from last Tuesday and a question about it had to reassemble the
bag by hand — differently in every integration, losing the narrative and the events
on the way.

```ts
const tools = traceToolpack(openRecording(JSON.parse(fs.readFileSync('run.json', 'utf8'))));
await callTraceTool(tools, 'find_in_trace', { query: 'order 7712' });
```

Pure: no engine, no agent, no I/O. Exported from `agentfootprint/observe` (and
`agentfootprint/debug`). Honest about the two things a serialized run cannot carry
back — `controlDeps` is a lookup *function* and does not serialize (slices say
`⚠ control edges unavailable`, the marker that already existed), and the narrative
survives only if a narrative recorder was attached, since `recordRun` deliberately
attaches none. Two teaching refusals name `recordRun` as the producer: a bundle with
no snapshot, and a snapshot missing `commitLog` or `executionTree`.

### Internal — one bounded event tail, not two

`recordRun`'s ring buffer and drop counter moved into a shared `eventTail` helper
that both it and `SelfExplainBinding` now use. Written twice, the two would
eventually disagree about what "dropped" means and one would stop reporting it —
which is the failure that matters, because a tail that silently starts mid-run reads
as the whole run. `recordRun`'s public surface (`eventCount`, `droppedEvents`,
`maxEvents`) is unchanged.

### New example

`examples/features/49-self-explain-live.ts` — an order-support agent looks up a
damaged order, checks inventory, and **skips the refund** because the item is in
stock and under warranty. Turn 2 asks "why did you skip the refund?" and it answers
through visible `find_in_trace` → `inspect_tool_call` → `run_overview` calls. It
prints per-tool execution counters either side of the explanation to prove nothing
re-ran, that no business tool was called in turn 2, that `issue_refund` executed zero
times across both turns, and the total spend against the budget. Runs on a scripted
mock by default ($0, deterministic, CI-safe); `ANTHROPIC_API_KEY` switches it live
with `DEMO_MODEL` (default `claude-haiku-4-5` — a small model reading its own record
is the claim), and `AGENTFOOTPRINT_DEMO_OFFLINE=1` forces the mock.

### A note on the tools slot

Nine tool definitions land on the tools slot for the one activated iteration. That is
a real bulge past the 2000-char `contextBudget.tools` default, which is a **signal,
not a limiter** — nothing is ever truncated. An agent that opts into `.selfExplain()`
should raise it (`contextBudget: { tools: 6000 }`); example 49 does, and says why.

## [8.15.0] - 2026-08-07

**One skill's turn at a time.** A skill graph is a state machine, and every node in
it obeyed that except one: an entry that carries a `when`. Such an entry stayed
loaded beside the skill it had just handed off to — two skill bodies in the system
prompt, two tool sets on the wire — and the check-up then warned about a fan-out
using advice the author had already taken.

Both come from the same leftover clause, and both are fixed here.

### Behaviour change 1 — a handoff ends the previous skill's turn

A conditional entry compiled to `when(ctx) || nextSkill(ctx) === id`. 8.3.0 added the
cursor half and left the rule half standing, and the rule half is the bug: an entry's
`when` reads the user's message, which does not change mid-turn. So when entry `S`
routed to `T`, `S`'s rule still matched and `S` and `T` were both active. Measured on
a two-skill support graph:

| iteration | active | tool menu | skill bodies |
|---|---|---|---|
| 1 | `triage` | `read_skill`, `lookup_order` | triage |
| 2 — the handoff | `triage`, `refund` | `read_skill`, `lookup_order`, `issue_refund` | triage + refund |
| 3 | `triage`, `refund` | same | triage + refund |

Note iteration 3. This was never a one-iteration blip: with the cursor parked on
`refund`, `triage`'s rule kept matching, so it came back and stayed. The overlap was
the steady state.

**A conditional entry is now active exactly while the cursor is on it** — the same
compiled expression a route target and an exclusive entry already used. One law for a
flat graph: *a skill is active iff the cursor is on it, or it declared itself
unconditional.* `when` chooses where a turn STARTS.

This finishes 8.3.0 rather than reverting it. Both failures 8.3.0 named — a declared
step INTO an entry skill, and a `read_skill` pick onto one — are carried by the cursor
clause, which survives untouched. A throwing entry predicate still surfaces as
`predicate-threw`: the rule is still evaluated, its answer is just no longer allowed
to override the cursor.

**What is unchanged:** an entry with no `when` (`{ kind: 'always' }` — the persistent
base, and the declared way to be co-active beside the cursor); `.entryBy()` /
`.entryByRelevance()` / `.entryByRead()` (already cursor-exclusive); decision `tree()`
graphs; route targets; every injection registered beside the graph (`.fact()`,
`.steering()`, `.skill()`, memory, RAG); and cold start for the entry whose rule wins.

**Who has to change something.** One shape: a conditional entry used as an always-on
overlay — `.entry(base, { when: () => true })`, or a locale/persona predicate that
stays true for the whole turn. `when: () => true` used to be a synonym for omitting
`when`; it is not any more. Two-line migration, pick one:

```ts
.entry(base)                                    // drop the `when` → `always`, on beside the cursor
.steering(defineSteering({ id, prompt, ... }))  // or move the predicate to the flavor built for
.skill(defineSkill({ id, ... }))                // "on whenever this matches, wherever the graph is"
```

An entry is a position in a state machine. If a skill is not a position, it was never
an entry.

**A second consequence, deliberate:** `agentfootprint.skill.reroute_superseded` now
fires in one case it used to stay quiet for — a `read_skill` pick that lost the cursor
to a declared edge but happened to be an entry whose own rule matched. It was active
by accident, so the promise looked kept. It is now reported like every other
superseded pick.

### Behaviour change 2 — a rule-router is not a fan-out

`multi-entry-fanout` fired whenever a graph declared two or more entries, including
when every one of them carried a `when` — a deterministic rule-router, which is a
taught shape. Worse, the advice it gave was *"give the extras a `when`"*, to entries
that already had one. It computed which entries were unconditional and then used that
only to soften the middle of the sentence.

- Every entry conditional → **silent**. The entries take turns; there is nothing to
  warn about, and after behaviour change 1 that is literally true at runtime.
- Some entries unconditional → still a warning, and the advice now names **only**
  those. `problem.skill` points at the first unconditional entry rather than at
  whichever entry happened to be declared first.

The rationale comment in the check-up claimed an entry's compiled trigger was
"cursor-INDEPENDENT". That stopped being true in 8.3.0 and is wholly false now; it is
why the check over-fired. Rewritten.

### New — `supersededIds` on `agentfootprint.context.evaluated`

A suppression the run cannot name is a silent drop. When a conditional entry's rule
matched and the cursor law kept it off the wire, the entry's id is now reported on the
per-iteration evaluation event, beside the `cursorMove` that says where the graph went
instead. Together they answer *"why isn't my entry loading?"* without anyone
re-running a predicate to guess.

Omitted when nothing was suppressed, and for every non-skill-graph run — so an
ordinary iteration is byte-identical to 8.14.0. It rides the per-iteration event
rather than `skill.reroute_superseded` because it is a **continuous** condition (an
entry whose rule stays true while the cursor is parked elsewhere is suppressed every
iteration), while that event means a **discrete** broken promise. `skill.reroute_superseded`
keeps its meaning exactly.

`SkillGraph` gains `supersededEntries(ctx)` — pure, deterministic, empty for a graph
with no conditional entries and for a decision `tree()`. It is threaded through
`.skillGraph(graph)` like `explainNextSkill`, optional at every hop, so a graph built
before it existed routes identically and simply emits no `supersededIds`.

### Docs

`SkillEntryOptions.when` and the skill-graph module header rewrote the law they were
describing wrongly. The v2 design note that blessed the additive reading
(`docs/design/skill-graph.md`, "orthogonal to a base") is kept as the record with a
SUPERSEDED block naming what it got wrong. `examples/features/42-skill-graph-model-pick.ts`
now writes a real entry predicate instead of `when: () => true`.

`README.md` and `AGENTS.md` taught `import { mock } from 'agentfootprint'`, which has
never compiled against the 8.x exports map — `mock` lives on
`agentfootprint/providers` (and `InMemoryStore`/`mockEmbedder` on
`agentfootprint/memory`). The snippets now import from the doors that exist. The
repo's own agent skill file (`.claude/skills/agentfootprint/SKILL.md`) is rewritten
against the current `.d.ts` for the same reason.

## [8.14.0] - 2026-08-07

**Budgets tell one truth.** Eight ways this library reported a number, a limit
or a bill that did not match what it actually did. A budget you cannot read
correctly is not a budget; a limit that says it stopped the run and did not is
worse than no limit at all.

Four of these change what a run DOES, three refuse a configuration that used to
build, and one changes a string on the wire. All eight are below.

### Behaviour change 1 — `.compaction({ summarizer })` now REQUIRES `model`

`model` used to default to the agent's own model, and that default had no
correct branch:

- **same provider family** — it billed your MAIN model for every fold. The
  refusal three lines above it in the same file promised *"the library will not
  quietly bill your main model for compaction"*, and then did.
- **different provider** — it sent your agent's model id to a vendor that has
  never heard of it, so the fold died mid-run, on a paid run, in a file whose
  own header promises "everything fails at `.build()`, never mid-run".

There is no third branch, so the default is gone. `model` is required whenever
`summarizer` is set, refused at `.build()` through **both** doors
(`.compaction({...})` and `summarizeOldest({...})`) with a message that names
both failures and the two-word fix. `ResolvedCompaction.model` is now `string`.

One visible consequence: `FoldedSpan.model` — the summary's recorded author —
now names the summarizer's model rather than the agent's. It always described
what was really billed; what was really billed has changed.

### Behaviour change 2 — a stale token count is no longer a token count

`CompactionMeter` returned early on malformed usage **without clearing what it
was holding**. A provider that reported usage once and then stopped — a proxy
that drops the field, an OpenAI-compatible endpoint that omits it while
streaming, a flaky gateway — left that first number standing forever, and every
later window decision was made on it. In the probe that found this, one count
taken at iteration 1 drove three separate decisions and evicted six messages at
iterations 3 and 4.

Readings are now stamped with the iteration whose call produced them and expire
one boundary later. An expired reading is `undefined`, which every strategy
already treats as "do not act" — so a window strategy **stands down** instead of
deciding on a number nobody took, and says so once on the console rather than
going quiet. "Counted, never guessed" has to mean counted *recently*.

An agent whose provider reports usage reliably is unaffected.

### Behaviour change 3 — `maxIterations` reached with pending tool calls now says so

The loop stopping while the model was still asking for tools produced `""` and
nothing else: no event, no committed record, and a `route_decided` rationale
nobody was subscribed to. An empty string reaching a user is indistinguishable
from a bug.

Now it emits `cost.limit_hit { kind: 'max_iterations', action: 'abort' }` — the
kind `CostLimitHitPayload` has reserved since it was written, so no new event
type — commits `AgentState.stoppedEarly`, and warns once on the console **when
the answer is empty**. Read it with the new `agent.stoppedEarly()`.

It deliberately does **not** throw. 8.6.0 raises for an outstanding credential
consent because that is a fault: the run hands back a plausible answer for work
a tool never did. A limit you configured firing is the limit working, and the
answer is sometimes real — a model can return content alongside its tool calls,
and that content is a genuine partial answer. Raising would reject good answers
to fix a bad one.

`stoppedEarly` is absent on every normal finish, including a turn that spent its
whole iteration budget and then genuinely finished.

### Behaviour change 4 — a `replacement-not-smaller` refusal is paid for once

A fold abandoned because the summary came back no smaller than the span it would
replace was re-asked every iteration: same span, same summarizer, same verdict,
a real billed call each time. The refusal is now latched by span CONTENT, and a
skipped visit files its record with `summarizerSkipped: true`, no call and no
cost tick — a call the library decided not to make is evidence, not silence.

Two things it deliberately does not latch. A span that has **grown** is asked
about again: the test is `summaryChars >= windowChars(span)` and a larger span
makes that less likely to hold, so a fold refused at four turns can genuinely
succeed at six. And `summarizer-failed` is still retried — an outage may end, a
comparison of two string lengths will not.

### `context.budget_pressure` now carries its `unit`

Two emitters share this event name, this `slot: 'messages'` value, and — until
now — one indistinguishable payload:

| emitter | counts | `unit` |
|---|---|---|
| the three context slots (`contextBudget`, **on by default**) | `String.length` | `'chars'` |
| a window strategy (`.window()` / `.compaction()`) | provider-reported input tokens | `'tokens'` |

So one subscriber routinely received both, and `cap 200, projected 258` could
mean 258 characters or 258 tokens — a roughly 4× difference in the same field,
with nothing in the payload to tell them apart.

`unit`, `cap` and `projected` are new and **required on the event payload**;
`capTokens` and `projectedTokens` are deprecated, still written, and carry
identical values. On `BudgetPressureRecord` — which slot builders, including
ones you wrote, produce — the three are **optional**; `ContextRecorder` fills
`unit: 'chars'`, which is a fact about that channel rather than a guess.
`WindowStrategyResult.budgetPressure` gains an optional `unit` defaulting to
`'tokens'`, which is what all three shipped strategies already meant.

No OpenTelemetry mapping was added, on purpose: `adapters/observability/otel.ts`
has never consumed this event and has no catch-all that would turn one into a
span event, so there was no ambiguity there to fix. Adding a mapping would be
new surface, not a unit correction. The commentary renderer likewise still
returns `null` for it (slot mechanics are plumbing, not pedagogy). Neither is an
oversight — please do not "fix" them.

### `costBudget` can now stop the run

`costBudget` was warn-only, while `commentaryTemplates.ts` narrated
*"{{appName}} hit a cost limit and stopped."* and `docs/monitor/deployment.mdx`
claimed the agent *"halts when the per-run USD budget is hit"*. It did neither.
`docs/monitor/observability.mdx`, on the same site, correctly said the library
never auto-aborts.

```ts
costBudget: 0.50                              // warns — unchanged, byte for byte
costBudget: { usd: 0.50, onExceed: 'halt' }   // stops
```

`'halt'` ends the loop at the next iteration boundary — the same boundary
`maxIterations` uses. Never mid-call: the call that crossed the budget
completes, is billed and is recorded; halting only decides there will not be
another one. `stoppedEarly()` then reports `reason: 'cost-budget'`.

There is still exactly ONE `cost.limit_hit` per crossing, from the same place
it has always come — `emitCostTick`, which is the only code that knows the
budget. It now reports `action: 'abort'` rather than `'warn'` when the budget
halts. The route decider does not emit a second one; it emits
`kind: 'max_iterations'` only, for the limit that has no other voice.

The commentary line reads its outcome off the payload, so prose and event can no
longer disagree. It keeps its single `cost.limit_hit` key — splitting it into
`.warn` / `.halt` would have read better and silently orphaned every consumer
who had overridden the base key. Both docs pages are corrected.

`LLMCall` refuses `onExceed: 'halt'` at build: one call has no next boundary to
stop at, and accepting it would be a stop button wired to nothing.

### A summarizer that is the agent itself is refused

`.compaction({ summarizer: theSameProviderInstance, model: theAgentsModel })`
now refuses, at both doors.

Not about money — requiring `model` already ended the quiet billing. It is that
those two calls are configured identically and provably behave differently: the
agent's call runs through `reliability` retries, any
`withRetry`/`withFallback`/`withCircuitBreaker` decorator and the cache subflow;
`runSummarizer` calls `provider.complete()` bare and gets one attempt, no
fallback, no cache. A difference nobody typed.

The refusal is deliberately narrow. A **different instance** at the same model is
allowed — "use the strong model to write the summary, because a bad summary
poisons every turn after it" is a real choice — and passing a second instance
also ends the shared per-instance state that made this pairing bite. In the
probe that found it, one `mock()` serving both roles had the summarizer eat the
reply scripted for the agent: the agent's own final answer became the summary
text, and the run then crashed on an exhausted script.

`WindowStrategy` gains an optional `billing` descriptor so the builder can make
this check through `.window(summarizeOldest({...}))` too. Enforcing it at only
one of two doors onto one policy would make it advice rather than a rule.

Both the option's docstring and the `runSummarizer` call site now state plainly
that the summarizer call is un-decorated.

### Wire change — `'summary-not-smaller'` → `'replacement-not-smaller'`

`slidingWindow` and `tokenBudget` never call a summarizer — a drop makes no LLM
call at all — and both reported `summary-not-smaller` when the authored drop
NOTICE came back no smaller than the turns it would replace. The type's own
docstring already described the general case; only the name lagged.

**A runtime from 8.14.0 writes only the new string.** The old one survives as a
deprecated member of `WindowRefusalReason` so code written against 7.17–8.13
still narrows and compiles, but it is never emitted — two spellings of one fact
is the disease, not the cure. If you match on the string in a
`WindowRecord.refusals`, update it.

### A crash checkpoint now names where it crashed

Field report: a WebKit `fetch` failure surfaced as
`[agent run] failed at iteration 3 (unknown)`. WebKit's entire message for a
failed fetch is `TypeError: Load failed` — no code, no vendor name, nothing
`classifyFailurePhase`'s regexes can match — while the run itself knew the LLM
call was open at the time.

The checkpoint tracker now follows the run's own `stream.*` brackets, so the
phase is OBSERVED; `classifyFailurePhase` becomes the fallback for failures
between brackets, where the error's own text really is the best evidence there
is. `AgentRunCheckpoint.failurePoint` gains an optional `stage`, and the message
reads `failed at iteration 3 during the LLM call (stage: call-llm)`.

`stage` carries the literal `'call-llm'` or a **declared tool name**, and
nothing else — never a URL, a header or a request body. A checkpoint is
persisted to Redis / Postgres / S3 and read by whoever is on call. A test
asserts no URL reaches it.

Still `version: 1`: an optional field is not a format change, and bumping the
version would make an older deployment refuse a session it can serve.

### Also

- The `cost.*` bridge is now attached unconditionally. It was gated on
  `pricingTable`, which was correct while `cost.*` only ever meant money —
  `emitCostTick` returns on its first line without a table, so the gate could
  hide nothing. An iteration limit has no price, and behind the old gate
  `cost.limit_hit { kind: 'max_iterations' }` would have reached the dispatcher
  only for agents that happened to be costing themselves. The bridge drops
  events with no listener, so an agent that subscribes to nothing pays nothing.
- `CompactionMeterHandle.lastCall()` takes the current iteration (internal —
  not on the public barrel) and gains `unmeteredSinceLastGood()`.
- `CompactionRecord` gains optional `summarizerSkipped`.
- `AgentState` gains `stoppedEarly` and `costBudgetOnExceed`.

## [8.13.0] - 2026-08-07

**Governance never silently drops — and never silently invents.** Eight ways a
rule you configured could decide nothing, and you could only find out by reading
a quiet run. Seven are now refused at build time with a message that names the
fix; one was a rule that ran everywhere except the one path where a *person* had
just typed the value.

Two of these change what a run DOES. Both are called out below.

### Behaviour change 1 — redaction now runs on a resumed `askHuman` / `pauseHere`

`onToolResult` now fires when a run resumes from `askHuman()` / `pauseHere()`.
It already fired on the other four dispatch paths; that one was skipped.

The tool ran — `pauseHere` throws from inside `execute`, so it started and may
have done half its work — and the value you hand `agent.resume()` **is** that
tool's result everywhere else in the run: it lands in the history under the same
`toolCallId`, `stream.tool_end` reports it, `on-tool-return` triggers fire off
it. Its before-tool chain had already walked. So the ledger carried an opening
row and no closing one, and every `onToolResult` rule sat unapplied on the one
channel where a person can paste a secret.

What changes for an agent that has `onToolResult` rules:

- a redaction rule now scrubs the human's answer before the model reads it;
- `deny(reason)` now replaces it with the reason;
- an `after-tool` ledger row now appears for that call;
- `stream.tool_end` still reports the raw value — unchanged, and the same split
  the other four paths keep.

An agent with **no** `onToolResult` anywhere is byte-identical: the chain
early-returns when nothing in it governs results.

`AgentState` gains one optional field, `pausedToolArgs`, so the rule receives the
args the tool was actually running with rather than the model's proposal. A
checkpoint written by 8.12.0 does not carry it; those args are recovered from the
assistant turn in the history — real values, identical to the running args unless
a before-tool middleware transformed them, and that one difference is not
recoverable from a checkpoint that never recorded it.

### Behaviour change 2 — a selective `checkIn` no longer blocks the calls it was written to let through

When a `toolMiddleware` answered `ask`, the tool was approved, and the tool ALSO
declared `checkIn`, the resumed dispatch refused the call — by noticing that a
`checkIn` field existed, without ever evaluating it. A tool written
`checkIn: (args) => args.amount > 1000` refused the £5 refunds too, and the
refusal claimed a consent gate would have run when it provably would not have.

The guard now evaluates the demand, against the args the tool would run with and
the same conversation shape the loop's own gate uses. **A tool whose predicate
does not trip now executes** where it was previously refused.

When the predicate DOES trip, the refusal stands, and it stands on purpose. The
two gates ask different questions: a middleware `ask` carries the rule's own
free-text question; a `checkIn` carries the tool's demand with the evidence pack
attached — `willDo`, what the run read, what drove the choice, the trail — none
of which the person who approved the ask ever saw. Letting one approval satisfy
both would file a `checkin.decision` for a question nobody was asked.
`checkIn: 'always'` is unaffected in both directions.

The refusal text is rewritten: model-actionable first ("was not executed and
cannot be retried this turn… answer without it, or finish"), then the author's
fix, naming the middleware.

### `agent.resume()` refuses a consent gate answered with a value

Resuming a check-in or a middleware-`ask` pause with anything that is not a
`CheckInDecision` used to DECLINE, silently, and file the decision against
`by: 'unknown'` — a consent record naming a person who was never asked. That is
worse than dropping one: the run reads as consented-and-refused when nobody
consented to anything.

It now raises `DecisionRequiredError` (`code: 'ERR_DECISION_REQUIRED'`) at the
API boundary. **Nothing executes and the checkpoint is unchanged**, so the same
one can be answered properly and resumed again. The error names the gate
(`gate: 'checkIn' | 'ask'`), the tool, the middleware that asked, and `received`
— the *shape* that arrived, never its contents, because a resume payload is
caller data and an error message ends up in logs.

Discriminated by the **pause**, never by the input, via the new
`pauseDemandsDecision(pauseData)` — the one reader of that shape, shared with the
code that builds `outcome.checkIn` / `outcome.ask`, so what a consumer is told
and what the library enforces cannot drift. A plain `askHuman()` / `pauseHere()`
pause is untouched: there the human's answer IS the tool's result, and any value
is accepted. The 3LO credential-consent pause is untouched too — it re-asks the
provider and ignores its input by design.

Over `standingAgent` it is a **400**: `ERR_DECISION_REQUIRED` joins
`STATUS_BY_CODE`, because the session is in a perfectly consistent state and it
is the request that is wrong.

New on the main barrel: `DecisionRequiredError`, `pauseDemandsDecision`,
`ConsentGate`, `ConsentGateKind`.

### Five refusals for configuration that decided nothing

Each of these refuses code that was **already a total no-op** — no working
program changes behaviour, which is why they ship in a minor, on the same
precedent as 8.5.0's delivery refusal and 8.7.0's `viaToolName`.

- **Two different observers with one `id`** — `build()` refuses, naming the id.
  footprintjs de-duplicates attached recorders by id, so of two objects carrying
  one name only the LAST ever fired and the first reported nothing, which reads
  exactly like an observer whose events never happened. Keyed on object
  identity: handing the SAME object to `.watch()` twice (or to `.watch()` and
  the deprecated `.recorder()`) is fine and stays one attachment. The
  `agentfootprint.` id namespace is deliberately NOT reserved — the factories on
  `agentfootprint/observe` live there and are meant to be watched.

- **`costBudget` without `pricingTable`** — `Agent` and `LLMCall` both refuse.
  The budget is USD and only a pricing table turns tokens into USD, so the pair
  emitted nothing at all: no `cost.tick`, and no `cost.limit_hit` however much a
  run spent. The message says what a `pricingTable` is
  (`{ name, pricePerToken(model, kind) }`, USD for one token) and why the
  library ships none. Both runners take the identical pair and had the identical
  silence, so both are fixed by one shared check.

- **`onAuthorizationRequired` without `credentials`** — `Agent` refuses. The
  mode is read at exactly one place, after a declared credential comes back
  `authorization-required`; with no provider that call never returns at all (the
  fail-closed stand-in throws), so the branch it governs is unreachable.

- **`.checkIn()` with no tool declaring `checkIn`** — `build()` refuses. The gate
  is never consulted, the agent never pauses for consent, and the evidence
  settings decide nothing. Scans the `.tool()` registry AND every skill's own
  `inject.tools`, since a skill tool's demand is a real gate. NOT refused when a
  `.toolProvider()` is wired: its tools arrive per iteration and may declare it,
  and refusing what build time cannot know would break a correct agent.

- **`.checkIn({ evidence: 'minimal', scorer })`** — refused. The scorer ranks
  `drivers`; the minimal pack builds only `willDo`, so the scorer was resolved
  and then never called. Only the literal `'minimal'` preset is refused — a
  custom assembler is handed the scorer and may legitimately call it.

### Also

- `historyForCheckIn` is now one helper shared by both check-in gate sites, so a
  `CheckInDemand` predicate reading `ctx.history` cannot be judged against a
  different conversation depending on which door the call arrived through.
- Fixed a stale comment: the after-tool moment's header said it was called from
  "all three dispatch sites"; it has been four since 8.6.0 and is five now.

## [8.12.0] - 2026-08-07

**Somebody has to flush the exporter, and until now nobody did.** 8.11.0
documented that honestly; 8.11.1 fixed the two bugs underneath it. This release
finishes the job: the framework calls `flush()` and `stop()` for you, in the one
correct order, without ever stopping a strategy somebody else is still using.

### The handle that comes back from `enable.*`

`agent.enable.observability({ strategy })` still returns the `Unsubscribe`
function it always returned — calling it still detaches, and detaching still
never stops your strategy. It now also carries two methods:

```ts
const telemetry = agent.enable.observability({ strategy: cloudwatch });

await telemetry.flush();   // drain: driver queue first, then the buffer
telemetry();               // detach (unchanged)
telemetry.stop();          // release — timers, clients, buffers
```

`flush()` enforces the ORDER, which is the part no consumer could write from
outside: an event scheduled on a `detach` driver has not reached your strategy
yet, so flushing the strategy alone ships nothing. The handle knows both halves
because it owns both.

`await using` works too, where your runtime has `Symbol.asyncDispose`:

```ts
await using telemetry = agent.enable.observability({ strategy });
```

Existing code is unaffected: the return type widened, and a function that
carries extra properties is still that function.

### `agent.shutdown()`

```ts
await agent.shutdown();
```

Drains and releases everything enabled on that runner. **The agent itself
remains usable afterwards; `shutdown()` drains and releases what was enabled on
it.** Every strategy flushes before anything stops, so a strategy two handles
share is never stopped with data still in it. Pass `{ stop: false }` to drain
without releasing.

### `standingAgent` flushes when it closes — the one behaviour change

`close()` now drains the agent's telemetry by default (`shutdown: 'flush'`).
Nothing about the API changed and no call site needs editing; what changes is
that a batch which used to be dropped when the server stopped now arrives. It
does not RELEASE the strategies, because this composer only borrowed the agent
— say `shutdown: 'flush-and-stop'` when the agent's life ends with the host, or
`shutdown: 'none'` for exactly what 8.11.x did.

### `shutdownOn` — signals, asked for rather than assumed

```ts
await standingAgent({ agent, sessions, host, shutdownOn: ['SIGTERM', 'SIGINT'] });
```

Closes the host, drains telemetry, removes its own listeners, then **re-raises
the signal** so the process dies the way the platform meant it to.

Off by default, and that is a refusal rather than an omission. `process.on('SIGTERM', …)`
is not observation: Node's default action for that signal is to terminate, and
adding any listener suppresses it — a library that installs one behind your back
can turn a container's graceful stop into a wait for SIGKILL in an application
that never asked. Handlers are process-global, only Node has signals at all, and
no library can know your exit policy. A composition root may ask; it must not
assume.

### `flushOn: 'run-end'`

```ts
agent.enable.observability({ strategy, flushOn: 'run-end' });
```

Fires a flush when a run ends — for scripts, cron jobs and functions that may
vanish right after answering. **It fires the flush; it does not gate `run()`.**
A process that exits in the same breath can still outrun it; the honest closer
is `await agent.shutdown()`. Nothing was made awaitable inside `run()` because
telemetry must never become a term in run latency. Default `'manual'`.

### Who may stop a strategy

One `WeakMap`, three laws. An `Unsubscribe` never stops a strategy — that is
what lets one instance be enabled, released and enabled again (the audit-export
pattern; `examples/features/19-audit-export.ts` is unchanged, byte for byte, and
is the compatibility proof). A strategy is stopped only once the last
subscription pointing at it is released, so one runner's shutdown cannot blind
another runner that shares it. And `stop()` reaches a strategy **at most once,
ever**, whoever asks.

### Also

- `docs:truth` gained a rule (`strategy-lifecycle-consumer-only`) that fails the
  build if any doc line goes back to saying the framework never calls these.
  Seven sites were rewritten; the rule is what keeps them rewritten.
- New example: `examples/features/48-graceful-shutdown.ts` runs all three doors
  and asserts the laws, including that `run()` still does not flush.
- `ESNext.Disposable` added to the TypeScript `lib` (whole repo typechecks clean).

## [8.11.1] - 2026-08-07

**Two bugs in the shutdown path — one hangs the process, one loses the
telemetry while reporting success.** Both are failures against behaviour this
project documented, found by auditing the lifecycle 8.11.0 wrote down. Neither
changes an API; both change what happens when a process stops.

### `flush()` after `stop()` spun the event loop forever

`cloudwatchObservability` and `xrayObservability` buffer events and drain them
in `flush()`. Their `flush()` looped until the buffer was empty, while their
internal drain refused to do anything once `stop()` had been called. Those two
rules cannot both be satisfied, so a shutdown that stopped before it flushed
entered **an infinite microtask loop**: 100% of a core, and — because a
microtask loop never yields to the event loop — no timer could fire, no
in-process shutdown deadline could expire, and nothing short of `SIGKILL` ended
the process. Measured on both adapters and on any `compose([...])` containing
one.

The order documented on the strategy interface (flush, then stop) avoided it,
which is why every test passed. The reverse order is not a misuse worth
punishing with a hang.

Fixed at the root: **`stop()` means stop ACCEPTING events — it never meant
discard the ones already accepted.** The same stance `auditExport()` has always
taken ("stop observing; never destroy collected evidence"). A `flush()` after a
`stop()` now ships the tail batch and returns. Events exported after `stop()`
are still dropped, and the timer is still cleared — that half is unchanged.

The drain loops are now bounded by construction: every pass must remove at
least one buffered event, and a pass that removes none ends the drain instead
of trying again. A drain that cannot finish must return, never retry forever.

### `flushAllDetached()` could not see detached exports

With `enable.observability({ detach })`, each export is scheduled onto a
footprintjs detach driver. Scheduling happened inside a promise continuation,
so the detach handle reached footprintjs's registry a microtask *after* the
event was dispatched. `flushAllDetached()` drains until that registry is empty
— and it was still empty when it looked.

So the shutdown recipe this project documents returned
`{ done: 0, failed: 0, pending: 0 }`, a clean bill of health, while events were
still in flight. Worse, **no consumer could fix it from outside**: the pending
work lived in a `.then()` chain that nothing exposed. Measured both cold and
warm — a resolved promise still defers.

Scheduling is now synchronous, so the handle is registered in the same tick as
the event and `flushAllDetached()` drains it exactly as documented. The
deferral bought nothing in the first place: this module already imports
`footprintjs` statically, so the dynamic import it was waiting on had loaded
the package either way.

### Also

- The no-op returned when `enable.observability()` is called without a strategy
  now carries no-op `flush` / `stop` alongside the unsubscribe. Nothing you can
  reach today (the declared type is still `Unsubscribe`); it exists so the
  no-subscription case is not the one path that breaks when that type widens.
- Removed a dead loop condition in the CloudWatch drain (`lastFlushPromise !==
  Promise.resolve()` compares against a freshly minted promise and is always
  true).

## [8.11.0] - 2026-08-07

**Telemetry that fails invisibly is indistinguishable from telemetry that
works.** That sentence is the whole release. Three of the things fixed here
were not bugs in the ordinary sense — nothing threw, nothing crashed, every
test passed. They were promises the documentation made that the code did not
keep, in the one layer whose entire job is to tell you the truth about what
happened.

Found by a production AgentCore integration, the way these things are always
found: on real infrastructure, at the last hop.

### ⚠️ Behavior change: a throttled MCP tool call now retries

`mcpClient` retries an HTTP **429** up to 3 times, honouring the server's
`Retry-After` header, capped at 10 seconds of waiting in total. It was on
nothing before. Opt out with `retryOnThrottle: false`.

**No call that succeeds today behaves differently** — this changes only calls
that currently fail. But a throttled call that used to fail in milliseconds can
now take seconds before it fails, so it is a behavior change and it leads this
entry rather than hiding in a bullet.

### The log stream that was never created

`agentcoreObservability` and `cloudwatchObservability` called `PutLogEvents`
directly. CloudWatch rejects a put into a log stream that does not exist, so
**any stream name that had not been created by hand dropped every event,
forever, in silence.** The failure had no error, no warning and no partial
delivery — just an empty log group.

The docstring for `logStreamName` had been promising `"Created on first put if
it doesn't exist"` since the adapter shipped. It was never true. Worse, the
convention the docs themselves recommended — `` `${HOSTNAME}/${Date.now()}` ``
— produces a name that *cannot* pre-exist, so following the documentation
guaranteed the bug on every deploy. The only configuration that worked was the
undocumented one.

The stream is now created on first delivery, tolerating the
`ResourceAlreadyExistsException` of two processes racing, and the failed batch
is re-sent once. **The log group is still yours to provision** — a group
carries retention and encryption decisions that belong to whoever owns the
account (a group created with default retention never expires, which is an
unbounded bill created by a telemetry library), and the docstrings now say so
instead of implying otherwise.

### The silence underneath it

The missing stream was one delivery failure. It turned out **every** delivery
failure was silent: an IAM denial, a throttle, a rejected batch. Each adapter
installed its console fallback lazily *inside* its own `_onError` method — so
the delivery path, which read the hook rather than calling the method, found
`undefined` and dropped the error on the floor. `cloudwatch`, `xray` and `otel`
all had it.

Three changes, one shape: the fallback is armed at construction; delivery
failures route through whatever `_onError` **is at call time**, so assigning it
actually works; and there is now a real front door —

```ts
cloudwatchObservability({
  logGroupName: '/myapp/agent-prod',
  onError: (err) => log.warn({ err }, 'telemetry export failed'),
});
```

The default sink is loud on the first failure and then logarithmically quieter
(failures 1, 2, 4, 8 … carrying the running count), because an hour-long
CloudWatch outage must not become a second outage in your logs. A sink you
supply is never rate-limited — you asked for every failure.

**The test that let this ship** reassigned `strategy._onError`, the very code
under test, and then wrapped its only assertion in `if (captured)`. It could not
fail. It is replaced by six that assert unconditionally.

### A knob the warning told you to turn, that did not exist

An over-budget context slot warned: *"Raise `budgetCap` on the slot config."*
`budgetCap` was reachable from no public door. `buildMessagesSlot()` was called
with no arguments at all four of its call sites, so its 10000-character cap was
unreachable by construction. A warning you cannot act on is worse than no
warning — it teaches people to ignore the channel.

```ts
Agent.create({ provider, model, contextBudget: { messages: 40_000 } });
```

Characters, per slot, named for the three slots the context model already has.
Defaults unchanged (`systemPrompt` 4000, `messages` 10000, `tools` 2000), and
**nothing is ever truncated** — the full content still reaches the LLM. The
budget is a signal, not a limiter. `LLMCallOptions` takes the same option
(two slots; an LLMCall has no tools).

### Why retrying a 429 is safe, and why it will never widen

A 429 is a **pre-execution rejection**: the rate limiter refused the request at
the edge and the server never ran the tool, so a retry cannot double-execute
anything. That is exactly what is *not* true of a 500 or a timeout, where the
call may have half-run and a retry could charge a card twice.

That asymmetry is the entire license for this feature, so the policy is 429 and
nothing else — pinned by a property test that walks twelve other statuses and a
thrown transport error and asserts a single attempt for each. Managed gateways
rate-limit per principal by design; without this, a designed and self-clearing
condition reached the model as a thrown tool error it reads as *"this tool is
broken"*, whereupon it apologises, picks another tool, or invents an answer.

It lives at the `fetch` seam because that is the only place `Retry-After` still
exists — the MCP SDK reads the response, throws `StreamableHTTPError(status,
text)` and drops the `Response`, so by the time a throttle reaches
`Tool.execute` the header is gone and the status survives only as `err.code`.
The retry wraps the **outermost** fetch, so every attempt is re-signed and
re-vended: a token that would have expired during the wait is simply never the
one reused. The gateway secrecy invariant is untouched, and a test asserts no
token appears in any retry report.

Per-attempt visibility is the `onRetry` callback — the contract `withRetry` and
`withCredentialRetry` already use. No new event types.

### Documentation that was describing a different library

- **`ObservabilityStrategy`'s hot path is `exportEvent`.** Six doc lines in
  `strategies/types.ts` called it `onEvent`, including one two lines above the
  interface that declares `exportEvent`. That text shipped in the `.d.ts`, so it
  is what an IDE showed.
- **Nothing calls `flush()` or `stop()` for you.** The docstrings promised
  `"Called before agent.run() resolves"`; across the whole library the only
  caller is `composeObservability` fanning out to its own children. The
  `Unsubscribe` from `enable.observability()` only detaches the dispatcher. They
  are consumer-called, the docs now say so, and a batching exporter loses its
  final batch and leaks its timer if you skip them:
  ```ts
  process.on('SIGTERM', async () => { await telemetry.flush(); telemetry.stop(); stop(); });
  ```
  Wiring them into the framework lifecycle would change `run()` timing and
  misbehave for a strategy shared across two `enable` calls, so it is a design
  question on the ledger rather than a silent default.
- **A Skill's tools are visible from iteration 1.** `DefineSkillOptions.tools`
  said they were *"added to the tools slot once activated"*. They are added to
  the registry at build time; activation adds the Skill's **body**, not its
  tools. Gating is opt-in via `autoActivate: 'currentSkill'` (which
  `skillGraph().tree()` sets for you on every leaf) — and the docs said
  otherwise in twelve places, including a `process_refund` example claiming a
  tool was *"locked away"*. That example now sets `autoActivate` and the prose
  no longer implies a security boundary the default does not provide.
- **`autoActivate` stopped calling itself a forward-compat marker** awaiting
  "v2.5 runtime wiring" — that wiring shipped in 2.5.0, six majors ago.
  `refreshPolicy`, by contrast, is still genuinely unwired, and now says so
  without promising a version.
- **The observability `tier` is not a privacy control.** No tier redacts
  anything, and a lower tier is not a safer one: `'minimal'` still ships
  `agent.turn_start` (`userPrompt`), `agent.turn_end` (`finalContent`) and
  `agent.iteration_end` (the whole conversation `history[]`) — measured, it
  carries user content in a *higher* share of its events than `'standard'` does.
  The docstring says this plainly now, points at `auditExport()` (bounded by
  default) and `otelObservability()` (omits `userPrompt`), and warns that
  `redactContent` does **not** apply to this channel — it operates on the
  offline `serializeTrace` universe, and wiring it here is a silent no-op.
- **In AWS, start with `xrayObservability`** — one optional peer, one IAM
  permission (`xray:PutTraceSegments`, previously undocumented), no collector to
  run. Reach for `otelObservability` when the destination is not AWS.

### Four defects that shipped because nothing checked

`npm run docs:truth` gained a doc-text rule class — a gate, never ratcheted,
because the steady state of each rule is zero: `onEvent` under `src/strategies/`,
activation claims on `DefineSkillOptions.tools`, and stale version promises
(the general shape — a docstring promising a version that is now in the past,
not the literal string `v2.5`).

### Added

- **`CloudwatchObservabilityOptions.onError`** / **`XrayObservabilityOptions.onError`**
  / **`OtelObservabilityOptions.onError`** — a constructor door for delivery
  failures. Equivalent to assigning `_onError`, but visible at the call site.
- **`CloudWatchLikeClient.createLogStream`** — optional, so an existing
  `_client` test double that only implements `putLogEvents` still type-checks.
- **`McpClientOptions.retryOnThrottle`** — `boolean | { maxAttempts?, maxWaitMs?, onRetry? }`.
  Default on. Ignored for `stdio`, which has no HTTP status to read.
- **`AgentOptions.contextBudget`** / **`LLMCallOptions.contextBudget`** —
  `{ systemPrompt?, messages?, tools? }`, in characters.

### Fixed

- CloudWatch/AgentCore observability delivered **zero events** to any log stream
  that did not already exist, silently. The stream is now created on first
  delivery.
- Delivery failures in `cloudwatch`, `xray` and `otel` reached nobody unless
  something had already called `_onError` for an unrelated reason.
- A failed CloudWatch batch now reports how many events were dropped, and names
  the likely cause (missing group vs missing `logs:CreateLogStream`) when a
  stream cannot be created. A create that fails for a non-recoverable reason is
  attempted once and latched off, so it can never loop — while every dropped
  batch is still reported.
- MCP `tools/call` turned a designed rate limit into a tool error the model
  reads as a broken tool.
- The slot over-budget warnings named `budgetCap`, which no public door reached,
  and disagreed with each other about where it lived.

### Compatibility

Minor. Every new option is optional and every default is unchanged. The one
behavior change is the 429 retry described above; the CloudWatch fix changes
only a path that delivered nothing. New IAM requirement — `logs:CreateLogStream`
— applies only where delivery is currently failing.

## [8.10.0] - 2026-08-06

**A folder of documents becomes an answering agent.** 8.8.0 made retrieval tell
the truth about what it read; 8.9.0 made the index survive a restart. Both
assumed you had already turned your documents into chunks — which meant writing
loaders, splitters and re-index logic yourself, and which is the actual reason
"add RAG to my app" was a week rather than an afternoon.

`agentfootprint/rag` is that missing half.

```ts
import { indexFolder } from 'agentfootprint/rag';
import { sqliteVectorStore } from 'agentfootprint/memory';
import { staticEmbedder } from 'agentfootprint/providers';

const report = await indexFolder('./docs', {
  to: sqliteVectorStore({ file: './corpus.db' }),
  embedder: staticEmbedder(),
});
// { discovered: 3, loaded: 3, chunks: 14, embedded: 14, skipped: 0, removed: 0, … }
```

### A new door, and why it earns one

`agentfootprint/rag` is the eleventh door. Index time is a different PROCESS
from run time: it happens at boot or on a cron, it touches the filesystem, and
for PDFs it reaches for an optional peer. None of that belongs in the bundle of
an agent that only answers questions — a browser or edge runtime importing
`agentfootprint` should never resolve `node:fs`. A door is the unit at which a
bundler can cut.

**`defineRAG` deliberately stays on the main barrel.** The retriever is
run-time wiring — registered on an agent, running every turn — so it belongs
beside `defineTool`. This door is the half that runs once, before any agent
exists.

### Loaders

`textLoader`, `markdownLoader` and `htmlLoader` need no dependency. `pdfLoader`
needs one, and it was picked by measuring rather than by reputation:

| package | installed | packages | verdict |
|---|---|---|---|
| **`unpdf`** | **2.5 MB** | **1** | chosen — zero transitive deps, per-page text |
| `pdf-parse@2` | 86 MB | 3 | a native binary (`@napi-rs/canvas`), to read text |
| `pdf-parse@1` | 34 MB | 4 | unmaintained since 2018 |
| `pdfjs-dist@6` | 62 MB | 2 | 25× the size for the same engine |

It is an optional peer, lazily loaded, refusing with an install line when a PDF
is actually met. Per-page text is why a PDF citation can name a page you can
turn to rather than saying "somewhere in this file".

Markdown keeps its markup: stripping `#` throws away the one splitting signal
that is not a heuristic, and rewriting text breaks the offsets every citation
depends on. The HTML loader is a tag stripper and says so — for a
single-page app you will get navigation labels, and the honest fix is a real
extractor feeding `{ text, uri }`.

### Splitters, and the measurement behind the defaults

`byHeading()` · `byParagraph()` · `fixedWithOverlap()` · `wholeDocument()`, as
factory functions in the same shape as the window and retrieval families.

Defaults are **1000 characters with 150 of overlap**, chosen by constraint.
`localEmbedder`'s default model silently truncates at 512 wordpiece tokens —
measured directly: at 508 base tokens an appended tail still moves the vector
(cosine 0.9965); at 596 it does not (0.999999). The tail was discarded and
nothing said so. 1,000 characters is ~250 tokens, comfortably inside that cliff
and inside the length the model was trained at. Chunks that exceed a stated
ceiling anyway are RECORDED in `report.truncated`, not silently clipped.

**The invariant every splitter holds:** `doc.text.slice(charStart, charEnd) ===
chunk.text`. `splitDocuments` checks it rather than trusting it, because a
custom splitter is a supported thing to write and a chunk that cannot be located
in its own document produces citations pointing at the wrong words — worse than
no citation, because it looks checked.

### `indexCorpus` is a chart, and the commit log IS the report

```
discover → load → split → plan (DECIDER)
         → take-window → embed (FAN-OUT + retry) → tally → more? ⟲
         → remove → report
```

A `for` loop answers nothing once it has finished. This answers "why is this
chunk here, why was that one skipped, what did this run cost, which document
went missing" months later from its own log, without the caller having saved
anything.

`plan` is a real decider because "skip this chunk" is a decision with evidence —
same content hash AND same embedder fingerprint — and its branches
(`full-index` / `incremental` / `nothing-to-do`) are named in the trace. The
embed stage fans out with `addParallelForEach` and a declarative `retry`, so a
rate-limited attempt is in the record instead of vanishing inside a hand-rolled
loop.

### Incremental re-index

```text
run 1  (first index)   discovered 3 · loaded 3 · chunks 8 · embedded 8 · skipped 0 · removed 0
run 2  (no changes)    discovered 3 · loaded 3 · chunks 8 · embedded 0 · skipped 8 · removed 0
run 3  (edit + delete) discovered 2 · loaded 2 · chunks 5 · embedded 1 · skipped 4 · removed 3
```

A chunk is reused when its content hash and the embedder fingerprint both
match. Delete a document and its chunks go — an index that still answers from a
file you deleted is worse than one that cannot answer. An **empty walk never
prunes**: a typo in a path must not delete a corpus.

### The CLI

`agentfootprint-index` is the third bin, after `agentfootprint-setup` and
`agentfootprint-lint-tools`:

```bash
npx agentfootprint-index ./docs --to ./corpus.db
npx agentfootprint-index ./docs --to ./corpus.db --embedder local --split paragraph
npx agentfootprint-index ./docs --to ./corpus.db --dry-run --json
```

### Two bugs the tests found, worth naming

- **The fan-out was silently dropping work.** `maxBranches` TRUNCATES extra
  items rather than queueing them, so a single fan-out over every batch would
  have embedded only the first `maxConcurrentBatches` of them and reported
  success — an index quietly holding a fraction of the corpus, which is the
  worst thing this release could have shipped. The fan-out now runs over a
  WINDOW that can never exceed the ceiling and loops for the rest, and a test
  pins that 12 batches through a window of 2 index all twelve.
- **The report counted intent, not outcome.** `embedded` came from the plan's
  queue, so an embedder that failed every attempt still reported `embedded: 3`.
  It is counted from what the batches actually wrote, and a failing batch now
  fails the run (`failFast`) rather than leaving a half-indexed corpus that
  keeps answering and quietly cannot see what did not land.

Also found while writing the splitter tests: runt-folding merged short chunks
**across heading boundaries**, producing a chunk labelled with one section's
heading and containing the next section's text — a citation that names the
wrong section. Folding now only merges within a section. And page attribution
read the overlapped start rather than the chunk's own, so a chunk could cite
the page its 150-character run-up borrowed from.

### Requirements

- **footprintjs `^9.15.0`** (was `^9.13.0`): the indexing chart uses
  `addParallelForEach` (9.14.0) and per-stage declarative `retry` (9.15.0).
- **`unpdf`** as a new optional peer. Only `pdfLoader` touches it, only when a
  PDF is actually read.


## [8.9.0] - 2026-08-06

**The durable index.** 8.8.0 made retrieval tell the truth about what it read.
This one is about what it costs to have anything to read at all: `InMemoryStore`
is a `Map`, and its price is the one nobody notices until the bill arrives —
**restart the process and the whole corpus is re-embedded.** Fine for three
documents, absurd for ten thousand, and until now the only step up was "bring a
vector database".

`sqliteVectorStore` is the step between. One file, zero dependencies (SQLite is
inside Node), exact cosine search, and the vectors still there on the next boot.

```ts
import { sqliteVectorStore } from 'agentfootprint/memory';

const store = sqliteVectorStore({ file: './corpus.db' });
await indexDocuments(store, embedder, docs, { embedderId: embedder.id });
// …a restart later, in a new process: the vectors are already there.
```

### The two-phase cost model, now a number you can read

Embedding cost is not one number, and the split is the whole argument for a
file. **Index time** embeds the corpus: once, scaling with how much you store.
**Query time** embeds the user's question: per retrieval, scaling with traffic.
A 10,000-chunk corpus is 10,000 embeddings *once* and one per question
thereafter — with a `Map` it is 10,000 embeddings *per restart*.

`agentfootprint.embedding.generated` has carried an `inputKind: 'document' |
'query'` field since 2.x and nothing ever emitted it, so any dashboard built
against it has been reading a flat line that meant "not wired", not "no cost".
Both halves fire now. The domain also had a payload type, a registry entry and a
`DomainWildcard` arm and **no bridge recorder**, so the event could not have
arrived however correctly it was fired; `embeddingRecorder` is that bridge, and
it is attached on every run.

`indexDocuments` runs at startup, outside any run, so it has no emit channel to
ride — no scope, no dispatcher, no `runtimeStageId` to correlate against. Rather
than pretend otherwise it hands the same payload to an `onEmbedding` callback.

### Exact search, and the ceiling said out loud

Vectors are hydrated into one resident `Float32Array` matrix on the first search
of a namespace, normalised, and every later query is an exact dot product.
**There is no approximate index and no pretence of one**: it returns the true
top-K or it does not answer.

Measured against this implementation on Node 22.16, Apple silicon:

| corpus | query | resident matrix | file | first search (hydration) |
|---|---|---|---|---|
| 10,000 × 384-d | 6 ms | 15 MB | 21 MB | 45 ms |
| 50,000 × 384-d | 31 ms | 77 MB | 105 MB | 251 ms |
| 100,000 × 384-d | 65 ms | 154 MB | 211 MB | 939 ms |
| 10,000 × 1536-d | 16 ms | 61 MB | 83 MB | 122 ms |
| 50,000 × 1536-d | 89 ms | 307 MB | 413 MB | **5.7 s** |

**The documented ceiling is 50,000 chunks** — under 100 ms per query at every
embedder this library ships, under ~300 MB resident. It degrades linearly to
about 100,000; above that, `MemoryStore` is the seam to a managed vector
database and nothing else in your code changes.

Measuring it turned up something worth naming rather than burying: **hydration,
not the query, is what you plan around.** At 50,000 × 1536 the first search
costs 5.7 seconds, and left lazy that lands on whoever asks the first question
after a deploy. `store.warm(identity)` moves the cost somewhere you chose; it is
optional, idempotent, and changes no result.

A loadable extension (sqlite-vec) was measured and deliberately not taken: ~2×
faster at these sizes, at the price of a native binary on a five-platform matrix
(no musl, no Windows/arm64) and a pre-1.0 dependency. Two times, where we are
already under 100 ms, does not buy that.

### One embedder per namespace — the refusal that keeps it honest

`Embedder` gains an optional `id`, and every shipped embedder sets one. Together
with `dimensions` it forms the fingerprint the store records per namespace —
`'<id>@<dims>'` — and refuses on when it changes, **at write and at query
both**.

This is the behaviour-adjacent part of an otherwise additive release, so it is
worth being plain about why it is a refusal and not a warning. Cosine similarity
between two embedding spaces is not a weak signal — it is not a signal, and it
comes back as a confident number in the same range as a real one. No threshold
separates them and nothing downstream can tell them apart. A store that let the
mix through would corrupt every ranking it touched and log nothing.

```text
[memory] cannot write to the namespace '_/_/_global': it was indexed by
'static:@yarflam/potion-base-8m@256' and this vector is from
'openai:text-embedding-3-small@1536'. Vectors of different lengths cannot be
compared at all. Re-index this namespace with one embedder (delete it and build
it again), or point this store at a different file. This refuses rather than
re-embedding your corpus on your behalf — that is a bill you did not agree to…
```

The named fix is an explicit re-index (`store.forget(identity)`, then index
again), and it is never a fallback. Dimensions always decide; model ids decide
only when **both** sides named themselves, so the majority of callers who never
pass an `embedderId` are not blocked by a name nobody supplied.

`indexDocuments` now defaults `embedderId` to the embedder's own `id`, so a
namespace is fingerprinted even when the caller passes nothing.

### What it refuses, and why it never falls back

The law `sqliteSessions` states for a session file, one domain over: **an
unreadable index and an empty one are different facts, and only one of them is
safe to answer with "no matches".**

- **Node 20** has no `node:sqlite`. `SqliteUnavailableError` names your version,
  the 22.5 floor, the `--experimental-sqlite` flag for 22.5–22.12, and
  `InMemoryStore` — and refuses rather than falling back, because an index that
  silently forgot every document on restart looks, from the outside, exactly
  like a corpus that was never built. It is now ONE class shared with
  `sqliteSessions`: catching it should not require knowing which store was being
  constructed.
- **`':memory:'`** is refused, pointing at `InMemoryStore` — which says so in
  its name.
- **A file that is not a database**, **someone else's `af_vectors` table**, and
  **an index written by a newer agentfootprint** each raise
  `UnreadableIndexFileError` with a distinct `problem` to branch on.

### Also

- `putMany` is ONE transaction. The port does not require it, and most callers
  are append-idempotent — but a half-indexed corpus is a specific kind of bad:
  retrieval keeps working and quietly cannot see what did not land, which reads
  as "the model does not know that" rather than as a failure. A file can offer
  all-or-nothing cheaply, so it does. `putIfVersion` reads and writes inside one
  `BEGIN IMMEDIATE`, which is the entire point of a compare-and-set.
- Tables are `STRICT`; `journal_mode = WAL` is executed first and **read back**,
  so `store.journalMode` reports what the file actually got rather than what was
  asked for. A network filesystem can silently downgrade it, and that is only
  ever discovered under load.
- The BLOB on disk keeps the **original** vector, so `get`/`list` round-trip
  exactly what was written; normalisation happens once, into the resident
  matrix, so search is a dot product without changing what is stored.
- Found while writing the schema-identity check: it originally ran *after* the
  indexes were created, so a foreign `af_vectors` table failed on a missing
  column and was reported as `'cannot-open'` — the right refusal for the wrong
  reason, telling the reader to check file permissions when the real problem was
  that the file belonged to something else. It runs before them now.


## [8.8.0] - 2026-08-06

**Retrieval tells the truth.** A retrieval computed a cosine score for every candidate
and then threw all of them away one line later. The prompt carried the passages;
nothing carried the reason. "Why did the agent read this passage" had no answer in the
recording, and "why did it NOT read that one" had no answer anywhere — a
below-threshold candidate was filtered inside the store and never came back. A full
recording of a RAG run was 140,501 bytes and contained the substring `"score"` exactly
**zero** times.

Three defects came out of the same root, and all three are fixed here.

### THE behavior change: a corpus is read-only

`defineRAG` also mounted the semantic pipeline's WRITE half. Every conversation turn was
embedded and stored **in the same namespace as your documents**. The consequence is not
subtle: the user's own question, re-embedded, is the single best-scoring "document" in
the corpus — cosine 1.0 against itself — so it came back as retrieval hit #1 and spent
a slot in the top-K budget that a real passage should have had.

```text
before:  store after one turn → msg-1-0, msg-1-1, refunds.md#0, pricing.md#0, security.md#0
         top-5 for the question → [{"id":"msg-1-0","score":1}, {"id":"pricing.md#0","score":0.842}, …]
after:   store after one turn → refunds.md#0, pricing.md#0, security.md#0
```

A corpus is not a conversation log. `defineRAG` compiles no write subflow at all — not
"writes are skipped at runtime", but no stage, no commit, nothing to re-enable by
accident. **Conversation memory alongside a corpus is what `defineMemory` is for**, and
the two are registered separately, each with its own store:

```ts
const agent = Agent.create({ provider })
  .rag(defineRAG({ id: 'product-docs', store: corpusStore, embedder }))
  .memory(defineMemory({
    id: 'chat',
    type: MEMORY_TYPES.EPISODIC,
    strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
    store: conversationStore,
  }))
  .build();
```

This is filed as a fix in a minor because nothing was depending on it deliberately: a
corpus that ranks the user's own question as its best document is broken, not
configurable.

### The documented example retrieved nothing at all

`indexDocuments` writes under `{ conversationId: '_global' }` by default. A memory reads
under the identity passed to `agent.run()` — and a run with no explicit identity gets
`{ conversationId: 'run-<timestamp>-<n>' }`. So the write side and the read side never
met, and the snippet in this project's own README and JSDoc returned **zero results,
silently**. The example file in `examples/` worked only because it passed
`identity: { conversationId: '_global' }` by hand.

A corpus does not belong to a conversation. `defineRAG` now takes `corpus` — the
namespace it reads from — defaulting to the same `'_global'` the indexer writes to, so
index with no options and retrieve with no options and the documents are found. Pass it
explicitly for a per-tenant corpus, on both sides.

And a namespace that holds nothing is now *reported* rather than answered around:
`corpusEmpty: true` on the retrieval event, plus a once-per-process warning naming the
namespace it searched and the usual cause.

### The score survives now — and so do the rejections

`loadRelevant` did `results.map(r => r.entry)`. That one `.map` was the whole loss.

- **`MemoryState.retrieved`** — every candidate with its score, its rank, whether it was
  admitted, and if not, which of `below-threshold` / `over-budget` / `over-max-entries`
  refused it. Lifted to ROOT state as `retrievalEvidence_<id>` by the read mount, so a
  backward slice from the answer reaches the passage instead of stopping at the memory
  subflow boundary — a subflow's own scope never reaches the root commit log.
- **The quality floor moved out of the store.** It was passed as `search({ minScore })`,
  so rejected candidates were filtered server-side and never came back. It is applied in
  the stage now, over a pool of `k + rejectWindow`. **This cannot change which entries
  are admitted**: `search` returns score-descending, so either the whole pool clears the
  floor (admitted = first `k`, as before) or some entry fails it (every later entry fails
  too, so the pool already holds every entry that clears it). `rejectWindow` only controls
  how many near-misses can be *shown*.
- **`agentfootprint.memory.retrieved`** (new, 72 typed events) — one per retrieval,
  carrying every candidate. `candidates: undefined` means the store ranked server-side
  and returned nothing comparable; it never means there were none.
- **`agentfootprint.memory.attached`** — declared since 2.x, emitted by nothing until
  now. One per chunk that reached the prompt, with its score and rank.

```ts
agent.on('agentfootprint.memory.retrieved', (e) => {
  for (const c of e.payload.candidates ?? [])
    console.log(c.admitted ? '✓' : '✗', c.id, c.score.toFixed(2), c.reason ?? '');
});
// ✓ refunds.md#0   0.80
// ✓ pricing.md#0   0.79
// ✗ security.md#0  0.75  over-max-entries
```

### One injection record per passage, and not one byte of prompt changed

A retrieval that put three passages in the prompt produced ONE `InjectionRecord`. So
ablating a single passage was impossible, the context ledger credited the block rather
than the passage, and `ContextInjectedPayload.retrievalScore` / `.rankPosition` /
`.threshold` — declared since 2.x — had nowhere to come from, because one record cannot
honestly carry three scores. All three are written for the first time in this release.

The recall now splits into one injection per admitted chunk, keyed by the chunk's own id.
**The prompt is byte-identical.** The formatter records the exact fragment each chunk
contributed (header on the first, footer on the last), and `callLLM` assembles the system
prompt by joining every record's `rawContent` with `\n\n` — the same separator the
formatter joined its blocks with, so splitting and re-joining is the identity function.
A property test pins it across every `k`, and the split refuses itself if the fragments
do not rebuild the recall exactly (a custom `renderEntry`, say), falling back to the
single record, which is always correct and merely coarser.

Two orderings are now recorded because they are two different facts: `rank` is how the
chunk scored, `promptPosition` is where the budget picker put it. Under the default
recency ordering the best-scoring chunk can land last.

### Chunks the model can cite

A retrieved page of a PDF rendered as `<memory role="unknown" turn="0">` under the header
*"Relevant context from prior conversations"* — three claims that were not true of a
document, and no way to cite it. `defineRAG` renders a corpus as what it is:

```text
Relevant passages retrieved from the document corpus. Cite the source id when you use one.

<source id="refunds.md#0" doc="refunds.md" heading="Refund timing" score="0.80">
Refunds are processed within 3 business days of approval.
</source>
```

Attributes are omitted when unknown — a fabricated page number is worse than a missing
one — and both the document metadata and the chunk text are escaped, because a corpus is
untrusted input. Conversation memory keeps its `<memory>` rendering byte for byte.

### `source: 'rag'` is a value something finally emits

`ContextSource` has carried `'rag'` since 2.x and nothing ever produced it; RAG
injections reported `source: 'memory'`, while the docs claimed `'rag'`. The vocabulary
was right and the emitter was wrong, so the emitter changed: a `defineRAG` retriever
carries `flavor: 'rag'` and its injections compose as `source: 'rag'`.

### The retrieval seam

`topK({ k, threshold, rejectWindow })` is the rule every release before this one applied
without naming it, now written down as a `RetrievalStrategy` and passable as
`retrieval`. `topK` + `threshold` remain as shorthand for exactly that rule, and the two
spellings **exclude** — in the type and again at runtime for JavaScript callers — because
they could disagree and the recording would then name a `k` the run did not use.

A cross-encoder re-ranker and a diversity (MMR) selector are the next two adapters behind
this same interface. Neither ships here, and they are named so the destination is on
record rather than implied: a re-ranker with no shipped re-ranking model is a config with
nothing to configure.

### Also

- `defineRAG({ embedderId })` has been accepted since 7.x and never forwarded to
  anything — an option no run read. It reaches `search({ embedderId })` now, which is
  where it filters out a stale embedding space.
- `pickByBudget` names cap-rejections separately from budget-rejections. The two are
  fixed by different changes: one by raising `maxEntries`, the other by shortening the
  corpus.
- What did **not** change, deliberately: the budget picker still orders by recency, not
  by relevance. Reordering it would change which passages reach the prompt under budget
  pressure, and this release carries one behavior change. The record says
  `selectionOrder: 'recency'` so a reader can see it rather than assume otherwise.
- `fnv1a` moved to `lib/fnv1a.ts` and is re-exported from `core/slots/helpers.ts` under
  the same name. The memory layer needed the same hash and `memory/` cannot import
  `core/`; a second implementation is how two recordings of the same bytes end up
  disagreeing about their id.


## [8.7.0] - 2026-08-06

**The check-up stops being quiet, and a dead option stops pretending.** 8.4.0 stopped a
skill graph from throwing away what the author declared; 8.5.0 stopped it telling the
model things that were not so. This one is about the configurations the library
*watched you build and said nothing about* — an entry menu with no way to choose from
it, a transition the cursor can never take, a tool name two sources claim, a scoped
tool provider that returns nothing forever. Nine findings, one shape: the library knew,
and did not say.

### An entry menu with no way to choose from it

Declare two entries and no `.entryBy()` / `.entryByRead()`, and both of them load on
every call. An entry's compiled trigger is cursor-*independent* — no `when` compiles to
`{ kind: 'always' }` — while exactly ONE of them can be the cursor: the first whose
`when` passes. So the extras pay for their body and their tools on every iteration and
route nothing, which is the opposite of what a skill graph is for.

Worse, and exactly decidable: the cursor resolver returns at the **first entry with no
`when`**, in declaration order. Every entry after that one can never be the cold-start
cursor — so a `step` declared out of it never fires from there. A graph could pass
`check: 'throw'` with a transition that had no way to happen.

```text
[warning] multi-entry-fanout: The graph declares 2 entries ("triage" and "billing") and
no way to choose between them … Only ONE of them can be the cursor …
[warning] dead-entry-step: Entry "billing" is declared after "triage", which has no
`when` and therefore always wins the cold-start cursor … The one remaining path is a
read_skill pick onto "billing" mid-run (entries are always offered) …
```

Both are **warnings**, and the second one deliberately. The stranded entry is still in
`reachableSkills()` from every cursor, so a `read_skill` pick really can put the cursor
there — and refusing to build something the model can reach would claim more than the
declaration supports. The message names that path instead of pretending it does not
exist.

### A bare `.route(a, b)` was counted as reachability

A bare edge compiles to **no trigger at all**: the target keeps its `llm-activated`
default, and the model has to ask for it by name. The check-up's BFS walked it anyway,
so a skill nothing in the graph could activate was reported as reachable — the exact
question the check exists to answer, answered wrongly.

The BFS now walks deterministic edges only (`when` / `onToolReturn`), and bare-edge
targets get their own code, which says what is actually true — including the one cursor
position the gate will grant the jump from:

```text
[warning] model-edge-only: Skill "incident" has no deterministic edge into it — only a
bare route from "triage" … the model has to ask for it with read_skill, and the gate
grants that only while the cursor is on "triage" (never at cold start).
```

`unreachable-skill` and `model-edge-only` now partition cleanly: nothing incoming at
all versus only bare edges incoming.

### `unreachable-skill` is told per trigger kind

The sentence *"it can only be reached by the model via read_skill"* is true for an
`llm-activated` trigger and for no other kind — `Agent.openSkillIds()` admits an open
pick only for that one. But `deriveTrigger` returns null for an unwired skill, so a
skill that arrived carrying a hand-authored `rule` trigger **kept it**, and the warning
promised a `read_skill` the gate would refuse. Three messages now, one per case: the
open skill, the `always` skill (which loads on every iteration rather than being
routed), and the rule-gated one (which `read_skill` cannot open at all).

### A tool name two sources claim, and which one actually runs

A `ToolProvider` and an active Skill can both declare `shared_tool`, and the two lose in
**opposite directions** — each by a rule of this codebase, not by a race:

- the tools slot merges `[static, provider, skill]` first-wins, and an
  `autoActivate: 'currentSkill'` skill's tools are deliberately kept out of the static
  registry — so the **provider's** schema, description and `inputSchema` are what the
  model reads;
- `lookupTool` resolves `registryByName` first, which holds every skill tool and no
  provider tool — so the **skill's** implementation is what executes.

The model reads one tool's contract and calls another's, and nothing anywhere said so.
Now `agentfootprint.tools.shadowed` fires every iteration, plus a latched dev-mode
console line. Not a refusal: a provider's list is resolved per iteration, so there is no
build-time moment at which this is knowable — a dynamic provider can begin shadowing on
iteration 9 of a run nobody is watching, which is exactly why the event is not
dev-gated. (The static `.tool()` ↔ skill-tool pair is unchanged: it is still refused at
build time, which is the better answer when the answer is available that early.)

### `skillScopedTools` returning `[]` forever

`ctx.activeSkillId` is the tail of `activatedInjectionIds`, which only `read_skill` ever
writes. A skill that activated because an entry rule matched or a `skillGraph()` edge
routed into it does not set it — so the provider returned an empty list on the very
iterations its skill was loaded. Its own docstring said so; nothing said it at the
moment it happened, and the tools simply never appeared.

`ToolDispatchContext` now carries **`activeSkillIds`** — every skill active this
iteration, however it got there. That makes the mismatch detectable from inside the
provider (composed into a larger provider or not), where it dev-warns; and it hands
every provider the graph-position signal `skillScopedTools`' own header called
impossible:

```ts
const graphScoped = (id: string, tools: Tool[]): ToolProvider => ({
  id: `graph-scoped:${id}`,
  list: (ctx) => (ctx.activeSkillIds?.includes(id) ? tools : []),
});
```

### Added

- **`multi-entry-fanout`, `dead-entry-step`, `model-edge-only`** — three `GraphProblemCode`
  values, all warnings. `GraphProblem.kind` gains no third member: widening that union
  would break an exhaustive consumer `switch`, and the codes carry the distinction.
- **`graph.checkup({ knownTools })`** (and the same field on `.build()` /
  `skillGraph({ knownTools })`) — the agent's baseline `.tool()` names. A graph knows
  only the tools its own skills carry, so a body saying `lookup_order(id)` was reported
  as naming a tool that exists nowhere. A `knownTools` name is now neither
  `body-unknown-tool` (it exists) nor `body-foreign-tool` (it is not somebody else's) —
  it is callable from every skill, which is the whole point. `checkSkillContract` /
  `checkSkillContracts` take the same option.
- **`formatCheckup`** is public on `agentfootprint/context` — the formatter the library
  itself uses to render a check-up for a thrown error, so a consumer printing
  `graph.checkup()` in CI stops writing their own. `checkupGraph` stays private: its
  input is the graph's internal wiring shape, and `graph.checkup()` is already the door.
- **`skillGraph({ tree, scopeTools })`** — parity with `.tree(root, { scopeTools })`.
  The object form hard-coded `true`, so the fluent form's only opt-out had no twin.
- **`ToolDispatchContext.activeSkillIds`** — the real active set for this iteration.
  Optional, so a provider written before 8.7.0 sees `undefined` and behaves as it did.
- **`agentfootprint.tools.shadowed`** (71 typed events now) — `{ toolName, iteration,
  schemaFrom, schemaFromId?, dispatchTo, dispatchToId? }`. Names only: never args, never
  results, never a description body.
- **`skillScopedToolsTarget` / `SKILL_SCOPED_TOOLS_ID_PREFIX`** — the provider-id
  convention, readable by anyone composing providers.
- **Dev-mode warnings** for two inert configurations: a `defineRelevanceHint()` mounted
  on a graph with no entry scorer (its trigger reads `ctx.entryScores`, which only
  `.entryBy()` / `.entryByRelevance()` writes — so it could never fire), and a
  `skillScopedTools(id, …)` aimed at a skill that already scopes its own tools with
  `autoActivate: 'currentSkill'`.
- **Examples** `features/46-skill-graph-checkup-deepens.ts` and
  `features/47-skills-from-dir-graph.ts`.

### Changed

- **`skillGraph().build()` defaults to `check: 'throw'`** (was `'warn'`), matching the
  object-literal form since 8.4.0. **Behavior change.** A fluent graph with an
  error-level problem — `no-entry` or `unknown-skill`, i.e. a graph that cannot start a
  turn at all — built in silence outside dev mode and surfaced as a run that entered no
  skill. What still builds: every graph whose check-up has no *error* (warnings never
  throw, however many); every call passing `check: 'warn'` explicitly, which still never
  throws, so the mode keeps its name and its meaning; `check: 'off'` skips entirely.
  Only code that was already shipping a graph the library could not start is affected.
- **`defineSkill({ viaToolName })` other than `'read_skill'` is refused when the skill is
  mounted.** **Behavior change.** It read as a promise — name a tool, and that tool
  activates the skill — and no such tool has ever been built. The evaluator activates an
  `llm-activated` skill by matching `ctx.activatedInjectionIds`, which only `read_skill`
  writes, and it has never read the field. A skill declaring `viaToolName:
  'open_playbook'` activated through `read_skill` exactly like every other skill, so the
  declaration described a door that does not exist. Nothing that worked stops working;
  a silent no-op becomes a named one, at `Agent.injection()` — the one funnel `.skill()`,
  `.skills()`, `.skillGraph()`, `skillsFromDir()` and a hand-built Injection all pass
  through. A graph that COMPILES the trigger away (an `.entry()` becomes `always`) has
  nothing left to refuse and is unaffected. The option is `@deprecated` on both
  `DefineSkillOptions` and `SkillsFromDirOptions`, and is removed in 9.0.0.

### Fixed

- **Six documentation files imported skill-graph symbols from doors that do not export
  them** — `README.md`, `docs/skill-graph-guide.md` (×5), `docs/design/skill-graph.md`,
  `docs/design/skill-graph-spec.md`, `docs/proposals/002-skill-graph.md` and
  `docs/guides/caching.md`. `src/index.ts` does not re-export the injection engine, so
  every `import { defineSkill } from 'agentfootprint'` in prose was broken; two also
  named `decide`, which was renamed `decideSkill` in 7.0.0 to stop colliding with
  footprintjs's own `decide()`, and one named `agentfootprint/observe`. All 18 runnable
  examples were already correct — they are compiled by `test:examples`, and markdown
  fences are not, which is precisely how this drifted.

### Documentation

- **The cursor is per RUN**, on `SkillGraph.nextSkill` and
  `InjectionContext.currentSkillId`. "Persisted across iterations" meant across the
  iterations of ONE `agent.run()`; a second run starts cold, at the entry, whatever the
  first ended on. Deliberate — a graph declares how one turn is routed, and a surviving
  cursor would make turn 2 start somewhere nobody declared — but never written down.
- **What a `SKILL.md` can and cannot carry.** `skillsFromDir` loads `name`,
  `description` and the body, and that is the entire per-file surface: no `tools` (a
  tool is code with an `execute`, and markdown has none), no `autoActivate`, no per-file
  `surfaceMode` (settable for the whole directory or not at all). Every loaded skill is
  body-only, with the pattern that limit points at — mix the loaded list with
  `defineSkill`-authored, tool-carrying skills and hand both to `skillGraph({ skills })`
  — shown in example 47.

### Tests

- +60, including the audit probes that found each of these as named regression seeds,
  and the two laws of the tool shadow pinned separately (which schema the model reads,
  which implementation dispatch resolves) so a change to either one fails loudly.

## [8.6.0] - 2026-08-06

### Consent is work, not conversation

A tool declares `needs: { credential: 'billing', mode: 'user' }`. The vault
answers `authorization-required` — a person has to click a link. Until now this
library wrote that link into the tool result and handed it to the model.

The model is the one party in the room that cannot click it. So it did what
models do with a refusal: it adapted, wrote a plausible final answer, and the run
returned `"done"` — 200, complete, invoice unpaid, nobody asked. That is not an
error path. It is a success report for work that never happened, and it is the
exact failure the `checkIn` gate, the middleware `ask`, and `PendingAsk` were all
built to prevent. The machinery to ask a human was already here; the credential
seam was the one door that never used it.

**A run now pauses when a declared credential needs consent.** `agent.run()`
returns a pause outcome; a `standingAgent` answers **202 Accepted** with
`{ awaiting }` carrying the service, the session id and the authorization URL;
`agent.resume(checkpoint)` re-resolves the credential and runs the tool that was
waiting. Same run, same conversation, work actually done.
`onAuthorizationRequired: 'tell-model'` keeps the model in the loop for callers
who want it — and even then the turn cannot report a completion it did not earn:
it raises `CredentialConsentRequiredError`.

### Added

- **`Agent.create({ onAuthorizationRequired })`** — `'pause'` (default) or
  `'tell-model'`. Governs what a run does when a tool's DECLARED credential comes
  back `authorization-required`.
- **`CredentialConsentRequiredError`** (`ERR_CREDENTIAL_CONSENT_REQUIRED`, from
  `agentfootprint/identity`) — carries `service`, `sessionId`, `authorizationUrl`,
  `tool` and `iteration`. The error *message* deliberately omits the URL, because
  a message is the one string that reliably reaches a log line.
- **`pauseData.authorization`** — `{ service, authorizationUrl, sessionId }` on a
  consent pause, surfaced by `standingAgent` as `PendingAsk.pauseData`. The
  hosting layer needed no change at all.
- **Example** `features/45-credential-consent.ts` — the pause, the caller's URL,
  the resume that does the work, and a grep over the whole recording proving the
  URL is in none of it.

### Security

- **An OAuth consent URL was written into the conversation, the trace, and every
  recording. It is a bearer capability, and it should never have been in any of
  them.**

  A 3-legged consent URL carries a `state` parameter that correlates the
  authorization session. Anyone holding the URL can complete the consent flow.
  Since **6.11.0** the library interpolated it into the tool result string, and
  from there it was copied — correctly, by design — into every channel that
  preserves tool output: the conversation history, `stream.tool_end`,
  `agent.iteration_end` (once per remaining iteration), `context.injected`, the
  footprintjs commit log and snapshot, the narrative recorder's `rawValue`, and
  any `recordRun()` recording. A single blocked tool call put the URL in a
  recording **78 times**.

  This is the mirror image of a guarantee the library kept carefully everywhere
  else. `agentfootprint.credential.authorization_required` was designed to carry
  `{ service, sessionId }` and never the URL; OTel and X-Ray record the tool
  result's *type* and never its value; the audit bundle's default `bounded` mode
  maps `tool_end.result` to `[type: string]`. Every observer channel was
  disciplined. The one channel nobody thought of as an observer — the
  conversation — was not, and it feeds all the others.

  The URL is now delivered only to the caller: on `PendingAsk` / the pause
  outcome under `'pause'`, and on `CredentialConsentRequiredError` under
  `'tell-model'`. What the model reads names the service and never the URL.
  `mcpServe` does the same at the served boundary, where the string previously
  crossed a process line into another agent's transcript.

- **Existing recordings and logs may contain consent URLs.** If you ran a tool
  with `needs: { mode: 'user' }` against a provider that returned
  `authorization-required` on **6.11.0 through 8.5.0**, the authorization URL —
  `state` parameter included — is in the artifacts of those runs. Consent URLs
  are normally short-lived and single-use, which bounds the exposure, but the
  durable sinks are worth walking:

  - **`sqliteSessions` / `agentCoreSessions` rows** — the conversation is
    persisted as plaintext JSON and survives restarts. `forget(sessionId)`
    removes it.
  - **CloudWatch log groups** (`cloudwatchObservability`) — the full event is
    written with no bounding layer. Log-group retention applies.
  - **`recordRun()` recordings written to disk** — both `snapshot` and `events`
    carry it.
  - **Audit bundles exported with `payloadMode: 'verbatim'`** — these are
    hash-chained and tamper-evident, so the record **cannot be redacted after the
    fact without breaking the chain**. Rotating the affected OAuth grants is the
    remedy, not editing the bundle. The default `'bounded'` mode was never
    affected.
  - **`consoleObservability()`** prints the payload to stdout — check whatever
    captures it.

  OTel spans, X-Ray segments, audit bundles in default `bounded` mode, and the
  context ledger were never affected.

- **Where the URL lives now, stated plainly.** Under `'pause'` it is on the
  pause outcome, on `PendingAsk`, and inside the engine checkpoint — so a
  `standingAgent` that persists a paused run writes it into **your** session
  store, alongside the conversation and shared state that store already holds.
  That is the caller's own durable store, chosen by the operator, and it is a
  strictly smaller exposure than the transcript sitting next to it; `forget(sessionId)`
  clears both. What changed is that the URL no longer travels to places nobody
  chose: the model's context, the narrative, the typed event stream, exported
  telemetry, and recordings meant to be shared with a viewer.

- **A blocked tool call is now flagged as an error.** In the main dispatch loop
  the `authorization-required` result set no `error` flag, so `stream.tool_end`
  reported it as an ordinary result and the OTel tool span closed **OK**. A tool
  that was refused a credential and never ran is not a success. This is a payload
  change in every mode, including `'tell-model'`.

### Changed

- **One behavior change, and it is the point of the release.** A tool whose
  declared credential comes back `authorization-required` no longer hands the
  consent URL to the model and lets the turn finish. By default the run
  **pauses** — `agent.run()` returns a `RunnerPauseOutcome`, a `standingAgent`
  answers **202** with `{ awaiting }`, and `agent.resume(checkpoint)` re-resolves
  the credential and runs the tool. Callers who relied on the model adapting
  in-loop set `onAuthorizationRequired: 'tell-model'`; the model then reads a
  refusal (never a URL) and the run raises `CredentialConsentRequiredError`
  rather than reporting a completion it did not earn.

  **Nothing that worked stops working.** The tool never ran under the old
  behavior either. What stops is the run's claim to have finished.

  **Unchanged:** `CredentialProvider`, `CredentialResult`, `CredentialNeed`,
  `ToolEndPayload`, `PendingAsk`, and every `credential.*` event payload. Issued
  credentials, machine mode, and provider-failure handling are byte-identical.
  `agentfootprint.credential.authorization_required` carries
  `{ service, sessionId }` exactly as before.

- **Docs stop saying the consent URL is surfaced to the LLM.** The AgentCore
  guide and `examples/features/17-identity.ts` both described the old flow in
  prose; both now point at the pause and at example 45.

### The judgements these rest on

**Consent is unfinished work, and unfinished work is a pause.** Every other place
this library needs a person — `checkIn`, a middleware `ask`, `askHuman` — stops
the run and hands the question to the caller through `PendingAsk`, which by
construction carries no checkpoint and no conversation. Consent was the one case
that instead wrote the question into the transcript and asked the model to solve
it. Routing it onto the same wire is not new machinery; it is the credential seam
finally using the machinery that was already load-bearing everywhere else.
`standingAgent`, `httpHost`, the session stores and the resume path needed no
change at all — the test that proves it is a copy of the `askHuman` one.

**Nothing that worked stops working.** Under the old behavior the tool did not
run. It still does not run. What stops is the run's claim to have finished — the
same judgement 7.19.1 and 7.20.0 rest on.

**The event was always right; the sentence was always wrong.**
`credential.authorization_required` has carried `{ service, sessionId }` since
6.11.0 precisely because a URL is not telemetry. The fix is not to redact a
channel — it is to stop putting a capability in a string that every channel is
built to preserve.

**A pause payload is not automatically private.**
`agentfootprint.pause.request` mirrors the whole `pauseData` into its
`questionPayload`, which is right for a check-in's evidence pack and wrong for a
bearer URL. The consent URL is withheld from that payload by name — the same
discipline the audit adapter's bounded fields already apply to
`tool_end.result` — and the token-secrecy suite now pins both halves as one law:
**no credential material, vended token or consent capability, reaches the
conversation, the snapshot, the narrative, the event stream, or a recording.**
The security tests are written as a grep over the serialized artifacts rather
than a field-by-field check, so a NEW sink that starts copying tool output fails
them too. That property is what was missing: the old clause only ever looked for
an issued token, and the consent URL walked straight past it.

**The `'tell-model'` record travels off tracked state.** A tracked write is a
commit-log entry, which is the snapshot, the narrative and every recording —
so a scope key holding the URL would have rebuilt the exact leak this release
removes. It rides a private field on the Agent for the length of the run, and
leaves only as the typed error.

**A resume cannot pause again, and the design does not pretend otherwise.**
footprintjs's `ResumeFn` returns `void`. If consent is still ungranted when a run
resumes, the tool gets the URL-free refusal with `error: true`, the loop carries
on, and a further attempt can checkpoint afresh through `execute` — a new consent
round with a new URL on `PendingAsk`. The resume input is ignored throughout: the
person's answer is "I authorized it", not a result, which is the same reasoning
that gave the middleware-ask outcome union no `result` arm.

### Deferred (documented follow-ups)

- **Per-tool `needs: { onAuthorizationRequired }`** — an agent-level default is
  what ships, because one canonical path first. The asymmetric case is real and
  named here so the destination is on record: a payment tool must pause, while an
  optional enrichment tool may legitimately want the model to route around a
  consent block. Resolution would be `need.onAuthorizationRequired ?? agentDefault`
  — three lines — and it earns its knob on field evidence, not on this argument.
  (6.11.0 deferred "auto-pause-on-3LO" in exactly this way and it was the right
  call; what was missing was anyone reading the note for five minors.)

## [8.5.0] - 2026-08-06

**`read_skill` tells the whole truth.** 8.4.0 stopped a skill graph from throwing
away what the author declared. This one stops it from telling the *model* things
that were not so. Five findings, all of the same shape: the library said a thing had
happened, or offered a thing it would refuse, or recorded a cause that was not the
cause. One is a build-time refusal, one is a gate refusal, three are fixes.

### A decision `tree()` cannot be jumped — and now says so

A `tree()` routes by predicate on every iteration. It has no cursor, so `read_skill`
has nothing to move. But `graph.reachableSkills()` reported **all the leaves**, so
the gate accepted a leaf pick and `read_skill` answered *"Skill 'x' activated for the
next iteration"* — and nothing happened. A leaf compiles to a `rule` trigger; a
`read_skill` call writes only `activatedInjectionIds`; no `rule` trigger reads that.
The leaf never activated, the tree re-decided by predicate, and the run then emitted
`agentfootprint.skill.reroute_superseded` naming a winner that **did not exist** —
tree mode never writes a cursor at all, so the payload carried neither `wonId` nor
`fromSkillId`. Three sentences of the library, false at once.

Honouring the pick was the other option, and the tree's own rules refuse it: exactly
ONE leaf fires per iteration (the library ships a dev-mode monitor that warns
otherwise), each leaf's tools are scoped on that basis (`TreeOptions.scopeTools`),
and `toMermaid()` draws only predicate branches — a model lever over that routing is
not on the drawing. And 8.4.0 already settled the general rule: a pick is admitted
only for the one trigger `read_skill` can fire, `llm-activated`. A leaf's trigger is
a `rule`. Tree mode was the single set that had escaped that rule.

So the gate refuses, in terms that teach:

```text
read_skill("capacity") cannot move a decision tree. A tree routes by predicate on
every iteration — it has no cursor to jump, so this skill would not activate even
though the tool accepted the name. Answer with the skill the tree routed to, or finish.
```

**Behavior change:** `graph.reachableSkills()` now returns `[]` for a decision
`tree()`, from every cursor. Its contract is "what `read_skill` may jump to", and
all-leaves was the lie; use `graph.skills` to enumerate leaves, which is what it was
always for. `read_skill` is not dead under a tree — anything registered *beside* the
graph (`.skill(x)`, `.skills(reg)`, `.selfExplain()`) is **open** and still admitted
from anywhere, because those really do activate by `read_skill`. Two docstrings that
promised "read_skill stays a full escape hatch there" are corrected.

### `read_skill` offers what the gate will actually grant

The tool enumerated every registered skill — in its enum and in the catalog inside
its own description — while the gate admitted only `reachableSkills(cursor) ∪ open`.
The model was handed a menu the library already knew it would reject: a route target
the cursor cannot reach was advertised on every iteration and refused on every call,
which costs tokens and can burn a whole run on re-asking.

The description is now rebuilt each iteration from the same two functions the gate
itself calls, so the menu and the verdict cannot disagree:

```text
Reachable from here:
  - volume-lookup: Resolve a volume by WWN
  - escalation: How to page the on-call engineer

Not reachable from here (read_skill for these will be refused):
  - capacity-report: Report free capacity per volume
```

**The enum stays the full catalog, deliberately.** `toolArgValidation` defaults to
`'enforce'` and runs *before* the gate; an off-enum id is rejected with a generic
schema error and never reaches it. Narrowing the enum would therefore have retired
the gate's teaching refusal, the `agentfootprint.skill.rejected` event,
`routeRecorder`'s rejection hops and the rejected-cap governor's only input — four
honesty mechanisms traded for one.

Under `reactMode: 'classic'` the tools slot is composed on turn 1 only, so a
cursor-scoped menu would freeze at the cold-start cursor and keep advertising it: the
full catalog stays there (the honest fallback), and dev mode warns and names the fix.
Agents with no skill graph keep the byte-identical description they always had.

### `surfaceMode: 'tool-only'` is refused when nothing activates by `read_skill`

`'tool-only'` means "suppress the body from the system slot and deliver it as the
`read_skill` tool result." That channel exists only when the model calls
`read_skill`. A skill the **graph** activates never gets that call — so for a route
target, a graph entry or a tree leaf, the tool result never happened, the system slot
suppressed the body anyway, and the body reached the model **nowhere at all**. Its
tools still arrived, which is worse than the skill not loading: the model was handed
the tools of a procedure nobody described.

Refused now at agent build time, keyed on the compiled trigger — the same
`llm-activated` clause 8.4.0's gate turns on — and naming every offender with its
routing, so a `skillsFromDir({ surfaceMode: 'tool-only' })` directory refuses as a
readable list rather than one mystery:

```text
Agent: This skill sets surfaceMode: 'tool-only', … its body would reach the model
NOWHERE …
  • "beta" — a route target (the graph routes "alpha" → "beta")
Use 'both' (system prompt AND tool result) or 'system-prompt'.
```

Refusal rather than a quiet fall back to the system slot: the author wrote
`'tool-only'` to keep the body *out* of the system prompt, and silently putting it
back would honour the activation while breaking the declaration — a different lie,
not a fix. `'both'` already means "deliver it either way".

Unaffected: `.skill()` outside a graph, a bare model edge target (`.route(a, m)` with
no `when`/`onToolReturn`), and every open skill — all keep `llm-activated`. A new
`resolvedSurfaceModeOf()` helper routes both the current question and the
provider-resolution question through one function, so wiring the `'auto'` cascade
into the runtime later cannot reopen this hole for non-Claude providers by accident.

### `routeRecorder` stops attributing a model pick to a declared edge

A `read_skill` hop the gate accepted was recorded as `outcome: 'route'` wearing the
caption of whatever declared edge happened to point at the same skill — so the trace
asserted that edge had fired when its predicate never ran. The cause was being
inferred from `routing[]`, which is per-**skill** build-time provenance ("how is this
skill reachable at all"), not per-**hop** runtime truth.

The graph's one cursor resolver now reports the clause that won. `nextSkill(ctx)` is
unchanged and is the `.to` projection of it, so there is no second implementation to
drift:

- `SkillGraph.explainNextSkill(ctx)` → `{ from?, to?, by }` where `by` is
  `'entry' | 'route' | 'model-pick' | 'stay' | 'none'`;
- `agentfootprint.context.evaluated` carries it as the new optional `cursorMove`;
- `routeRecorder()` reads it, and a `'model-pick'` hop carries **no** `edgeLabel`.

This settles the one case no observer could reconstruct: an edge and a same-turn pick
naming the *same* skill resolves to `'route'` (`D1 > D2`), and only the resolver
knows. Without `cursorMove` (an older graph, an older recording) the previous
inference still stands.

**Type widening:** `RouteOutcome` gains `'model-pick'`. An exhaustive `switch` over
it will fail to compile until the case is added.

### `routeRecorder({ maxRejectedRetries })` can finally trip

`consecutiveRejected` reset on every `context.evaluated` — and one fires between
every pair of rejections — so the count never passed 1 and the governor was
unreachable outside a single iteration's parallel tool batch. Five consecutive
out-of-reach jumps against a cap of two produced zero trips.

It now resets only when the cursor actually **moves**, which is precisely what a
model stuck re-asking never achieves; a `'stay'` no longer clears the run. Each run
of rejections trips **once** and re-arms on the next real move, instead of pushing a
duplicate trip on every iteration past the cap.

## [8.4.0] - 2026-08-06

**Dead skills.** Five combinations a skill graph accepted and then silently gutted.
Four of them threw away part of what the author declared at build time and said
nothing — two even reported `checkup() → { ok: true, problems: [] }` afterwards. The
fifth threw away a capability at run time: the gate that keeps the model inside the
graph also refused every skill the graph does not route, including the library's own
`.selfExplain()` debug skill. Three are now refusals that name the fix, one is a
refusal on the agent, and the gate one is a fix, not a refusal.

### The `read_skill` gate stops refusing skills the graph never routed

`.skillGraph()` bounds `read_skill` to `graph.reachableSkills(cursor)`, so the model
cannot move the graph somewhere the graph doesn't go. That set is about the CURSOR,
but it was being used as the whole catalog, so three shapes were dead:

| you wrote | before | now |
|---|---|---|
| `.skillGraph(g).selfExplain()` | `read_skill('self-explain')` rejected on every call — the debug skill and its six trace tools could never load | activates; the trace tools reach the model on the next iteration |
| `.skillGraph(g).skill(x)` / `.skills(reg)` | `x` was listed in `read_skill`'s own menu and refused every time; its body was unreachable | activates |
| `skillGraph({ skills: [..., x] })` with `x` wired to nothing | refused — while its check-up warning said *"it can only be reached by the model via read_skill"* | activates; the warning is true again |

A skill is **open** when its trigger is `llm-activated` (the trigger `read_skill`
actually activates — a rule-gated injection is still refused, because admitting it
would just be a different lie) **and** the graph declares no incoming edge to it. An
open pick **activates but never moves the cursor**: a skill the graph does not route
is not a node, so it cannot be a hop, and the graph stays exactly where it was.

What stays bounded is everything the graph wires — including a **bare model edge**
`.route(a, m)`, which is a declared, drawn affordance and remains reachable only from
`a`. `graph.reachableSkills()` is unchanged: it still answers about the graph alone,
and the union with the open skills happens at the agent's gate, which is the only
place that knows what else is registered. The gate's re-prompt and the
`agentfootprint.skill.rejected` payload both report that union — what the gate
accepts — so a graph with no open skills reports byte-identically to before.

Named plainly: if you registered unrelated skills beside a graph expecting the graph
to hide them, they are now reachable by name. They were already being advertised to
the model in `read_skill`'s menu and then refused, which cost tokens and could burn a
whole run on re-asking; the cursor still cannot leave the graph, and nothing routes
from an open skill.

### Four refusals, each naming the fix

**A `.tree()` and the flat wiring are two declarations of one thing.** Only the tree
compiled; every `.entry()` and `.route()` — and, in the config form, `start` and
`steps` — was dropped in silence.

```text
skillGraph: .tree() and .entry()/.route() both declare the routing and only one can
compile — the tree wins, so the 1 entry declared here would be silently dropped.
tree() owns the graph: remove the .entry()/.route() calls, or drop .tree() and route
with the flat entry/route form.
```

`SkillGraphConfig` is now a **union** of a tree arm and a flat arm, so
`skillGraph({ tree, start })` is a compile error as well as a build-time refusal.
Valid tree-only and flat-only configs typecheck exactly as before; the two arms are
exported as `SkillGraphFlatConfig` / `SkillGraphTreeConfig` (plus `SkillGraphStart`
and `SkillGraphStep`) for consumers that name the shape.

**A tree routes to its leaves and nothing else.** A skill listed in `skills[]` that
was not a leaf was compiled out of the graph entirely — it never reached the agent,
so it had no trigger, no `read_skill` row, no body, ever.

```text
skillGraph({ tree }): skill "alpha" is listed in skills[] but is not a leaf of the
tree, so it would never load — a tree routes only to its leaves. Add it to the tree
as a leaf, drop it from skills[], or register it on the agent with .skill(alpha) to
keep it read_skill-reachable.
```

That last option is the escape hatch this release makes real.

**Two skills, one id.** `skillsFromDir` refuses a collision inside its own directory
and `Agent.injection()` refuses one on the agent; the graph was the only place where
two skills could quietly claim one id — the id `read_skill` dispatches by and every
edge routes by. Last write won in the flat form, FIRST write won under a tree, and
the loser vanished. Now refused, naming both by description. Re-registering the SAME
object is still fine: `.entry(a).route(a, b)` and one skill at two tree leaves are
how the builder is meant to be used.

**One agent, one graph.** A second `.skillGraph()` replaced the cursor, the reachable
set and the entry scorer while the first graph's skills stayed registered and active
— so graph 1's route targets could never activate again (their ids are absent from
graph 2's reachable set, so even a model pick was refused) and only its unconditional
entries survived, as always-on bodies with dead wiring. Refused, with the merge as
the fix.

### The tree check-up stops being a no-op

Tree leaves are now registered as they compile. Two things follow: the duplicate-id
refusal covers leaves, and the **skill-contract checks finally run for a fluent
`.tree()` graph** — before, `skillsById` stayed empty there, so `checkup()` answered
`{ ok: true, problems: [] }` for a tree whose body called a tool that exists nowhere,
while the byte-identical config-form graph reported it. A valid fluent tree may
therefore report contract WARNINGS it never reported before. That is the fix working;
contract findings are warnings only, so `check: 'throw'` is unaffected.

Everything else about a valid graph is unchanged: same `skills`, `edges`, `nodes`,
triggers, `toMermaid()` and `reachableSkills()`.

## [8.3.0] - 2026-08-06

**`read_skill` stops lying.** When a skill graph offered the model `read_skill`
and the model called it, the tool answered:

```text
Skill 'esxi-inventory' activated for the next iteration.
```

For most graphs that sentence was false. The id was appended to
`activatedInjectionIds`, which only a bare `llm-activated` skill ever reads — so a
skill whose activation was cursor-gated (a route target, an exclusive entry) or
rule-gated (an intent entry whose rule didn't match) simply never loaded. The
agent was told a thing had happened that had not happened, in its own context,
and then reasoned on top of it.

The worst shape of it: a `start: { rules: [...] }` graph, and a user phrasing no
rule anticipated. Nothing matches, so nothing activates; `read_skill` is the only
tool offered; the model calls it, is told the skill is active, and gets the same
empty tool list on the next iteration — **forever**. No skill, no tools, no error,
no event. Our own guide listed that fallback under "shipped and usable", and the
design doc had specified the missing step (§4A.1 "D2 — validated volunteer
reroute") three versions ago. The gate was built; the move it gated was not.

### An accepted pick now moves the cursor

`read_skill` is already bounded to `graph.reachableSkills(cursor)` — the declared
successors of where the model stands, plus the entries. A pick that gate **accepts**
now moves the graph's cursor exactly like a declared edge does, so the skill's
body and tools land on the next iteration and the graph's own `steps` run from
there. What the gate allows and what takes effect are the same set.

```
a declared edge that fired   >   the model's pick   >   stay where you are
```

The author's determinism is untouched: an edge that fires on the same turn
outranks the pick (a model guess never overrides a route the author pinned). The
dropped pick is reported rather than swallowed — see the new event below.

### `agentfootprint.skill.reroute_superseded` (new typed event — 70 total)

Fires in exactly one case: a `read_skill` the gate accepted did not end up active
because a declared edge won the same turn (the model emitted a domain tool *and*
`read_skill` in one message). Payload: `{ volunteeredId, wonId, fromSkillId,
iteration }`. It is derived from the real active set, not from which clause won,
so it cannot fire for a pick that did take effect.

### Two behavior changes worth naming

Both are activations that previously no-opped and now work. Nothing that worked
before stops working; a graph whose rules match is byte-for-byte unchanged (the
rule is evaluated first and short-circuits), and an agent with no `skillGraph()`
never engages any of this.

1. **A declared `step` INTO a skill that is also a rule entry now activates it.**
   This was live and silent: `steps: [{ from: 'esxi', to: 'volume-lookup' }]`
   where `volume-lookup` is also an entry rule moved the cursor and left the
   skill dark, because its compiled trigger was its own entry rule — written for
   the user's message, not for the hop. The cursor and the active set disagreed,
   which the skill-graph module's own keystone says can't happen. Now an intent
   entry is active when **its rule matches OR the cursor is on it**.
2. **A `when`-gated entry the model explicitly picks now loads.** `when` gates the
   AUTOMATIC pick; it was never authorization (no identity is in scope for it).
   Previously the pick was accepted, reported as activated, and dropped —
   documented as a caveat on `.entryByRead()`, which is just this bug wearing a
   disclaimer. Use `when` to say "don't route here on your own", not as a lock.

### Also

- `skillScopedTools()`'s doc was stale in a way that cost people wiring time: it
  said the runtime populating `ctx.activeSkillId` was still to come (it ships),
  and never said that `activeSkillId` is the last **`read_skill`** activation
  only — a skill activated by a rule or by a graph edge does not match it — nor
  that an agent takes **one** `ToolProvider` (a second `.toolProvider()` call
  throws). It now leads with the case where you don't need the provider at all:
  `defineSkill({ tools, autoActivate: 'currentSkill' })`.
- `graph.nextSkill(ctx)` reads the new `InjectionContext.pendingSkillPick`, and
  the compiled triggers share one memoized view of the resolver per evaluation
  pass — a 15-entry regex router costs the same per iteration as it did before.

→ runnable + tested: **`examples/features/42-skill-graph-model-pick.ts`**.

## [8.2.0] - 2026-08-06

**Durable compaction.** An agent that has been up for a week folds week one
into a summary. Then it gets deployed over. It comes back, is handed the same
conversation — and now it can still tell you what week one was about, *and*
show you week one, word for word.

The window half of that already worked: a summary is an ordinary message, so
`agent.checkpoint()` carried it and `resumeOnError()` restored it. What did not
survive was everything behind it. The folded turns lived in the run's commit
log, which is memory, and memory ends when the process does.

### The one behavior change: the summary stops making a promise it cannot keep

Through 8.1 every compacted frame ended with a fixed sentence:

```text
The folded messages are retained verbatim in this run's commit log.]
```

True while the run was alive. False the moment it ended — which is exactly when
a standing agent reads that message back out of storage and hands it to the
model. A library asserting something false inside the model's own context is
worse than a library saying nothing, so the sentence is now written from the
retention policy and can only say what actually happened:

```text
The folded messages are retained verbatim with this conversation and can be
produced on request.]                                    ← retain: 'conversation'

The folded messages were not retained beyond the run that folded them; only
this summary carries them forward.]                      ← retain: 'discard'
```

This changes the bytes sent to the model for every agent using `.compaction()`.
`COMPACTED_FRAME_PREFIX` is **unchanged**, so `isCompactedSummary()` and every
reader matching on the prefix keep working exactly as before.

### `.compaction({ retain })` — the originals ride the conversation

```ts
.compaction({
  thresholdTokens: 120_000,
  summarizer: anthropic(),
  retain: 'conversation',   // the default, spelled out
})
```

`agent.checkpoint().folded` is now one `FoldedSpan` per fold — the summary's
fingerprint, the run whose commit log held the originals, how many there were,
which stages wrote them, the policy, and (under the default) the messages
themselves. It accumulates across every turn, restart and deploy, and rides
into whatever store you chose: `sqliteSessions`, a Redis, your own table.

- **`'conversation'` is the default.** Losing the originals takes a deliberate
  `retain: 'discard'` — the honest behavior is not something you opt into.
- **A discard is still recorded.** Under `'discard'` the span is filed anyway,
  naming what left and how much of it; only `messages` is absent. An absence is
  a fact, and this family has always filed absences.
- **One commit.** The window change and its span are written together, so there
  is no state in which messages left the window and the record of what they
  were did not follow. A summarizer that throws still folds nothing at all.
- **No format bump.** `folded` is an optional field on `conversation-v1`. An
  older runtime reads the checkpoint, ignores the field and continues the
  conversation correctly; a newer runtime meeting a pre-8.2 conversation finds
  no spans and says so rather than inventing them.

**The trade, stated plainly: compaction shrinks the wire, not the record.** A
stored session grows as it folds, by roughly the size of everything it has ever
folded. That is the right way round — the model's context window is scarce and
a session row is not — but it is a real cost on disk and should not be a
surprise.

### New exports

| export | what it is |
| --- | --- |
| `foldedSpanFor(conversation, message)` | The span behind one summary, joined by **content fingerprint** rather than index — a later fold swallows an earlier summary and every index after it moves. `undefined` means "no fold was recorded for this message", never "there were no originals". |
| `foldedMessages(conversation)` | Every retained message from every span, oldest fold first. |
| `FoldedSpan` · `CompactionRetention` · `FoldedConversation` | The types. |

The fingerprint is also what makes the join **forgery-proof**: `isCompactedSummary`
answers "this *looks* like a frame", which is all a prefix check can see, and a
model that copies the frame's opening words passes it. `foldedSpanFor` answers
the stronger question — different content, different fingerprint, no match.

The strategy seam grew with it: `WindowStrategyResult.folded` lets any custom
strategy that replaces messages with something standing for them carry the
originals the same way, and `WindowStrategyInput.runId` names the run for it.

- Docs: [Durable compaction](docs-next/content/docs/build/compaction.mdx)
- Example: `examples/context-engineering/14-durable-compaction.ts` — folds, stores
  the session in a real SQLite file, and continues it on a brand-new agent that
  answers from week one and can still print week one verbatim.

## [8.1.0] - 2026-08-06

**The middle rung of the ladder now holds weight.** `ollama('llama3.2')` runs a
real model on your own machine: no API key, no bill, and — new in this release —
no vendor SDK.

The adapter ladder is `mock()` → a local model → a paid API, and the strongest
version of "the test run and the production run are the same code path" is one
where the middle step costs nothing. A mock proves your control flow; it cannot
tell you whether a real model calls your tool, or what it makes of a tool
description you wrote in a hurry. A local model can — and if finding out is
free, you'll actually do it before you pay for it.

### `ollama()` now talks Ollama's native API

Through 8.0.0, `ollama()` was a thin wrapper over `openai({ baseURL })`. Three
things followed from that, and all three contradicted what the name promises:

- it required `npm install openai` — **the free rung depended on a paid
  vendor's SDK**;
- its failures were labelled `[openai]`, on a provider named `ollama`;
- it reported **zero tokens on every streamed call**, which silently disarmed
  `.compaction()` and any cost budget counted from adapter-reported usage.

It now speaks `/api/chat` directly over `fetch`. Same public contract (the
`LLMProvider` port), higher fidelity, one fewer dependency.

**Your code keeps working.** The object form shipped in 8.0.0 is still accepted
as an overload — `host`, `baseURL`, `defaultModel`, and `apiKey` (accepted and
ignored; there is no key to send) all keep their meaning. The shorter positional
form is new:

```ts
ollama({ host: 'http://localhost:11434', defaultModel: 'llama3.1' }); // still fine
ollama('llama3.1'); // new, and the one to reach for
```

**If you specifically want the SDK path, it never went away** — ask for it by
name, which is also how you reach any other OpenAI-compatible server:

```ts
openai({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' });
```

### Refusals that contain the fix

Two things go wrong with a local runtime, and each has a one-command answer. Both
now raise a typed `OllamaUnavailableError` (discriminated by `reason`) whose
message *is* the instruction — never a raw `ECONNREFUSED`, never a bare `404`,
and never a hang: a deadline bounds the wait for the daemon to answer (not
generation, so a slow model is untouched).

- **Daemon not running** — names the address it tried, `ollama serve`, the
  install link, and how to point somewhere else.
- **Model not pulled** — names `ollama pull <model>`, and asks `/api/tags` so it
  can also list what this machine *does* have.

### Also in this release

- **Real token counts, streaming included.** `/api/chat` reports
  `prompt_eval_count` / `eval_count` on every response with no opt-in flag, so
  compaction and cost budgets work against a local model.
- **Thinking blocks from local reasoning models.** `ollama('deepseek-r1', { think: true })`
  asks Ollama to lift reasoning out of the answer; the new `ollamaThinkingHandler`
  auto-wires by provider name and normalizes it. When a model was *not* asked and
  writes `<think>…</think>` into the answer instead, the library **recognizes the
  shape and surfaces the blocks, but does not edit the answer** — silently
  rewriting model output is a change of meaning, and that belongs to the
  application.
- **`providerFromEnv()` gains a local arm.** `OLLAMA_MODEL=<model>` selects it,
  and is checked **first**. Every other arm triggers on a credential, and
  credentials linger in a shell; `OLLAMA_MODEL` is a name someone chose and typed
  for this run, so honoring a leftover API key over it would ignore the intent and
  charge for the privilege. (`OLLAMA_HOST` alone is not a trigger.) No probing —
  the function reads environment variables and never opens a socket, so its answer
  stays instant and identical on a laptop and in CI.
- **Honest ceilings, stated rather than worked around.** Tool calling is
  model-dependent (no capability preflight — a wrong refusal is worse than a weak
  answer); `carriesForcedToolChoice` stays `false` because Ollama supports no
  `tool_choice`; tool-call ids are synthesized because most local models emit
  none; no multi-modal, no prompt caching, no `providerRef`.
- Docs: [Ollama](https://footprintjs.github.io/agentfootprint/docs/build/ollama)
  rewritten, with an upgrade note. Worked example:
  `examples/features/41-local-model.ts` runs one agent across all three rungs and
  runs offline.
- Tests: +116, including an adapter-swap law (same agent on `mock()` and
  `ollama()` produces the same answer, tool dispatch, iteration count and event
  sequence) and a live-daemon suite behind `AGENTFOOTPRINT_OLLAMA_LIVE` that skips
  loudly when the flag is absent.

## [8.0.0] - 2026-08-05

**26 doors become 10.** Nothing about how agentfootprint behaves changed. What
changed is how many places you have to know about to import from it.

Through 7.x the `exports` field grew one subpath per internal concern, and the
names came from how the library is built rather than what you are doing with
it: `llm-providers` and `memory-providers` and `tool-providers` and
`hosting-providers` and `observability-providers`; `resilience` next to
`reliability`; `injection-engine` describing our machine instead of your task;
five separate doors for observability alone. A person deciding where to import
from had to learn our filing system first.

The doors are now named for the job:

`agentfootprint` · `/providers` · `/memory` · `/observe` · `/context` ·
`/resilience` · `/security` · `/hosting` · `/events` · `/cache`

**Every old import path still works, unchanged, for all of 8.x.** They are
marked `@deprecated` so your editor points at the new door; nothing is logged,
nothing breaks, and each one re-exports the *same symbols* the door carries —
not copies. `test/api-conformance/door-aliases.test.ts` drives the TypeScript
checker over the shipped `.d.ts` files to prove it, name by name, so the
aliases cannot drift. They are removed in 9.0.0.

### Migration

| you were importing from | import from |
|---|---|
| `agentfootprint/llm-providers` | `agentfootprint/providers` |
| `agentfootprint/embedders` | `agentfootprint/providers` |
| `agentfootprint/tool-providers` | `agentfootprint/providers` |
| `agentfootprint/thinking` | `agentfootprint/providers` |
| `agentfootprint/memory-providers` | `agentfootprint/memory` |
| `agentfootprint/observability-providers` | `agentfootprint/observe` |
| `agentfootprint/strategies` | `agentfootprint/observe` |
| `agentfootprint/stream` | `agentfootprint/observe` |
| `agentfootprint/status` | `agentfootprint/observe` |
| `agentfootprint/locales` | `agentfootprint/observe` |
| `agentfootprint/debug` | `agentfootprint/observe` |
| `agentfootprint/debug/finders` | `agentfootprint/observe` |
| `agentfootprint/observability/contextError/finders` | `agentfootprint/observe` |
| `agentfootprint/reliability` | `agentfootprint/resilience` |
| `agentfootprint/hosting-providers` | `agentfootprint/hosting` |
| `agentfootprint/injection-engine` | `agentfootprint/context` |
| `agentfootprint/identity` | `agentfootprint/security` |

`agentfootprint`, `agentfootprint/memory`, `agentfootprint/observe`,
`agentfootprint/security`, `agentfootprint/hosting` and
`agentfootprint/resilience` keep their names and carry more than they did.

### Two doors that stayed put, on purpose

- **`agentfootprint/cache`** is not folded into `/memory`. Importing it RUNS
  the vendor cache-strategy registrations — it is the one side-effectful
  barrel in the package. Folding it in would mean `import { defineMemory }`
  executing those registrations and carrying them in every bundle. Side-effectful
  code stays behind its own plainly-named door.
- **`agentfootprint/events`** is not folded into `/observe`. It is the typed
  wire vocabulary observers *read*, not a tool for watching — and concretely,
  its `ContextSource` (the injection-flavour union: `'rag' | 'skill' | …`) is a
  completely different type from the `ContextSource` `/observe` already carries
  (the context-bisect record). Two incompatible shapes cannot share a door.

### One name that exists twice, said out loud

`CircuitOpenError` is TWO classes: the provider decorator throws one, the
reliability gate throws another, and they differ in constructor and in
`instanceof`. The merged `agentfootprint/resilience` door carries the
**decorator's** — the one that escapes a provider call. The gate's stays at
`agentfootprint/reliability` for all of 8.x.

If you `instanceof`-check the error the reliability gate throws, keep importing
it from `agentfootprint/reliability`. Every other name on that path moved to
the door. Merging the two classes would have changed the error message on one
path, and this release changes packaging only.

(`CircuitState` also exists twice, but the two are byte-identical —
`'closed' | 'open' | 'half-open'` — so the door carries one and no consumer can
tell. Both facts are pinned as test literals that cannot silently grow.)

### Added — `.watch()`

`.act()` says what an agent may do. `.watch()` says who is looking while it
does it. The loop's own source has described this pair in prose since the
moments were written down — "an observer reports, a rule changes what happens
next" — while naming an API that did not exist. It does now.

```ts
const agent = Agent.create({ provider, model })
  .watch(toolChoiceRecorder({ embedder: staticEmbedder() }), routeRecorder())
  .act({ beforeTool: [budgetGuard] })
  .build();
```

Variadic, because observers come in sets. Build-time attach, so the observer
sees the very first run. `agent.attach(observer)` is unchanged — that is the
runtime door, and it still returns the `Unsubscribe` you own.

`Watcher` is exported from the main barrel: the plain name for footprintjs's
`CombinedRecorder`, which is what `.watch()`'s signature reads as.
`CombinedRecorder` keeps its export too.

There is deliberately **no** `WATCH_MOMENTS`. `.act()`'s keys are a closed,
compiler-pinned list because a rule has to be *told* where it may speak; an
observer attends the whole stream, and a list we published would be a
vocabulary we then had to keep true against every event ever added.

### Deprecated

- `AgentBuilder.recorder(rec)` — use `.watch(...)`. Same list, same order, same
  attachment; `.watch()` takes more than one. Still works for all of 8.x.
- The seventeen import paths in the migration table above.

### Fixed

- `AGENTS.md` and six shipped `ai-instructions/` files still advertised
  `agentfootprint/memory-redis` and `agentfootprint/memory-agentcore` —
  subpaths **removed in 4.0.0** — including as live `import` statements. They
  taught coding assistants to write imports that cannot resolve. Now pointed at
  `agentfootprint/memory`.
- The published architecture page's subpath table listed the same two dead
  aliases plus a `./providers` row describing the 4.0.0 alias, which no longer
  means what it says.

### Packaging

- `exports` goes 26 → 28 entries: 10 doors + 17 deprecated aliases +
  `./package.json`. Every entry keeps the four-condition shape (per-condition
  types for `import` and `require`); `typesVersions` mirrors it entry for entry,
  now asserted rather than assumed.
- `"type": "commonjs"` declared, and `repository.url` is a full `git+https://`
  URL — publint's two outstanding suggestions, cleared.
- Door barrels live in `src/doors/`. The implementation barrels did not move,
  which is what makes the aliases identity-preserving rather than parallel
  copies.

## [7.28.0] - 2026-08-05

A paused agent is a promise you made to a person. Until this release the library
handed you that promise as JSON and wished you luck: *store it anywhere.*
Anywhere was the whole of the offer.

`sqliteSessions({ file })` is the first battery included — the same
`SessionLifecycle` port `memorySessions()` implements, backed by a real file, on
Node's built-in `node:sqlite`. **No dependency to install, no service to run.**

```ts
import { standingAgent, nodeHost, sqliteSessions } from 'agentfootprint/hosting';

const handle = await standingAgent({
  agent,
  sessions: sqliteSessions({ file: './sessions.db' }), // ← the whole change
  host: nodeHost({ port: 8080 }),
});
```

**Two gaps, and they turn out to be the same gap.** A conversation had two homes
and no middle: `memorySessions()` is a `Map`, exactly as durable as the process,
and the next step up was "bring a Redis" — a service to run, secure, back up and
pay for, to keep a few kilobytes of chat. Everyone in between wrote the same
little file store themselves and each one re-decided what a half-written file
means. A pause had no home at all: a question outstanding is the one piece of
agent state that *must* outlive the process, because the answer arrives on human
time — after lunch, after the deploy, tomorrow. Both land in one table here,
because `CheckpointEnvelope` was already a union of the two and a session store
has no business caring which half it is holding.

**What it is, stated as a ceiling rather than left to be discovered.** One
process (or a few) on ONE machine, writing ONE file. It survives anything that
ends the process and leaves the disk alone. It is **not** a distributed store:
two machines do not share a session by both opening a file over a network
filesystem. WAL gives many readers plus **one writer at a time**, and that is
the ceiling — a second writer waits for the lock up to `busyTimeoutMs` (default
5000) and then fails loudly rather than queueing forever. When you outgrow it,
one argument to `standingAgent` changes and nothing above it moves.

**A refusal where a fallback would have been easier.** `node:sqlite` ships with
Node 22.5+ (as-is from 22.13 and 23.4; behind `--experimental-sqlite` on
22.5–22.12). `engines` did **not** move for one optional adapter — it stays
`>=20`, the module is loaded only when you construct a store, and its absence
raises `SqliteUnavailableError` naming the Node you are on, the flag, and
`memorySessions()` as the honest alternative. There is deliberately no silent
degrade to memory: a store that quietly forgot every conversation on restart
passes every smoke test and looks, from the outside, exactly like a brand-new
user.

**"Unreadable is not absent", one level up.** The envelope law already said an
unreadable stored conversation and an absent one are different facts, and only
one is safe to answer with a fresh start. A file store can break that promise
higher up — point it at a log file and a careless adapter opens it as an *empty*
store. So the file is checked at construction and refused with
`UnreadableSessionFileError`, whose `problem` field is the fact to branch on:
`'cannot-open'`, `'not-our-schema'` (somebody else's table of that name), or
`'newer-schema'` (written by a newer runtime — refused, never half-read). Only a
session that was never written hydrates as `undefined`.

**The file is inspectable on purpose.** `format` and `saved_at` are columns as
well as fields inside the JSON, so during an incident `sqlite3` answers "which
sessions are waiting on a person, and since when?" with no JSON parser and
without this library. `journalMode` on the returned store reports what the file
*actually got* rather than what was asked for — a silent downgrade from WAL on a
network filesystem is the kind of thing only ever discovered under load.

Added, all on the existing `agentfootprint/hosting` door — no new subpath:

- `sqliteSessions(options)` → `SqliteSessions` (`hydrate` / `persist` from the
  port, plus `forget`, `close` and `journalMode`)
- `SqliteSessionsOptions` — `{ file, busyTimeoutMs? }`; the file and its parent
  directories are created if missing, and `':memory:'` is refused because it
  looks durable and is not
- `SqliteUnavailableError` (`ERR_SQLITE_UNAVAILABLE`)
- `UnreadableSessionFileError` (`ERR_UNREADABLE_SESSION_FILE`)

Docs: [Sessions in a file](https://footprintjs.github.io/agentfootprint/docs/build/infra/sqlite).
Runnable: `examples/deploy/sqlite-sessions.ts` — serves a conversation, throws
away everything but the file, serves the same session again, holds a
human-in-the-loop turn across that boundary, and proves an unreadable store is
refused rather than restarted. A resume is not a replay, and the example counts
the side effect to prove it.

## [7.27.1] - 2026-08-05

A test that fails when the machine is busy is not a guard. It is a coin flip
with a stack trace, and this suite had a hundred and thirteen of them.

**The story is the root cause, and it is not "CI is slow."** Every one of these
assertions had the same shape — `expect(elapsed).toBeLessThan(200)` — and that
shape cannot express the thing it was written to defend. It measures how long
the machine took, and the machine is shared: the suite runs beside a build, a
coverage pass, and two other vitest workers. Identical code takes three to five
times longer under that load with nothing about the code having changed. So the
assertion cannot tell "we got slower" from "the box was busy", and it fires
*exactly* when CI is busiest. Five of them had already been logged as flakes —
`xray` P6, `withCircuitBreaker` P6, `locales/messages` Block D,
`consumer-domain-events`, `SkillRegistryOptions` — always under concurrent
build load, always passing in isolation. The failure mode of a guard nobody
trusts is not a red build. It is that everyone re-runs it without reading it,
and the day it means something, nobody notices.

**Every wall-clock budget in the suite is now stated in a form that machine load
cannot move.** Not the five that had been caught — all of them, found by
sweeping for `performance.now()` / `Date.now()` differences and millisecond
ceilings rather than by waiting for the next one to fire. `test/helpers/perf.ts`
holds the three honest forms, in order of preference:

- **A ratio between two runs of the same operation** (`expectScalesLinearly`) —
  the operation at ten times the input must cost about ten times as much. This
  is the strongest form because it states the actual claim ("no quadratic
  rescan"), and it is immune to machine speed entirely: whatever slows the large
  run slows the small one it is measured against. Seventy-eight of the
  assertions became this.
- **A ratio against a sibling** (`expectWithinTimes`) — the same run without the
  recorder, without the pricing table, without the permission checker, timed
  moments earlier on this machine. Used wherever the claim was already the word
  "negligible", which is a comparison that most of these tests never actually
  made.
- **A CPU yardstick** (`expectWithinReferenceUnits`) — where there is no natural
  sibling, the budget is N units of a fixed slab of CPU work timed in the same
  process, moments before the assertion. A runner that is four times slower
  today gets a four-times-larger ceiling; a real regression still trips it.
  Twenty-four assertions; eleven more are sibling ratios.

Seven sites kept a millisecond ceiling on purpose and say so where they stand,
because their number is a CONFIGURED VALUE rather than a guess about the machine
— a mock's own thinking band, a slow branch's own delay, a retry's own backoff
budget, `realistic()`'s own default floor. And a handful lost the clock
altogether in favour of the count that was the real claim: the skill loader now
proves it reads every file exactly once instead of proving the disk was fast
that morning.

**A ratio alone was not enough, and finding that out is half the work in this
release.** The first cut of the helper compared two single measurements, and it
still flaked when actually run under the reproduction condition. Three things
had to be added, each because the proof run said so:

- **Repeat until the sample is worth timing.** Below a scheduler quantum, one
  preemption *is* the measurement: a 0.2ms operation that gets descheduled
  reads as a hundred times its real cost, while the 100ms operation beside it
  absorbs the same theft as a rounding error — and load stops cancelling. Each
  operation is now repeated inside one sample until the sample clears 20ms, and
  what is compared is cost per repetition.
- **Take the fastest of several samples, alternating.** The fastest sample is
  the one the scheduler interrupted least. Alternating between the two sides
  means a slow patch of machine time lands on both, not on whichever ran
  second — and it disarms the classic false pass where the small run is served
  from a cache the large run had to fill.
- **Say when the machine itself moved.** The yardstick is timed on both sides
  of every measurement. If the machine's own speed drifted 4× mid-comparison,
  the ceiling is widened by exactly that much and the failure message says
  "contention, not code". On a quiet machine the factor is 1 and nothing
  changes, which is where a real regression gets caught. A guard that knows
  when it cannot measure beats one that guesses.

Sampling costs time, so it buys the loop counts back: measurements that used to
brute-force 50 agent runs now run 8 and sample instead, and a per-side time
budget stops an expensive operation from being run five more times just to
satisfy the sampler. Total suite time moved from ~42s to ~48s.

Where the honest answer was a **count**, the clock is gone entirely: a cached
translator is invoked exactly once however many times you read it; an open
circuit breaker calls its provider exactly once across eleven thousand
rejections; a sync provider never returns a Promise; a no-op structure recorder
hears each stage exactly once. Those facts are true on any machine under any
load, which is what makes them worth asserting.

**No perf claim was deleted. The form changed; the meaning stayed** — and in
four places the meaning got sharper, because writing the claim down properly
exposed what it had actually been asserting. Three sites keep a millisecond
ceiling on purpose and say so at the site: they are stated against a *configured
delay* (a mock's own thinking band, a slow branch's own timeout, a strategy's
own per-event block) rather than against a guess about the machine, because
"did not sleep longer than it was told to" has no cheaper form.

**Two of the conversions found real things**, which is the argument for the form
better than any prose could make it:

- `assignCostVerdicts` is quadratic in suspect count. Not a defect — the
  leave-one-out placebo band re-derives itself per suspect, which is what
  "leave one out" means — but it is bounded only by
  `CONTEXT_BISECT_DEFAULTS.maxSuspects` (12), and nothing said so. The test now
  guards a bounded size at twenty-five times the shipped cap and explains why
  there is no ratio to assert.
- `CommitRangeIndex.enclosing()` is a full array walk with a sort, by design, in
  footprintjs. A ratio there would have looked like a lookup claim and meant
  nothing. That test is a bounded-size CPU budget now, and says which library
  owns the cost shape.

A third was a claim of ours that was simply false: `gatedTools.list()` was being
compared against `staticTools.list()`, which hands back a stored array. "One
extra pass" is infinitely more than zero, so that ratio could never mean what it
said. It is a linearity claim now.

A fourth is written down rather than fixed, because it is a real measurement and
not a test problem: **`Parallel`'s per-branch cost stops being flat somewhere
past a hundred branches.** On a quiet machine, per branch: 10 → 0.59ms, 30 →
0.57ms, 100 → 0.87ms, 300 → 2.57ms. A three-hundred-branch fan-out costs about
thirty times a thirty-branch one, not ten. Whether that is the engine's fan-out,
the merge, or simply three hundred promises in flight is a separate question;
the scaling test now guards the range where the claim holds and records the
curve at the site, instead of hiding it inside a slack multiplier that would
have made a bigger test pass while meaning nothing.

**The composition tests lead with a count, not a clock.** A Sequence of forty
steps runs forty completions; a Loop of forty iterations runs forty; a
thirty-two-branch Parallel runs thirty-two. A quadratic walk that re-enters
children shows up in that number on any machine at any load — the ratio beside
it is there for the quadratic that costs without re-executing.

Proven the only way it can be proven: the full suite three times
**concurrently**, with `npm run build` looping beside it — the reproduction
condition, which oversubscribes the machine several times over. Every
conversion was measured under it and revised until it held there, which is how
each of the three refinements above got found in the first place.

Two admissions, both at the site. The converted tests state their own
**timeout**, because sampling costs time and the runner's five-second default is
itself a wall-clock budget with the same defect. And they carry **`retry`**,
which is the last mile: everything above removes the systematic distortions, but
not the chance that one run drew three unlucky samples. Retrying costs no
strength — a real regression is deterministic and fails every attempt, while
contention has to win three times in a row — and it was added only after the
conversions already held on their own.

### Also in this release

**`WindowStrategy` meant two different things, and the release gate was right to
refuse it.** The package root exports the conversation-window seam
(`{ name, plan(input) }`, public and frozen since 7.17.0). `agentfootprint/memory`
exported a memory config record under the same name (`{ kind: 'window', size }`).
Same word, incompatible shapes, two entry points — a trap for anyone importing
from the wrong one. The memory one is now **`MemoryWindowStrategy`**, and
`agentfootprint/memory` still exports `WindowStrategy` as a deprecated alias, so
no import breaks. The rename went to the memory side because that name was never
meaningfully public there: it appears in no guide, no example, no release note,
and not in the generated API reference at all (typedoc covers the root barrel
only). A compile-level regression test pins all three facts — the new name, the
old alias, and that the two types were never assignable to each other.

**AgentCore's browser bearer handshake was reading a spelling nobody
documented.** The `/ws` door looked for `bearer` and `bearer.<token>` —
words this library invented. AWS documents one scheme and one only: the token
base64url-encoded and prefixed with `base64UrlBearerAuthorization.`, followed by
the sentinel subprotocol `base64UrlBearerAuthorization`, with "subprotocols
other than `base64UrlBearerAuthorization` … not yet supported". So a real
browser handshake matched neither spelling and the mapping returned `{}` — the
credential silently dropped, which is the same failure shape as a stored session
that reads back as nothing. Now: the documented pair is read, the base64url
wrapper is undone before the token becomes `Bearer <jwt>`, and the **sentinel**
is echoed in the client's own spelling because RFC 6455 lets a server select
only what the client offered — never the dotted value, which would put the
credential in a response header. Two shapes refuse the upgrade by name rather
than degrade: a dotted value that is not valid base64url (a token that does not
decode is not a credential), and a dotted value offered without the sentinel
(there is then nothing safe to echo). The tests pin AWS's own literal example
strings, so the day their spelling moves, the suite says so. The invented
spellings are gone rather than kept beside the real one — a door nobody can walk
through should not be advertised as one.

**The AgentCore Memory docs described an API that has not existed since 7.15.**
The mapping table named `PutMemoryEvent` / `GetMemoryEvent` /
`DeleteMemorySession` — none of which the adapter calls — and said `search()`
was "not exposed", which stopped being true in 7.15. Rewritten against the
shipped adapter: `CreateEvent` / `ListEvents` / `DeleteEvent`, the identity split
across `actorId` and `sessionId`, the two operations that cost O(events in
session) because AgentCore assigns its own event ids, `putIfVersion` emulated,
no `stream()`, and `search()` documented for what it actually is — server-side
retrieval that takes the query as **text** in `options.text`, throws rather than
returning an empty list when it is missing, and returns AgentCore's own extracted
records rather than the entries you `put()`. Three sibling pages carried the same
stale "AgentCore has no `search()`" claim and are corrected too, including one
that promised a build-time throw that no longer happens — causal memory on an
AgentCore store now passes the build check and fails at the call instead.

### Fixed

- **`/ws` browser OAuth on AgentCore Runtime.** The bearer subprotocol mapping
  now reads the vendor's documented scheme; the previous spellings could not be
  produced by any browser through that front door.
- Duplicate exported type name `WindowStrategy`, which blocked the release
  gate's duplicate-type check.

### Changed

- **Tests only:** every wall-clock performance budget is now a ratio, a count,
  or a CPU-yardstick budget. No public behaviour changes.
- **Tests only:** a handful of long-running tests state their own timeout
  instead of inheriting the runner's 5-second default. That default is a
  wall-clock budget like any other, with exactly the defect this release is
  about: a property sweep over real agent runs, a 44,850-pair lint, a
  200-iteration loop and a barrel import all do seconds of honest work, and on a
  contended runner the default was failing them for being on a busy machine.
  The assertions in those tests were already counts.
- `agentfootprint/memory` exports `MemoryWindowStrategy`; `WindowStrategy`
  remains as a deprecated alias.

## [7.27.0] - 2026-08-05

A production integration ran an agent on a shared socket, with a co-listener of
their own reading requests beside it. The co-listener called
`req.setEncoding('utf8')` — an ordinary thing for a framework to do before it
decides a path is not its own — and the container died.

Not the request. The container.

`readJson` collected chunks and called `Buffer.concat`. With an encoding set,
node delivers those chunks as STRINGS, and `Buffer.concat` on strings throws —
inside the `'end'` listener, which node calls from its own stack. A throw there
is not a rejected promise anybody awaits and not a failed request anybody
answers: it is an uncaught exception. One perfectly ordinary request took down
every other request in flight, every open conversation, and everything else that
container was serving.

The two-line fix is to coerce the chunk. **The release is the law it exposed.**

> **Nothing in a request's lifecycle may ever be the process's failure.**

That sentence is now stated at the site where the field found it and enforced
across every listener body in the hosting layer that computes. Not just the line
that broke — the whole class. A dialect that throws while reading a request, a
health body that throws, a body that will not stringify, a handshake dialect
that throws, an abort listener that throws while being told the caller left:
each of those is now the failure of the thing that caused it. A 400, a 500, one
refused upgrade, one ended conversation. Never the process.

One of them was not even a throw. `serveOne`'s promise is held in a Set and
voided at the call site, so anything that escaped it was an *unhandled
rejection* — which on node's defaults is the same dead container reached by a
different road. It is total by construction now, and says so.

**The audit's other finding is that the conversation door was already safe, and
for a reason worth writing down.** The same co-listener cannot do this to an
upgraded socket: node itself refuses `setEncoding` there
(`ERR_HTTP_SOCKET_ENCODING`, "not allowed per RFC7230 Section 3"). So the frame
reader reads bytes by the transport's own rule rather than by this door's hope —
and because that reason lives in node and could change there, it is pinned by a
test instead of asserted in a comment.

**And the inverse seam, from the same report.** `{ server }` — lend the host a
socket you bound — is the right answer when you have a protocol of your own to
serve. It is a great deal of ceremony when all you wanted was a `/debug/trace`
beside the agent on the one port the container was given.

```ts
nodeHost({ port: 8080, onUnhandled: (req, res) => myRouter(req, res) })
```

Same single port, opposite direction: the host binds the socket as it always
did, and every path it does not own is handed to your code **instead of** its
404. The host still never answers for your application — with this hook it no
longer has to 404 for it either.

What it never receives is the interesting half. The paths the host owns —
`invokePath`, `healthPath`, `conversationPath` — never reach it, *including a
wrong method on one of them*, because a hook that could claim `POST /invoke`
would be a second door wearing the first one's name. And it is refused at
construction beside `{ server }`, by name: there, unmatched paths already fall
through to your own `'request'` listeners, so a second way to answer them would
make the winner depend on the order two listeners were registered in. Two
answers to one question is the confusion the refusal prevents.

**Upgrades deliberately do not travel through it**, and the reasoning is on the
page rather than in somebody's head. `onUnhandled` is handed a `ServerResponse`
to write; an upgrade has none — it has a raw socket and a handover to perform by
hand. The field case is diagnostic HTTP routes, so an unclaimed upgrade on a
private socket keeps exactly the answer it always had (400, socket closed), and
a differently-shaped second hook for a case nobody has asked for is how a port
grows a surface it cannot explain. `{ server }` remains what it always was.

**Nothing changes for anyone who does not opt in.** No `onUnhandled` means the
same 404 as before, byte for byte, and that is pinned by comparing two live
hosts rather than by care.

### Added

- **`onUnhandled` on `HttpHostOptions`**, threaded through `nodeHost` and
  `agentCoreRuntimeHost` — `(req, res) => void`, called in private-server mode
  for any path the host does not own, instead of the host's 404. Your code, on
  the host's socket, with the request and response exactly as they came off the
  wire. Refused at construction beside a caller-owned `server`. A throw inside
  it is that request's 500; a hook that answers nothing leaves the request
  hanging until it times out — the same price, for the same reason, as the
  missing 404 on a caller-owned server.

- **`examples/deploy/own-routes.ts`** — the field scenario, runnable: the agent
  on `/invoke`, the conversation door on `/conversation`, and a `/debug/trace`
  of the caller's own, all on ONE port with no server to create. It breaks a
  route on purpose to show what that costs (one 500) and what it does not (the
  agent, still answering).

- **`CLOSE_CODE.internalError`** (1011), internal to the conversation door — the
  RFC's own word for "this end could not fulfil the request", used where the
  fault is demonstrably not the peer's, so a close code never blames them for
  something that happened on this side.

### Fixed

- **A request body read on a shared socket no longer kills the process.** String
  chunks are coerced back to bytes, and no bytes are lost doing it: `setEncoding`
  decodes through a `StringDecoder`, which holds a partial multi-byte sequence
  across a chunk boundary rather than splitting it. Pinned by writing a body in
  two TCP writes with the split placed *inside* a four-byte character and
  asserting it round-trips. Reachable only through `{ server }` — the mode built
  for co-listeners — and reproduced there, with a real second listener on a real
  shared socket rather than a stubbed request.

- **Every listener body in the hosting layer that computes is contained.**
  `'request'`, `'upgrade'`, `'data'`, `'end'`, `'close'` and the response's own
  `'close'`: a throw in any of them is answered to the request, the upgrade or
  the conversation that caused it. `serveOne` no longer rejects at all — an
  unhandled rejection was the same crash by another name. Where the ordinary
  reply path is itself what broke, the refusal is written in the one shape
  nothing can refuse: `{ error }` with a 500.

- **A conversation-handshake dialect that throws refuses that upgrade** with a
  `500` naming the host, and the door keeps carrying everybody else's
  conversations. Previously it was an uncaught exception on node's stack.

### Notes

- **With a framework that installs a catch-all handler (Fastify, Express), the
  framework answers first and the attached host never sees the request** —
  register the framework's routes as a delegation to the host, or let the host
  own the socket and use `onUnhandled` for your own routes. This is now beside
  the hang-cost callout in the hosting guide, where the same class of surprise
  already lived.

- **The conversation door needed no fix, and that is a finding rather than an
  omission.** Node refuses an encoding change on an upgraded socket, so the
  frame reader cannot be handed text. The test that says so exists because the
  guarantee is node's, not this library's.

## [7.26.0] - 2026-08-05

`toolArgValidation` has spent several releases doing something quietly
remarkable at the other end of a tool call: when the model writes arguments
that do not match the schema, the call is not dispatched and the model is
handed a structured explanation — path, expectation, received type — which it
reads on the next iteration and corrects. Validation that TEACHES rather than
merely refuses.

`outputSchema` could only refuse. It judged the agent's final answer after the
run was over, at the caller's boundary, and turned a bad shape into an
exception. That is a fine place to reject an answer and a useless place to fix
one: the loop has stopped, the model is gone, and all the caller can do is
throw or substitute a canned value.

**This release gives the answer side the same teaching that the arguments side
has had all along.**

```ts
.outputSchema(Refund, { retries: 2 })
```

A failed answer and an authored correction join the conversation, and the ReAct
loop turns again.

**The failed answer goes back with the correction, and that finding shaped the
feature.** Nothing writes the answering turn into `history` — the loop appends
an assistant turn only when it carries tool calls, and the turn that ends the
run carries none. So a correction sent on its own would have arrived at a model
that could not see what it said: teaching into the void. Both messages go, in
the order they really happened, which is also what makes the retry legible
afterwards — the conversation says what was answered, what was wrong with it,
and what came back.

**Each retry is a REAL turn, and that is the entire architectural argument.**
The re-ask is a third branch of the Route decider carrying the same `{ loopTo }`
the tool branch carries, so it re-enters the ordinary loop: the injection engine
re-evaluates, the slots recompose, the cache decides, the model is called. The
attempt therefore gets its own `stream.llm_start` / `llm_end` bracket, its own
`cost.tick` against `costBudget`, and its own row in the ledger.

Compare the in-stage schema retry the reliability gate has done since v2.13,
which is kept and still recommended when the rules also need failover or
circuit breaking: N attempts there share ONE bracket, and `emitCostTick` fires
once carrying only the last attempt's usage. Those retried attempts were
genuinely billed and completely invisible. A library whose product is the
recording does not get to bill you for turns it does not show you.

A retry consumes an iteration, and that is documented rather than worked
around. The alternative was a parallel counter, which would have meant two
`iteration_start` events with the same `iterIndex` — and every recorder that
synthesizes steps, plus the crash-checkpoint tracker, counts on that pairing.
The loop already had a word for "one more turn"; inventing a second one to
avoid admitting the cost would have been an accounting trick.

**The corrective message is an authored frame with the validator's error as
DATA.** The library's own words come first and say that what follows is a
report about the answer rather than an instruction; the error is quoted
verbatim; and *nothing authored follows it*, so there is no trailing sentence
for injected text to pre-empt. A schema whose error message reads "IGNORE ALL
PREVIOUS INSTRUCTIONS" produces a message that still says, first and in the
library's voice, what it is. This is exactly the compaction frame's rule
pointed at the other untrusted string this library quotes, and it is pinned by
a test that sends a hostile error through the whole loop.

**The event was asked for, and that is why it exists.** The state-vs-event rule
says committed state is the default and an event needs a reason; here the
reason is a person asking to be able to watch retries happen. So both:
`agentfootprint.agent.output_schema_retry` fires per failed attempt, and
`snapshot.sharedState.outputAttempts` keeps one row per final-answer attempt —
joined by the corrective message's hash, so a live subscriber and a stored
recording are talking about the same message.

**And the second half: `strategy: 'tool-forced'`,** which presents the schema
as a synthetic tool and forces the provider's tool choice, so the shape is
constrained at generation instead of requested in prose. Two refusals guard it,
and both were the interesting design work.

Forcing the choice BY NAME means no other tool can be called on any turn — so
an agent with tools would go silently single-shot: config that lies in the
other direction. That combination is refused at build, naming both honest
paths. A `tool_choice: 'any'` variant would keep the tools working, but it
would not keep the guarantee on any given turn; it is a different feature
wearing the same name, and if evidence ever asks for it, it arrives under its
own word.

The second refusal is about the shape itself. A tool carries its input schema
as JSON Schema, and this library has never converted a validator into one.
A parser that can render itself (ArkType's `toJsonSchema()`) is asked; anything
else must be handed `jsonSchema` explicitly. Guessing what somebody's schema
means is not a thing the library gets to do.

`jsonSchema` and the parser can disagree, and nothing here prevents it —
because the system stays honest when they do. The forced shape satisfies the
wire, the parser still judges the answer, and a disagreement surfaces as an
ordinary validation failure that the retry loop corrects with the validator's
words. The schema constrains generation; the parser remains the judge.

**Nothing changes for anyone who does not opt in.** `retries` defaults to `0`,
enforcement is a conditional mount, and an agent without it has no branch in
its chart, no key in its commit log, no event, and byte-identical request
bytes — pinned against 7.25 by test, not by care.

### Added

- **`.outputSchema(parser, { retries })`** — corrective re-asks, capped and
  stated. On failure the loop routes to a new `'output-retry'` branch which
  appends the failed answer plus an authored correction and loops back to the
  same target the tool branch uses. Exhaustion leaves the last answer standing
  and `runTyped()` throws `OutputSchemaError` exactly as before;
  `.outputFallback()` composes on top unchanged. The ceiling is 10, and the
  refusal above it says why: a model that has missed the shape ten times
  running is not about to find it.

- **`.outputSchema(parser, { strategy: 'tool-forced', jsonSchema })`** — the
  schema as a synthetic tool with the provider's choice forced. The tool is
  assembled at request time and exists nowhere else: not in `.tools()`, not in
  the tools slot or `tools.offered`, not on an MCP server's served list, not in
  the dispatcher that runs tools and files middleware rows. It DOES appear in
  `stream.llm_start`, whose claim is what the model actually saw.

- **`LLMRequest.toolChoice`** (`{ type: 'tool', name }`) and
  **`LLMProvider.carriesForcedToolChoice`**. One arm on the port, one dialect
  per wire: Anthropic `{type:'tool',name}`, OpenAI
  `{type:'function',function:{name}}`, Bedrock Converse
  `toolConfig.toolChoice.tool.name`. **Absence of the capability means NO** —
  the opposite of `carriesInMessages`, whose absence means the floor — because
  a tool choice that quietly vanishes costs the guarantee the strategy was
  selected for. Declared by Anthropic (+ browser), Bedrock, real OpenAI/Azure
  (+ browser) and the mock; deliberately NOT declared behind a custom `baseURL`
  (Ollama, vLLM, Together), since what an OpenAI-compatible server does with
  `tool_choice` is that server's promise to make. `withRetry` and
  `withCircuitBreaker` forward it; `withFallback` publishes the **AND** of its
  pair, since either side may serve the call.

- **`agentfootprint.agent.output_schema_retry`** — one per failed attempt,
  carrying `{ attempt, retriesRemaining, iteration, stage, error, path?,
  correctiveMessageHash }`. 69 typed events across 20 domains. It sits in the
  `agent` domain beside `output_schema_validation_failed`, its in-stage
  sibling; a new domain for one event that has a family home would have been
  taxonomy for its own sake.

- **`snapshot.sharedState.outputAttempts`** — `OutputAttempt[]`, one row per
  final-answer attempt: `attempt`, `iteration`, `outcome`
  (`'passed' | 'retried' | 'exhausted'`), and on a failure the validator's own
  message plus the corrective message's hash. Written only by an agent that
  opted in.

- **`SCHEMA_CHECK_FRAME_PREFIX`, `SCHEMA_TOOL_NAME`, `isSchemaCheckMessage()`,
  `OutputAttempt`, `OutputSchemaStrategy`** on the main barrel — so a reader,
  a test or a UI can recognise the two things this feature puts into a
  conversation without matching on prose.

### Changed

- **`agent.route_decided.chosen` widens with `'output-retry'`.** It appears
  only on an agent that opted into retries, and only on a turn whose answer
  failed with retries left. Reporting `'final'` for a turn that is about to ask
  again would have been the one thing this event must never do.

- **`STAGE_IDS.OUTPUT_RETRY`** joins `conventions.ts` as a `boundary` role and
  a `'decision'` milestone labelled "Schema retry" — the run deciding its own
  answer was not good enough is exactly what a reader came to see, so it is not
  muted as plumbing.

### Notes

- **`.reliability()` and `{ retries }` layer rather than collide**, and the
  ordering is pinned: the in-stage gate decides FIRST, about a response before
  it is committed, and `retries` governs answers that WERE committed and turned
  out invalid. With reliability configured and no rule for `'schema-fail'`, a
  bad shape still fails the run as it always did — `retries` does not rescue it,
  because the gate never committed an answer for the loop to govern. The one
  case where both genuinely fire is an output `messageMiddleware` that rewrites
  the answer after the in-stage check: the decider judges what the CALLER will
  receive, which is the only honest place to judge it.

- **A denied answer is never judged and never re-asked.** When an output
  middleware returns `deny`, the run raises as before; asking the model for a
  better-shaped version of a withheld answer would be the library routing
  around a rule the app wrote.

## [7.25.0] - 2026-08-04

A production integration deployed an agent that operates the user's browser. The
browser cannot host an inbound endpoint, so it dials out and parks a connection
that the agent pushes tool calls down — and they said the thing that became the
whole design brief: **"`HostRequest → HostReply` is one exchange, and this door
is a conversation."**

They were right, and the honest answer was not to widen the request port until
it could pretend. A request has one reply and then it is over. A conversation
has neither side taking turns by rule, no reply count, and an end that either
side can call. So this release ships a second port beside the first.

```ts
const host = nodeHost({ port: 8080 });

await standingAgent({ agent, sessions, host });        // POST /invoke
await host.serveConversations((conversation) => {      // WS   /conversation
  conversation.onFrame((frame) => conversation.send(answer(frame)));
  conversation.onClose(({ by, reason }) => log(by, reason));
});
```

**The anti-bias law, applied harder than last time.** The request port stayed
honest because it was designed against local adapters first and the cloud
adapter arrived as wire config. This one was designed against **three** consumers
at once — a browser-parked tool channel, a standardized agent↔UI protocol, and
agent-to-agent task serving — with the rule that a decision which only makes
sense for one of the three is wrong. That rule is why frames are **strings**
(what they mean is the consumer's contract, not the port's), why
`ConversationClose` says `{ by: 'far-side' | 'host' | 'transport' }` and carries
no transport's numeric code, and why a credential that one runtime spells as a
WebSocket subprotocol arrives in your handler as an ordinary `authorization`
header rather than as a field on the port.

**Declared ceilings, not hidden ones.** `host.conversationLimits` says what a
door caps — `maxFrameBytes`, `idleMs`, `maxPendingBytes` — and the port neither
chunks nor heartbeats. Hiding a 32KB cap inside auto-chunking would have the
adapter deciding, for every consumer at once, how a message is split, how the
pieces are numbered and how the far side knows the last one landed. Those
answers differ per consumer, so the ceiling is made VISIBLE and the layer above
acts: chunk above the port, heartbeat above the port. A frame past the ceiling
refuses by name (`FrameTooLargeError`, carrying the number), and a fragmented
message counts in total, so fragmentation cannot walk around it.

**A real WebSocket server, with nothing to install — and here is why that was
worth writing.** The obvious shortcut was an optional peer dependency. It was
rejected on a property of this library rather than on lines of code:
`capabilities` is declared at construction and static thereafter, so a host
whose door only works when an optional package happens to be installed can
either claim `'conversation'` and then refuse to do it — the library declaring a
promise it cannot keep, which is the one thing the capability union forbids — or
probe `node_modules` and make feature detection depend on install state. Neither
is a thing this library gets to do. So the codec is ours, its scope is closed
(handshake, text, continuation, ping/pong, close; no extensions, no compression,
no binary, no client role), and it is verified against **the byte sequences RFC
6455 §5.7 publishes** — the encoder against bytes the specification wrote, the
decoder against bytes a real client sends, rather than against a client we also
wrote. It is **not** run against the Autobahn suite, and the docs say so in the
same breath.

**One socket, two doors** — which is the release's one change to existing
behaviour, and the finding that made it necessary. `serve()` and
`serveConversations()` on the same host now share a refcounted socket: first door
in creates and listens, last door out drains and closes. Before this, a second
`serve()` bound a second socket, so "an agent and a conversation on one port" —
the deployment this entire feature exists for — was `EADDRINUSE`. The doors are
independent in both directions and only the last close releases the port; three
tests pin exactly that.

### Added

- **The conversation port** — `HostConversation` (`sessionId?`, `headers?`,
  `send`, `onFrame`, `onClose`, `close`), `ConversationHandler`,
  `ConversationHost`, `ConversationClose`, `ConversationLimits`, and
  `'conversation'` in `HostCapability`. The capability joined the union because
  two shipped adapters honour it, not because it was imagined — the same law
  7.14 wrote down.

- **`host.serveConversations(handler)`** on every adapter built on `httpHost`
  that was given a `conversationPath`. `nodeHost` serves `/conversation` (its
  own word, chosen the way its other two paths were) and declares
  `{ maxFrameBytes: 1048576, maxPendingBytes: 1048576 }`. A host built without a
  `conversationPath` does not declare the capability and refuses by name — no
  default path here, for the same reason `invokePath` has none.

- **`agentCoreRuntimeHost` serves the runtime's `/ws` door**, on the same socket
  as `/invocations`, with that runtime's facts declared in that runtime's
  adapter: ceilings `{ maxFrameBytes: 32768, idleMs: 900000 }`, session affinity
  from the shipped header **or** the query string (a browser's WebSocket API
  cannot set a header; the header wins when both arrive), and a
  `Sec-WebSocket-Protocol` bearer mapped into `headers.authorization`. Both
  browser-expressible spellings are read, and the echoed subprotocol is the word
  `bearer` and never the token. `readAgentCoreConversation` is exported so the
  mapping is reviewable without binding a socket.

- **`ConversationClosedError`** (`ERR_CONVERSATION_CLOSED`) and
  **`FrameTooLargeError`** (`ERR_FRAME_TOO_LARGE`, carrying `bytes` and
  `maxFrameBytes`). A send that is accepted and dropped looks identical to one
  that worked, from the only side that could have noticed.

- **`HttpWire.readConversation(facts)`** — the handshake half of a deployment's
  dialect, returning `{ sessionId?, headers?, protocol? }`. There is no body in
  a handshake, so a dialect that wants a session id has to name where it looks.

- **The conversation conformance suite**, run against three subjects: `nodeHost`'s
  upgrade door, an in-process conversation host with different declared
  ceilings, and `agentCoreRuntimeHost`'s `/ws`. One handler constant, three
  hosts, byte-identical answers. `/ws` is plain WebSocket with no SDK on its
  path, so **that result is real verification** — the same sense 7.15 used the
  phrase for `/invocations`.

- **[The conversation door](https://footprintjs.github.io/agentfootprint/docs/build/infra/hosting)**
  in the hosting guide, and the `/ws` wire on the AgentCore adapters page. Plus
  `examples/deploy/echo-conversation.ts`: two turns over one open channel, an
  ordinary `POST /invoke` on the same socket, both refusals, and `onClose`
  reporting who ended it.

### Fixed

- **An upgraded socket that the far side abandons is reported, and released.**
  Node delivers `'end'` on a half-open upgraded socket and then waits for this
  side to end too — no `'error'`, and no `'close'` until something acts. A door
  listening only for `'close'` would never fire `onClose` for a caller that
  walked away, and would hold a socket that keeps every shutdown sharing that
  port waiting. Found by the test that asserts a dropped connection is reported
  as `by: 'transport'`.

- **`examples/deploy/one-port.ts` said something untrue about upgraded sockets.**
  `server.close()` does not end one for you — that part was right — but it does
  **wait** for it, and `closeIdleConnections()` does not count it as idle. The
  comment now says both halves, because a graceful shutdown has to destroy its
  own upgraded sockets.

### The judgements these rest on

**`standingAgent` is NOT conversation-aware, deliberately.** The three consumers
push different things down a channel — tool calls out, UI events in, task
updates both ways — so baking one loop into the composer would be exactly the
bias the port was designed to avoid. This release is a port plus two adapters;
the browser-tool loop, the agent↔UI framing and agent-to-agent serving are each
their own release, each consuming this same door. Three proofs, three cars, one
door. The absence is pinned twice: a type-regression test fails the build the
day a conversation key appears on the composer's options, and a runtime test
serves a standing agent on a host whose conversation door throws if it is ever
touched.

**The pre-subscribe buffer is a ceiling too, so it got a number.** Frames that
arrive before the handler's first `onFrame` subscriber are held and delivered —
otherwise an `async` handler that looks something up before it starts listening
loses the far side's opening frame, which on a channel whose first frame is a
greeting is every conversation. But a queue somebody else fills and this process
pays for is a way to kill the process. So it is bounded by `maxPendingBytes`,
declared beside the other ceilings, and overflow ends the conversation naming
the bound. Bounded in **bytes** rather than frames: a frame count would still
admit `count × maxFrameBytes`, which is the same unbounded queue with an extra
step.

**A binary frame is refused by name rather than stringified.** The port carries
text; binary is a capability that gets minted when a consumer produces evidence
for it, not guessed at now. A binary frame ends the conversation with a reason
that says exactly that.

**`{ server }` was not made redundant.** A conversation door means you no longer
need a caller-owned server merely to get a WebSocket beside the agent. It
remains what it always was: the way to serve anything the ports do not express.
A port is a paved road, not a wall.

## [7.24.0] - 2026-08-04

This library keeps measuring the same disease and shipping cures for it one
organ at a time: **a capability nobody can find is a capability nobody has.**
The skill router exists because a tool the model cannot see is a tool that does
not exist. The context ledger exists because a piece of context nobody can
account for might as well not have been sent. And an agent's own governance had
the same problem, in the place where it costs the most: the answer to "what
does this agent do at each moment of its turn?" was four unrelated builder
calls, scattered through a chain, with no place to be answered.

So this release does two things, and the second is the reason for the first.

**`.act()` — one block, five keys, one per moment of the loop.**

```ts
Agent.create({ provider, model })
  .act({
    input:      [scrubSSNs],                            // the message, before the run commits it
    beforeTool: [refundCeiling, fourEyes],              // every call, before it is dispatched
    afterTool:  [stripPII],                             // every result, before the model reads it
    window:     slidingWindow({ keepRecentTurns: 12 }), // what the live window keeps
    output:     [noCodenames],                          // the answer, before the caller gets it
  })
  .build();
```

Governance at a glance: one thing to read in review, one thing to diff, and
autocomplete on an empty `{}` that teaches the loop rather than requiring you
to already know it. It builds nothing new — every key is forwarded to the door
that already owned it, and the equivalence is pinned **per key** against the
hand-written spelling, the way `.compaction()`'s was: same requests on the
wire, same rows in the ledger.

The canonical path is preserved by **demoting the doors, not deleting them**.
`.toolMiddleware()`, `.messageMiddleware()`, `.window()` and `.compaction()`
are unchanged and stay open, and they are now documented under *Composing
incrementally* — because adding one rule to an agent somebody else built is a
real job, and a bundle that must be written all at once cannot do it. That
division is the one-sentence answer to "which spelling": **`.act()` for an
agent you own, a door for a piece you are adding to somebody else's.** A second
`.act()` throws, since two posture blocks put the answer in two places with the
later one silently winning.

**And the keys cannot fall behind the loop.** `LoopMoment` is exported, and the
bundle's keys are type-locked against it in both directions, camel-cased by
type-level string manipulation rather than a hand-written pair table. Ship a
sixth moment without a key and OUR build fails naming it. The runtime validator
that decides which keys `.act()` accepts is derived from the same list, so it
cannot drift from the type it is validating. A surface that claims to be
complete has to be made unable to fall behind, or the claim is just a sentence
in a doc.

**The after-tool moment, which 7.18 deferred.** A tool middleware may now carry
an `onToolResult` hook that runs once the tool has executed and **before its
result enters the history or reaches the model**. Two verbs there — `allow()`,
`allow(value, why)`, `deny(reason)` — and the two halves are ONE chain walked
in onion order: the first-declared rule gets the first word going in and the
last word coming out.

There is deliberately **no `ask` at the after-tool moment**, and that is a refusal rather
than an omission. The machinery is right there; the tool has already run, so a
person woken to answer cannot prevent anything. Every reviewed business case —
authorize before, hide from the model, annotate the result, attach a fact
through a trigger — needed the two verbs and none of them needed a person. The
absence is recorded at the type and in the docs so evidence can promote it: a
case that genuinely needs a human at that moment gets the arm, on the pause
machinery that already exists.

### Added

- **`.act({ input?, beforeTool?, afterTool?, window?, output? })`** — the
  canonical door. Pure sugar over the five existing ones, callable once, with
  unknown keys refused by name rather than ignored (a key nobody reads is a
  governance rule that silently never runs). A bundle that fails validation
  leaves the builder exactly as it found it.

- **`ToolMiddleware.onToolResult`** — the result moment. The moment is named
  `'after-tool'` (and `.act()`'s key after it) because that is WHEN it happens;
  the hook is named for WHAT IT RECEIVES, which is how it pairs with
  `onToolCall`. Its context is the call
  context plus `result`, plus `error: true` when the tool threw, with `args`
  as the tool ACTUALLY RAN WITH them. `toolSource` is present here too, so a
  rule about a server's answers is as writable as a rule about its calls.
  `ToolMiddleware` is now a union: at least one of `onToolCall` /
  `onToolResult`, so a rule with a name and no hook does not compile. A link
  with only `onToolResult` takes no part in dispatch — no walk, no ledger row at the call moment, since it
  decided nothing there.

- **`LoopMoment`, `LOOP_MOMENTS`, `actKeyFor`, `ActKey`, `ActOptions`,
  `ACT_KEYS`** — the moment vocabulary and the bundle, exported so a UI that
  renders "what does this agent do at each moment?" can enumerate the moments
  instead of hard-coding five strings.

- **`MiddlewareDecision.moment`** and the same field on the
  `agentfootprint.middleware.decision` payload — every row now says WHERE IN
  THE LOOP it came from, in the same words the key is named for. The 7.18
  `at` / `phase` fields are committed state, are still written, and still mean
  what they meant; `moment` is the newer spelling and the one to narrow on.

- **`allow(undefined, why)`** — a pass-through that carries a reason. The row
  still reads `changed: false`, because nothing moved. It is what an
  approve-once rule needs: a call that sails through on a remembered decision
  files a row saying **whose** decision it sailed through on, so "why did this
  run without asking?" has an answer in the record rather than in somebody's
  memory.

- **[The moments of the loop](https://footprintjs.github.io/agentfootprint/docs/build/loop-moments)**
  — a new docs page with the hero diagram, and THE TABLE: every lifecycle
  moment × the watch event that reports it × the act seam that can change it
  (or "observation only", which two moments are, on purpose — a rule that could
  rewrite the model's answer would be a rule that could answer for the model).
  Plus the session-trust recipe and the whole-steering-wheel example.

- **Examples** `features/38-act.ts` (all five moments on one agent) and
  `features/39-approve-once.ts` (ask once, remember the answer, keyed by
  tool + source + args — with the loosening shown and its cost named).

### The judgements these rest on

**Deny at the after-tool moment hides an answer; it does not undo a side effect.** The model
reads the reason instead of the result, and the run still commits the real
result — because it happened. A record that dropped it would describe an agent
that called a tool and got nothing back, which is not what occurred. That makes
the row the only copy of a withheld result, exactly as the `'input'` phase row
is the only copy of pre-scrub text, and it gets the same answer: redaction over
`middlewareDecisions` scrubs the value while the refusal survives. The 7.18
security test grew a second half that pins it.

**`onToolResult` NEVER runs for a call that never executed.** Denied before dispatch,
waiting on a person, rejected by arg validation, blocked on a credential, or
naming a tool that does not exist — none of those have a result to decide
about, and asking a rule about a result that does not exist is the same
fabrication the outcome union removes. It DOES run on the far side of an
approval, because that is where the tool ran.

**`stream.tool_end` still reports what the TOOL returned.** The event stream is
about the tool; the history is about the model; the ledger row between them
says which is which. Making the event report the model's copy would have made
one of the two facts unrecoverable.

**The buckets are for reading; the hooks decide.** A rule with both hooks runs
at both moments whichever key it was written under, and a rule named under both
tool keys is the same object attached once. The other rule — buckets that
restrict — would mean a governance rule silently not running because it was
filed in the wrong place, which is the failure this whole surface exists to
prevent. What IS checked, at build time, is that a bucket's entries have the
hook the bucket names.

**`.act({ input })` restricts a rule to one phase; `.messageMiddleware()` does
not.** The bundle wraps each entry in exactly the `msg.phase === 'input' ? … :
allow()` guard a person writes today — including its pass-through row at the
other phase, which is what keeps the per-key equivalence honest. Name a rule
under BOTH `input` and `output` and it is attached once, unguarded: exactly
`.messageMiddleware(rule)`.

**`WindowRecord` did not gain a `moment`.** It was considered and declined:
required, it breaks every third-party `WindowStrategy` in a minor; optional, it
is a discriminant that always holds the same value, added to committed state.
A window record is already the window moment by virtue of the key it lives in.

## [7.23.0] - 2026-08-04

Three seams that each stopped one layer short of the person who needed them.

That is the whole shape of this release, and it is worth naming because it is a
failure mode rather than a feature gap. In all three cases the hard part was
already built and already correct. The transport already had a fetch hook — for
our gateway, one line above the branch that did not pass yours. The protocol
already had two result shapes, and the SDK's own type already said so — our shim
narrowed one of them away. The tool wrapper already knew which server it was
wrapping — and spent that knowledge on an error string. Everything worked right
up to the last hop, and the last hop is where the consumer stands.

**Sign your own requests.** `McpHttpTransport` now takes a `fetch`. Some
endpoints do not want a header, they want a signature — SigV4, DPoP, an HMAC
over the body, a digest of the bytes about to be sent — and none of those can be
decided when the connection is built, because they are computed FROM the request.
A header fixed at construction cannot express them. So this release implements
none of them: it forwards the hook the MCP SDK already has, and **zero vendor
code lives in this library**. Your signer runs on every request the transport
makes — `initialize`, `tools/list`, `tools/call`, the event stream — and a
scheme this repo has never heard of works on the day you write it.

**Read the servers that answer the old way.** `tools/call` has two result
shapes. Today's carries `content` blocks; the 2024-10-07 shape carries a bare
`toolResult` and no `content` at all. Our shim promised only the first, so
`result.content.map(...)` compiled against a value that can arrive without one —
and then failed two different ways, neither visible to the compiler and neither
reproducible against a modern mock. Where the raw legacy object reaches the
reader (a caller-supplied `_client`) it **crashed**. Where the SDK's own result
schema normalises it — defaulting `content` to `[]` beside the `toolResult` it
could not express — it returned **an empty string**, which is worse: a real
answer, silently replaced with nothing. Both are fixed, and the shim now mirrors
the real union, so the next person to write this bug is stopped by the compiler
rather than by a support ticket. That is the 7.13.0 lesson applied to a second
shim: a shim's fidelity is not cosmetic, it is what makes an error class
impossible.

**Say which server a tool came from.** `wrapMcpTool` knew the server's name and
used it once, in the text of an error. Governance could not reach it, so a
policy matching a bare `call_aws` silently governed a second server's
identically-named tool — a hole with no error message, in the layer whose entire
job is to have no holes. Tools from an MCP server now carry `Tool.source`, and
it reaches the decision point as `ToolMiddlewareContext.toolSource`. **Absence
is the other half of the fact**: a tool you wrote yourself carries none, because
"this agent's own" and "served by somebody I chose not to name" are different
situations and only one of them should match a rule about somebody else's
server.

Thank you to a production integration for all three, found the way these things
are always found: on real infrastructure, against real servers, at the last hop.

### Added

- **`McpHttpTransport.fetch`** — your own `fetch` for every request the HTTP
  transport makes. It composes with `headers`: the SDK folds static headers into
  the `init.headers` your function receives, so **you see them and you have the
  last word** — set the same header name and yours is what reaches the wire.
  Omit it and behaviour is byte-identical to 7.22. The library never reads,
  stores, logs or records what your signer produces; the token-secrecy suite
  extends to this seam with the four pins `gatewayTransport` already holds (a
  hostile logger sees nothing, the transport descriptor holds nothing,
  a downstream error carries nothing, and each request is signed separately).
  Pinned against a real socket, because signing is a question about bytes.

- **`McpCallToolResult`** (`agentfootprint/tool-providers`) — the `tools/call`
  union, modelled rather than narrowed away: today's `content` arm, or the
  2024-10-07 `toolResult` arm. `McpSdkClient.callTool` now returns it, which
  makes narrowing a compile-time obligation.

- **`Tool.source`** — where a tool came from. Set by `mcpClient` and
  `mockMcpClient` to the client's `name`; never set by `defineTool`, so it
  cannot be spoofed by accident. A hand-written `Tool` may set it deliberately
  when it is genuinely relaying another source's tool.

- **`ToolMiddlewareContext.toolSource`** — that provenance at the decision
  point, on the same context type both chains use, so `mcpServe`'s serving-side
  middleware gets it too (carrying the **served** tool's provenance, never the
  calling client's — a client does not get to declare where a tool came from).
  Present only when the tool has a source, so `'toolSource' in call` is a
  question with a real answer.

- **[Connect to an MCP server](https://footprintjs.github.io/agentfootprint/docs/build/mcp-client)**
  — a new docs page for the consuming side: the three transports, a complete
  per-request signer written with `node:crypto` and no vendor SDK, what each
  result shape converts to, and governing by server.

### Fixed

- **A legacy `tools/call` answer is no longer lost or fatal.** A `toolResult`
  becomes the tool's text — a string verbatim, anything else JSON-stringified,
  a conversion now stated in the docs rather than inferred from a mangled
  answer. A `toolResult` beside an EMPTY `content` is read as the legacy answer
  it is (the empty array is the SDK's default, not the server's answer); a
  NON-empty `content` always wins, because a server that sent blocks meant the
  blocks. An answer with neither arm is a corrective tool error naming the
  SHAPE that arrived — its type, or its keys — and never the payload, which is
  still somebody's data.

A store that kept every conversation and could read none of them — and, one
grep later, a second store doing the same thing to memories.

`agentCoreSessions({ store: 'memory' })` wrote the checkpoint envelope into an
event payload as a **raw object**. The service stores its own host language's
`toString()` rendering of an object it is handed, and returns that string —
`{format=conversation-v1, data={...}}`. Not JSON. The reader accepted only
objects, so that string decoded to nothing, and `hydrate` answered the only way
it could: **"no session"**. Every turn wrote a conversation nobody could read,
and every next turn started fresh on top of it. Nothing failed. Nothing logged.
The store filled up with perfectly-preserved, permanently-unreadable
conversations, and the first person to find out was a user whose chat vanished
at a deployment boundary.

Two things had to change, and only one of them is about a cloud.

**The encoding.** The shim now writes `JSON.stringify(envelope)` and parses a
string blob back on read, still accepting an object blob because a
caller-supplied `client` may legitimately return one. An envelope is defined as
something a store can hold as text — `toEnvelope` round-trips through
`JSON.stringify` by construction — so the encoding was always ours to pick, and
the honest pick is the one whose bytes come back unchanged.

**The law, which is the part that outlives this vendor.** In the words of the
field report that bought it:

> *An unreadable stored conversation and an absent one are different facts, and
> only one of them is safe to answer with a fresh start.*

A session nobody has used is absent, and answering it fresh is right. A session
whose bytes are present and unreadable is not, and answering THAT fresh is
invisible from every angle that matters — the reply looks perfect, the run looks
clean, the store looks full. So the reading path now refuses it by name:
`UnreadableEnvelopeError`, carrying `ERR_UNREADABLE_ENVELOPE`, the session id,
and a short prefix of what came back (a prefix only — the rest of those bytes is
somebody's conversation). It sits at `readFormat`, the one place a stored value
is inspected, so every reader and **every store adapter, including ones nobody
has written yet**, inherits it rather than re-deciding it. `standingAgent`
surfaces it as the request's failure, naming the session, and never falls
through to the fresh-start path.

**Then the same pattern, in the other organ.** Diagnosing the session store
meant reading how this repo writes an event blob, and `AgentCoreStore` — the
`MemoryStore` adapter — wrote them identically: `payload: [{ blob: entry }]`,
read back as objects only. Same service, same mangling, same silence, different
loss: an entry that decodes to nothing was *skipped*, so `list()` came back one
memory short and `get()` came back `null`. Memory that silently stays empty is
indistinguishable from memory that works, until somebody notices the assistant
has forgotten a customer's address. Shipping the cure for one organ while the
same disease sat documented in the other would have been the polite cousin of
the silent failure we had just made loud, so both are fixed here.

The memory half gets the same two changes — JSON text on write, `JSON.parse` on
read, objects still accepted — and the same law in the shape this port allows.
`MemoryStore` has no envelope and no shared reading path: there is no
`readFormat` here to inherit from. So the refusal lives at the adapter's own
decode step, the one place raw bytes become an entry, and says so in a comment;
if a `MemoryStore` reading path ever grows a choke point, the law moves there.

**Say this part plainly, so nobody spends a day on archaeology: everything
written by 7.15.0–7.22.0 into AgentCore event blobs is UNRECOVERABLE** — session
envelopes under `{ store: 'memory' }` and every `AgentCoreStore` entry alike.
The mangling is lossy; the returned string is not JSON and cannot be turned back
into a conversation or an entry by any parser, ours or yours. There is no
migration, and this release does not pretend to offer one. What it does offer is
that those sessions and entries now announce themselves loudly instead of
quietly becoming a stranger's blank slate. Delete them, point the store at a
fresh memory resource, or start those conversations again.

Thank you to **a production integration** for finding this on real
infrastructure, reproducing it precisely, and verifying the fix through the
public client seam. Their deployment also closes the outstanding real-cloud item
from 7.15.0 for `{ store: 'session-storage' }` — which behaved exactly as
documented — and, with this release, for `{ store: 'memory' }` as well. Both
session modes have now met the service they were written for; `agentCorePolicy`
and `AgentCoreStore.search()` remain contract-mapped and injection-tested only,
and are still described that way.

### Fixed

- **`agentCoreSessions({ store: 'memory' })` wrote an envelope the service could
  not give back.** The SDK shim now sends `payload: [{ blob: JSON.stringify(envelope) }]`
  and decodes a string blob with `JSON.parse` on the way in. Object blobs are
  still accepted on both the `_sdk` and `client` seams. A blob that is present
  and undecodable — a pre-7.22.1 envelope, or anything mangled in future — is
  refused loudly rather than decoded to `undefined`.

- **`hydrate` no longer answers "no session" for a session that HAS one.** The
  adapter's decode step now distinguishes *no blob at all* (an absence, which
  hydrates as `undefined`) from *a blob it cannot read* (which travels on to the
  shared reading law and is refused by name). Both file and event modes pass the
  session id into `checkEnvelope`, so a refusal names the conversation.

- **`AgentCoreStore` (`agentfootprint/memory-providers`) wrote memory entries
  the same way, and lost them the same way.** Same fix: entries go in as
  `JSON.stringify(entry)`, a string blob is parsed back, objects are still
  accepted. And the same distinction, in this port's own shape — an event
  carrying **no blob** is an absence and is skipped (AgentCore writes events of
  its own into the same log), while a blob that is present and undecodable now
  raises `UnreadableMemoryEntryError` instead of being dropped from the page.
  Dropping it was the bug: `list()` came back one memory short, `get()` came
  back `null`, and an agent answered as if it had never been told.

  The refusal reaches every read path that walks events — `get`, `list`,
  `delete`, `forget` — because a read that cannot see a memory must not report
  "not there" on any of them. `search()` is untouched: it reads AgentCore's
  derived records, not the blobs this store writes.

### Added

- **`UnreadableEnvelopeError`** (`agentfootprint/hosting`) — the refusal every
  reader and store adapter inherits when a stored session is present but cannot
  be read. Carries `code: 'ERR_UNREADABLE_ENVELOPE'`, `sessionId` when the
  refuser knows it, and `storedPreview`: at most 64 characters of what the store
  handed back, which is enough to recognise a mangled encoding and not enough to
  leak what was being said. `withSession(id)` returns a copy naming the session,
  for a reader that knew the bytes were bad but not whose they were.

  It extends `TypeError`, which is what this refusal already threw — the error
  gained a name, a code and a session; it did not change kind, so an existing
  `catch` keeps working.

- **`UnreadableMemoryEntryError`** (`agentfootprint/memory-providers`) — the
  same law where `MemoryStore` can carry it. This port has no envelope and no
  shared reading path to inherit from, so the refusal lives at the adapter's own
  decode step and says so in a comment; if a `MemoryStore` reading path ever
  grows a choke point, the law moves there. Carries
  `code: 'ERR_UNREADABLE_MEMORY_ENTRY'`, the `eventId` and the `sessionId`, and
  `storedShape`.

  **`storedShape`, not a preview, and that difference is the point.** Both
  refusals obey one rule — never the stored content — through one shared helper,
  and they answer it differently because the two shapes differ in where content
  begins. A `CheckpointEnvelope` opens `{ format, data, savedAt }`, so a capped
  prefix is metadata. A `MemoryEntry` opens `{ id, value, … }`, so its second
  field is the thing somebody asked the agent to remember, and even a short
  prefix prints it — a test caught exactly that. So the memory refusal quotes
  nothing at all: type, length, JSON-ness and the opening character, which is
  still enough to recognise "an object stringified by something that was not
  JSON".

- **`checkEnvelope(value, sessionId?)`** — an optional second argument so a
  store's refusal names the conversation. Omit it and nothing changes.

### Changed

- **`standingAgent` fails the request on an unreadable stored session**, naming
  it, instead of hydrating `undefined` and starting a fresh conversation over
  the top. If your store has ever handed back bytes this runtime cannot read,
  you will now see it — that is the point. A store that never has is unaffected.
  Over HTTP it is a **500**, and deliberately: every other hosting refusal is a
  conflict or a shutdown, while this one really is something broken on the
  server's side.

- **[`examples/deploy/durable-sessions.ts`](examples/deploy/durable-sessions.ts)
  gained a third part**, run end-to-end like the rest: a store holding an
  unreadable session, the refusal arriving over real HTTP, the model never
  called, nothing written over what is there, and a brand-new session still
  answered fresh.

- **Documented, where an integrator actually looks:** `runtimeSessionId` must be
  **at least 33 characters** (the service validates it, so a short tidy id is
  rejected before your container sees anything), and a **direct-code (zip /
  `NODE_22`) deployment serves `/ws` fine** — the vendor documentation describes
  WebSocket support for container deployments only, which reads as a restriction
  and is not one. Both are field facts, on the AgentCore adapters page, the
  step-by-step page and the repo guide.

## [7.22.0] - 2026-08-03

Give the socket back.

A production integration hit a wall that had nothing to do with agents: its
runtime gives a container exactly one port, and that container has to answer a
WebSocket upgrade as well as the agent. Every HTTP host here privately created
its own server and listened on it, so "the agent" and "everything else this
process serves" were competing for the one port the platform allowed. The agent
framework was, in effect, demanding a port of its own — a demand no library has
standing to make about a process it does not own.

So `httpHost({ server })` takes a `node:http` server **you** created and
**attaches** to it rather than binding one. That works because `node:http` calls
every `'request'` listener for every request, which makes sharing a port a
matter of taking turns rather than of routing. Every adapter built on `httpHost`
inherits it in the same breath: `nodeHost({ server })` and
`agentCoreRuntimeHost({ server })` are the same option, and the field case — the
runtime adapter next to a `/ws` upgrade — is one line.

The interesting part is what a host may do on a socket it does not own, and the
answer is: **less**. It never writes a 404, because a path it does not own is
the caller's, and a refusal from the agent host on somebody else's route is the
library answering for the application. It never writes to a response an earlier
listener already answered. `close()` detaches and drains and then stops — it
does not close a socket it never opened, does not touch the caller's
connections, and leaves the upgrade beside it connected. That restraint has one
consequence worth stating out loud rather than discovering: node does not 404 an
unhandled request, it leaves it hanging, so on a shared server an unrouted path
hangs unless the caller routes it. Documented on the option, in the guide, and
in the example, because a quiet hang is the worst thing to learn at 3am.

Two things are refused rather than guessed. A `port` or `hostname` beside
`server` throws at construction: a server you own already has an address, and a
port that names a socket this host does not bind leaves a caller believing
something untrue about where their agent answers. And a server that is not
listening yet is refused by `serve()`, because the handle promises the `url` and
`port` it is answering on — reporting an address that does not exist yet, or
inventing `0`, would break the one thing that handle is for. Listen first, then
attach; attaching after `listen()` is safe and is the intended order.

Also in this release: **the MCP-on-a-runtime question, settled by a test rather
than by an opinion.** See below.

### Added

- **`HttpHostOptions.server`** — a caller-owned `node:http` server to attach to.
  The caller keeps `listen()` and keeps the shutdown; the host answers its two
  routes, writes nothing on anyone else's path, and `close()` detaches + drains
  while the socket stays up. With no `server`, behaviour is byte-identical to
  7.21: the host binds, and `close()` closes.

- **`NodeHostOptions.server` and `AgentCoreRuntimeHostOptions.server`** — the
  same option on both shipped adapters, passed straight through rather than
  re-implemented. The runtime adapter does not smuggle its contract's `:8080`
  default in either: with a caller-owned server it binds nothing, so it names
  nothing.

- **[`examples/deploy/one-port.ts`](examples/deploy/one-port.ts)** — an agent, a
  WebSocket echo and a `/metrics` route on ONE port, run end-to-end as its own
  integration test: the upgrade handshakes beside the agent, and after
  `handle.close()` the socket is still listening with the caller's routes and
  the upgrade intact.

- **A conformance test for MCP-on-a-runtime**, in
  `test/lib/mcp/mcpServe.real.test.ts`, judged by the SDK's own client over a
  real socket. **The verdict: `mcpServe`'s streamable-HTTP transport does not
  satisfy the container contract this repo documents for a managed agent
  runtime, and is not trying to.** It serves MCP — statelessly (it neither
  issues nor demands a session id, so replicas are interchangeable), on the path
  and port you choose — and it answers *neither* of the contract's two routes:
  `GET /ping` and `POST /invocations` are 404s from it. Two protocols, two
  paths, two adapters: serve the container contract with
  `agentCoreRuntimeHost` and MCP with `mcpServe`. The one thing that is NOT
  reachable in this release is both on a single port — `mcpServe`'s HTTP
  transport always owns its listener and has no `{ server }` option, which is
  now stated in the MCP guide rather than left to be discovered.

## [7.21.0] - 2026-08-03

The refusal becomes acceptance.

Three releases ago the messages slot was a lie: content declared for it was
recorded as injected, counted in the slot composition, routed by the engine, and
never sent. 7.19.1 refused the declaration by name rather than deliver it badly,
and said why in the same breath — the wire has no system role *inside* the
message list on the Anthropic family (system is a separate top-level field)
while the OpenAI family carries it, so wiring the slot straight through would
have replaced one uniform gap with a **provider-dependent** one that nothing in
the recording could distinguish. Worse than uniformly false, because at least a
uniform gap can be found.

This release is the acceptance that refusal held the door for. A declared
message now reaches the model, and it reaches it the only way that keeps the
recording true: **it becomes part of the conversation.** A new `Deliver` stage
appends it to `scope.history` at the injection-engine boundary — the same window
the window strategies govern, the same window the request is built from. There
is no second list spliced in at send time, so the trace, the slot projection,
the token count, the eviction ledger and the wire are all describing one past.
Everything that was already true of a message is now true of a delivered one for
free: a window strategy can fold it, `traceVariable` can slice it, the commit log
names the stage that let it in.

What survives from the refusal is the part that was always about the wire, and
it survives split in two, each decided against something real. **Role**: every
provider now declares `carriesInMessages`, and a role it does not carry is
refused when the run starts, naming the provider and the roles it does. The role
is never rewritten to one that fits — changing who appears to speak is a meaning
change the app must make, not the library. **Position**: a delivered message goes
at the end of the window, and if its role would repeat the turn already there, it
is *deferred* to the next boundary with a sentence on
`messagesDelivery.deferred`, never dropped and never reordered, and never
inserted between a tool call and its result.

One consequence of that rule is worth saying out loud rather than discovering:
sequencing is judged on the strictest wire, where a tool result counts as a user
turn. Inside a tool-using loop the window ends on the user's turn (first
iteration) or on tool results (every one after) — so **a `role: 'user'`
injection will typically never deliver.** Use `'assistant'`, use `'system'` on a
provider that carries it, or return the words from the tool. Judging collision
per-provider would deliver on one wire and defer on another with nothing in the
recording to tell them apart, which is the same falsehood this feature exists to
end. An honest limitation stated loudly beats a clever one hidden.

### Added

- **`slot: 'messages'` delivers, with a role you name.** `defineFact` and
  `defineInstruction` accept it again, and `Agent.injection()` routes it instead
  of refusing. `role` is **required and has no default** — before 7.19.1 it
  defaulted to `'system'`, the value that reached the model on OpenAI-family
  providers and vanished on Anthropic-family ones, so the default was the bug.
  `slot` and `role` are one decision and the type makes them one choice: a
  discriminated pair, so `slot: 'messages'` without a role does not compile,
  `role` without it does not compile, and `role: 'tool'` never compiles (a tool
  message answers a specific call; an injection has none).

- **`LLMProvider.carriesInMessages`** — an optional
  `readonly ('system' | 'user' | 'assistant')[]` declaring what a wire carries
  inside its message array. All first-party adapters declare it; the three
  resilience decorators forward it, and `withFallback` publishes the
  **intersection** of its pair, because a role only one side carries is a role
  the call might drop. **Absence is not permission**: a provider that omits the
  field is treated as `['user', 'assistant']`, the floor every known wire
  supports. Stated in the custom-provider guide, alongside the wrapper trap.

- **The `Deliver` stage**, mounted only when something could target the slot (a
  registered injection declaring `inject.messages`, or any `.memory()` whose
  recall might). An agent with nothing to deliver has no stage, no write, and no
  delivery record — the chart and the commit log it had in 7.20.

- **`messagesDelivery` on the run's state** — per iteration, what was delivered
  (with the wire index and content hash) and what was deferred (with the reason
  in a sentence). It rides visible stage state rather than a new event contract,
  the way the injection engine's route and delta already do, so it is in the
  commit log and in `snapshot.sharedState` with nothing new to subscribe to. It
  is the committed answer to "why is my declaration not on the wire?".

- **`LLMMessage.injectedBy`** — the marker naming who let a message into the
  window, so the slot attributes it to its injection instead of inferring a
  source from its role. It is stripped in `callLLM` before the request exists,
  so it can never reach a provider — not "ignored by our adapters", removed. A
  consumer-authored adapter that serializes a message wholesale cannot leak it.

### Fixed

- **The cache marker for `field: 'messages'` pointed at the wrong message.** It
  counted entries in a per-slot list of *injections* and handed that count to
  providers who read it as a position in `request.messages` — two index spaces
  under one name. It was unreachable while nothing could target the slot, and
  delivery makes it reachable, so it is recomputed against the actual wire array
  after windowing and delivery, and pinned: a marker's index names the message it
  claims to name.

  The same mismatch existed one step further out, and is fixed with it: the
  Anthropic body is not `request.messages` either — system messages are dropped
  and consecutive tool results are coalesced into one user turn — so the browser
  adapter was placing `cache_control` by raw ordinal into a shorter, differently
  ordered array. It drifted one position per tool round-trip, which put the cache
  breakpoint on the turn that changes every iteration: the one place a prefix
  cache can never be reused. The transform now yields an index map and the marker
  is translated through it. A marker naming a message that does not survive the
  transform marks nothing, rather than marking its neighbour.

- **A declared `cache` policy never reached the cache decision.** The
  `ActiveInjection` projection drops `metadata` (it is the scope-safe POJO), and
  `computeCacheMarkers` read the policy from exactly there — so in every real run
  every injection resolved to `'never'` and only the base system prompt could ever
  be marked cacheable. The projection now carries the one key the decision reads.
  Without this the marker fix above would have been true and still unreachable:
  the same falsehood, one layer down.

### Changed

- **`dynamic-grouped` recordings gain one commit per iteration.** Delivery made
  `history` writable inside the grouped chart's turn subflow for the first time,
  and the turn seed now writes it unconditionally — so a `dynamic-grouped` agent
  records one additional (often empty-delta) commit per iteration whether or not
  anything is delivered. No wire bytes and no committed values change; only the
  commit count. The flat chart is byte-identical to 7.20.0 when nothing declares
  the messages slot. A reader diffing recordings across versions deserves this
  sentence, so here it is.
- **The messages slot stops recording what it does not deliver.** It no longer
  walks `activeInjections` looking for `inject.messages`; a delivered injection
  is already in the window when the slot runs, so it is projected like any other
  message and credited to its injection by the marker. One wire message, one
  `context.injected` record, one name — and the content hash is the same formula
  the window stage uses for `context.evicted`, so injected and evicted refer to
  the same piece of context by the same id.

- **`history` is writable inside `sf-llm-call`** (`reactMode: 'dynamic-grouped'`).
  It used to cross that boundary as a read-only input, which was fine while
  nothing inside changed it; delivery does. It now takes the same `prior*`
  round-trip the token accumulators take, and a test pins the law it protects:
  the window an iteration sent is the window the next iteration continues.

- **The two docs 7.19.1 missed become correct rather than corrected.**
  `docs/INSTRUCTION_ARCHITECTURE.md` and `docs/guides/instructions.md` were still
  teaching the old promise — "the messages slot is the recency window, highest
  attention" — three releases after it was withdrawn. They now describe what
  actually happens, limitation included.

### Notes

- **Delivered once.** An always-on injection enters the window on the boundary
  it activates and is not re-appended every iteration. Dedupe reads the run's
  ledger **and** the markers already in the window, which is what makes replay
  safe: `resumeOnError` restores a conversation into a fresh scope, so a
  ledger-only check would deliver a second copy of a message already sitting
  there.

- **Not resurrected.** A window strategy that drops a delivered message has made
  a decision; re-delivering it at the next boundary would be the library
  overruling that decision forever.

- **`defineMemory({ asRole })` stays refused — for a different reason.** 7.20.0
  refused it as never-read and blamed a limitation: honouring it meant routing
  recall through a messages slot that could not deliver. That limitation is gone
  now, so the sentence would have been resting on a retired fact — the same class
  of stale claim the refusal exists to remove. It now says the true reason: the
  machinery exists, a recall formatter emitting a non-system role becomes a
  `slot: 'messages'` injection like any other, and **nobody has asked for it.**
  Building it because the mechanism arrived is how a library grows options nobody
  reads. Field evidence decides.

- **A typed `agentfootprint.context.deferred` event is the named next step**, if
  field evidence asks for it. The deferral is committed and queryable today; an
  event is an additive change that costs a permanent contract, and the evidence
  rule decides that, not the convenience of having one.

- **Filed, not fixed:** `CacheMarker{field: 'tools'}` has the identical index
  mismatch — it counts injections that contribute tools and is stamped onto the
  request's tool array. It is out of this release's scope, and it is now the only
  one of the pair left.


## [7.20.0] - 2026-08-03

Three small honesty fixes. No new machinery, no delivery change, no wire bytes
different for anyone.

7.19.1 fixed a recording that disagreed with the wire. This one fixes a
recording that disagreed with **itself**. Two events describe a memory or RAG
recall — the memory stage's own `agentfootprint.context.memory.injected` and
the slot composer's `agentfootprint.context.injected` — and they named
different slots for the same bytes. One of them was wrong, and it stayed wrong
in every guide that repeated it. A trace whose own events contradict each other
cannot be reasoned about at all: there is no way, from inside the recording, to
tell which half to believe.

The second fix is the same shape one layer up. `defineMemory({ asRole })` and
`defineRAG({ asRole })` took a role, stored it on the definition, and were read
by nobody — every formatter this library ships writes `role: 'system'`, so
recall has always been injected as system whatever the option said. `defineRAG`
defaulted it to `'user'` and documented the reasoning at length, which made the
lie legible: you could pick a role, read it back off the definition, and be told
a role the run would never use. **A throw where there was a silent lie is a fix,
not a break: nothing that worked stops working, and something that never worked
stops pretending.**

### Fixed

- **`context.memory.injected` reported the wrong slot.** The event now says
  `slot: 'system-prompt'`, which is where recall actually lands, and it is
  checkable end to end: `formatDefault` writes one `role: 'system'` message,
  `memoryRecallInjections` routes system-role recall to `inject.systemPrompt`,
  `buildSystemPromptSlot` records it as a `slot: 'system-prompt'` injection, and
  the request carries it in `systemPrompt` — never in the message list.

  This is a **consumer-visible payload change**: anyone branching on
  `slot === 'messages'` from this event will stop matching. They were branching
  on a lie — the value was never true of this stage, which has always formatted
  recall as system — and the fix is to branch on `'system-prompt'`, or on the
  `context.injected` event that has been saying so all along. Nothing about
  where the content goes changed; only the claim did.

  A permanent test pins the law: the slot named by `context.memory.injected`,
  the slot named by `context.injected`, and the request field the bytes are
  actually in must all agree. It is written as an equality between the three
  surfaces rather than a hard-coded `'system-prompt'`, so if recall ever lands
  somewhere else the test fails on **disagreement**, not on change.

- **`asRole` was stored and never read.** `defineMemory({ asRole })` and
  `defineRAG({ asRole })` now refuse the declaration by name. The option is gone
  from both public option types, so TypeScript reports it at the keystroke, and
  both factories throw for JavaScript callers and casts. The refusal states the
  truth (never read; recall is always injected as system), and points at what
  would change it: role-differentiated recall means putting recall into the
  messages slot, which does not reach the model (7.19.1), so it arrives with the
  messages-delivery feature if field evidence asks for it.

  The refusal fires on **presence, not value** — an explicit `asRole: 'system'`
  named the role the run happens to use, but it was just as unread, and letting
  it through would teach that the option is honoured.

  The dead `asRole` field is also gone from `MemoryDefinition`. A definition
  field that no run consults is a claim the recording cannot back. `defineRAG`'s
  documented `'user'` default goes with it; every other default (`topK: 3`,
  `threshold: 0.7`) is unchanged, and so is every run.

### Changed

- **Docs stop saying recall lands in the messages slot.** The RAG, grounding,
  memory, semantic-retrieval, fact-extraction, auto-memory and narrative-memory
  guides, the RAG example (`examples/context-engineering/07-rag`), and the RAG
  snippets in `AGENTS.md` + `ai-instructions/` all said "the messages slot" for
  content that has always gone to the system prompt. The last two matter most,
  because an assistant reading them was being taught to write the placement
  claim the event has just stopped making — and, in the same snippet, the
  `asRole` line that now throws.

## [7.19.1] - 2026-08-03

A recording that overstates what the model saw is worse than no recording, and
one of ours did. An Injection declared for the **messages slot** was recorded as
injected — `context.injected` fired with its content, the slot composition
counted it, the engine routed it — and never sent: the request's message list is
assembled from the conversation, and the messages slot is the observability
projection of that conversation, not a wire. The docs promised the delivery in
detail ("higher attention weight", "appears alongside fresh tool results"). The
promise was never kept.

It is refused now, at the declaration, in a sentence that names the three
placements that do reach the model. **A throw where there was a silent lie is a
fix, not a break: nothing that worked stops working, and something that never
worked stops pretending.**

Delivering it instead was the other option, and it was rejected on evidence.
The wire has no system role INSIDE the message list — the Anthropic and Bedrock
adapters drop such a message, because system is a separate top-level field,
while the OpenAI adapters carry it — and `'system'` was this option's default
role. Wiring the slot up without a per-provider notion of what each provider can
carry would have replaced one uniform gap with a **provider-dependent** one, and
nothing in the recording could have told the two apart. Honest delivery needs a
wire-carrying key out of the slot, that provider capability, and a
message-sequence rule; it is queued as a feature, with this gap as its evidence.

### Fixed

- **`slot: 'messages'` injections were recorded and never sent.** `defineFact`,
  `defineInstruction` (and `defineInjection` routing to either) now refuse the
  declaration, and `Agent.injection()` — the one funnel `.skill` / `.steering`
  / `.instruction` / `.fact` all pass through — refuses a hand-built `Injection`
  carrying `inject.messages`, so the refusal cannot be walked around. The
  message names the limitation and the working alternatives: `slot:
  'system-prompt'` (the default, delivered by every provider), a tool's return
  value (a tool result IS a recent message, at the recency the option was
  reaching for), and the text passed to `agent.run({ message })`.

  `slot` narrows to `'system-prompt'` on both factories and the dead `role`
  option is gone, so TypeScript reports it at the declaration; the run-time
  refusal still fires for JavaScript callers and casts. A declaration that used
  to build, run and silently do nothing now fails where it is written.

  **No wire bytes change for anyone**, and a permanent test now pins the law
  this violated: every `context.injected` the messages slot emits must appear in
  the request the provider was handed.

- **`mcpServe({ transport: 'http', port: 0 })` bound a port the caller could not
  discover.** "Any free port" was unusable from the outside: the number the OS
  chose lived inside a listener nobody could see, so every caller had to name a
  port up front and race whoever else wanted it. The handle now reports
  `port` and `address` for the HTTP transport — absent (the KEYS absent, not
  undefined) for stdio, which has no socket. An explicitly chosen port is
  reported back unchanged, so code can read it without branching on how the
  port was set. No URL is assembled: a wildcard bind is not an address a client
  can dial, and a handle that handed one out would be inventing reachability.

### Changed

- **The messages slot's own comment now says what it is** — the observability
  projection of the conversation, with the window governed upstream by
  `scope.history` and the loop-head window stage (7.16–7.17), which is where the
  windowing and summarizing that a stale "arrives in Phase 5" note still
  promised actually landed.

- **Docs stop promising messages-slot delivery**: the Instructions guide, the
  Instruction and Fact examples, the trigger table in the README, the Injection
  row of the skills comparison, and the slot tables in `AGENTS.md` +
  `ai-instructions/` — the last two matter most, because an assistant reading
  them was being taught to write the one declaration that now throws. Where the
  guide recommended the messages slot for recency, it now recommends the tool
  result — the placement that reaches the model at the same position.

Two things separate an agent you demo from an agent that is up: what a crash
costs you, and what happens when it needs to ask a person something.

7.18 and everything before it answered both the same way — badly. A standing
agent wrote once, at the end of a turn, so a restart lost every tool call the
turn had made. And a run that stopped to ask a person **failed the reply and
stored nothing**, because `'conversation-v1'` held a conversation and a paused
run is a conversation plus an engine checkpoint. That was the honest thing to do
with no format to put it in. There is one now.

**`durability: 'sync'` gives the replay bound a number.** Iteration N's tools do
not execute until iteration N−1's write has landed. Not "we write often" — a
bound: the work a crash can re-run is the current iteration, and nothing before
it.

**A paused run is stored as `'flowchart-v1'` and the reply says so as data.**
`HostReply` grew its third terminal — `complete`, `awaiting`, `fail` — and a
pause leaves through `awaiting`, 202 over HTTP, never through `fail` again. A
later request carrying a `decision` continues the run from exactly where it
stopped, and the tool that asked does not run twice.

### Added

- **`durability: 'exit' | 'async' | 'sync'` on `standingAgent`.** Default
  `'exit'` — one write when the run finishes, which is what every release before
  this one did, now spelled out rather than implied. Under `'exit'` **nothing is
  installed**: no observer on the agent, no barrier, no per-commit work.

  `'async'` starts a write whenever the conversation changes and never waits on
  it; the run does not slow down. At most one write is in flight and the newest
  snapshot supersedes any queued one, so what a crash leaves is always a PREFIX
  of the run, never a mixture.

  `'sync'` is persist-then-proceed, and it holds the tool dispatch — see the
  judgement below for why it had to.

- **`'flowchart-v1'` — the format the version field was kept for.**
  `CheckpointEnvelope` is now a union discriminated on `format`, so a reader
  that switches on it is exhaustive by construction. `toPausedEnvelope(run)` /
  `readPausedRun(value)` pack and unpack a **`PausedRun`**: the engine
  checkpoint, the conversation as of the pause, and the outstanding ask.

  The two readers refuse **each other's** format and each points at its sibling.
  A reader that quietly returned the conversation inside a paused run would hand
  back a session that looks finished while somebody is still waiting to be asked.
  `checkEnvelope(value)` is the third door, for STORES: it validates either
  format and hands the envelope back, because a store's job is to notice
  unreadable bytes, not to care which half of a session is inside them.

- **`HostReply.awaiting(pending)` — the third terminal.** Optional on the type,
  exactly as `emit` is, so a minimal adapter still satisfies the port; every
  shipped adapter implements it. `nodeHost` answers **202 Accepted** with
  `{ awaiting }`, the AgentCore runtime wire answers its own dialect, and both
  stream an `awaiting` frame under SSE. A host without it still gets the paused
  run STORED and a named refusal on the wire — the store is not the transport's
  business.

- **`PendingAsk` — the part of a pause that is safe to hand back.** The tool
  that asked, the question in plain words, the typed `checkIn` with its evidence
  pack, the middleware `ask`, and the raw `pauseData` uninterpreted. It carries
  **no checkpoint and no conversation**, and a type-regression test fails the
  build the day either appears.

- **`HostRequest.decision` — the resume discriminant.** A request carrying it
  answers the outstanding question; a request without it is a new message. The
  port never interprets it: it goes to `agent.resume(checkpoint, decision)`
  exactly as it arrived, answered with the shipped `checkInApproved()` /
  `checkInDeclined()` vocabulary for a check-in or a middleware ask, and with
  whatever the tool's author documented for a plain `askHuman`.

- **`AwaitingDecisionError` / `NoPendingAskError`** (`ERR_AWAITING_DECISION`,
  `ERR_NO_PENDING_ASK`, both 409). A new message while a question is outstanding
  is refused NAMING the pending ask — the message is not run and the pause is
  not discarded. A decision when nothing is pending is refused too, rather than
  run as if a person had typed an approval into the conversation.

- **`WakeReason` gained `'resume'`**, now that something can produce it.

### The judgements these rest on

**`'sync'` had to hold the tools, not just the reply.** The cheap reading —
"await every write before answering" — is honest and bounds nothing that
matters. Under it, iteration N's tools execute while iteration N−1's write is
still in flight, so a crash re-issues MORE than one iteration of side effects
and "how much can re-execute?" has no answer. The market meaning of durable
execution, and the expectation the word `'sync'` imports, is precisely that
bound. A `'sync'` that did not deliver it would be documented-but-misleading,
which is the polite cousin of config that lies.

**So the barrier is real, and it is private.** footprintjs never awaits an
observer — the inline recorder path discards the hook's return value, and only
the deferred tier tracks a promise, one beat behind. There is no way to apply
back-pressure to a traversal from outside it. The barrier therefore lives INSIDE
the agent's tool dispatch, asked once per iteration, and is installed through a
module-private WeakMap keyed on the runner: `standingAgent`'s session writer is
the only thing that can install one, and it appears on no barrel and no subpath.
A general "run something between my stages" hook would have been a new public
extension point on seams that are deliberately closed — it would let any
consumer inject latency, ordering and failure into a traversal, and every later
feature would have to reason about it. When nobody has installed a barrier the
accessor returns `undefined`, so the dispatch loop does not await, does not
schedule a microtask, and is byte-identical in timing.

**The bound is per ITERATION, and that is exact rather than convenient.** The
agent dispatches all of one iteration's tool calls inside one stage body, and a
commit is a whole stage. So a crash part-way through re-runs that iteration's
tools — the same idempotency requirement `resumeOnError` has always carried, now
with a boundary instead of a warning. A test pins that an iteration which ran two
tools stores both results or neither, never one.

**It writes where the conversation MOVES, not on every commit.** A
two-iteration turn commits about forty times; exactly two of those change the
conversation — the user's message landing, and each tool-call stage. The other
thirty-eight would store bytes identical to the last write. So the trigger is
"this commit wrote `history`", which is not an optimisation but the honest
reading of the question: the conversation moved iff `history` moved.

**A mid-run write can only be a conversation, and that is enough.** footprintjs
builds a `FlowchartCheckpoint` only at a pause, so there is no engine snapshot to
store mid-run. What the commit boundary can hand over is the same
`AgentRunCheckpoint` a finished turn stores — which is exactly what the next turn
resumes from.

**A store that refuses fails the request.** Fail-closed: under `'sync'` the next
tool does not run, and the reply reports the store's error rather than an answer.
A store that would not take the run's progress has not made it durable, and
proceeding as if it had is the dishonesty this dial exists to remove.

**Mid-run writes settle BEFORE the terminal envelope.** Ordering, not tidiness:
an `'async'` conversation write still in flight would otherwise land after the
pause envelope and overwrite it — a stored question quietly demoted back to a
plain conversation, and the person who was asked never answered. A test pins it.

**A `FlowchartCheckpoint` is JSON-safe to resume from and NOT byte-identical
through JSON.** `JSON.stringify` drops every property whose value is `undefined`,
and a real paused run has about a dozen — all of them in the engine's diagnostic
halves (`executionTree`, `subflowResults`). `sharedState`, the half `resume()`
actually reads, round-trips unchanged, because footprintjs already
JSON-round-trips every object write on its way into committed state. Three tests
pin it: the resume-relevant fields survive byte for byte, every difference at all
is a dropped `undefined`, and a run resumes from a checkpoint that came back off
a string-keyed store.

**A pause is never delivered through `fail` again.** It was, for one release,
because there was nowhere to put it. An error standing in for unfinished work
tells every dashboard downstream something untrue: nothing broke, nothing needs
retrying, and there is a person to ask. `PauseNotCarriedError` survives with its
code intact for the one case where a pause genuinely cannot be carried — a
request with no session id, so there is nowhere to store it and no later request
that could ever answer it.

### Changed

- **A paused hosted turn now answers `202` and stores a `'flowchart-v1'`
  envelope, where 7.18 answered `409` and stored nothing.** This is a behaviour
  change a deployer has to read. During a rolling deploy, an instance still on
  7.18 that hydrates one of those sessions **refuses it by name** — the
  unknown-format law working exactly as designed, loudly rather than silently.
  Drain or roll forward rather than running both versions against one store.
- `agentCoreSessions` validates through `checkEnvelope`, so an AgentCore-backed
  store keeps paused sessions as readily as conversations; the AgentCore runtime
  wire reads `decision` and answers `awaiting` in its own dialect.

Docs: [Hosting](https://footprintjs.github.io/agentfootprint/docs/build/infra/hosting) ·
Example: `examples/deploy/durable-sessions.ts`.

## [7.18.0] - 2026-08-03

Every agent framework lets you wrap a tool call. Most of them let the wrapper
*answer* — return a canned string, a cached value, a "simulated" result — and
the moment one does, the trace is fiction. The model was told a tool ran.
Nothing ran.

This release ships a typed chain around every tool dispatch and around the
message boundary, and the wrapper **cannot answer**. The outcome union has
three arms — `allow`, `deny`, `ask` — and no arm for a result. There is no
spelling of "here is what the tool would have returned". So whatever a chain
decides, what the model finally reads is the real tool's output or a refusal.
That is not a convention a reviewer enforces; it is the absence of a field, and
a type-regression test fails the build the day someone adds one.

The same law decides what an `ask` resumes with. A middleware suspends the run
to put a question to a person — on the pause machinery `askHuman` and `checkIn`
already ride, not a second one — and the answer that comes back is a
**decision, not a result**. Approve and the chain continues from the next link
and the REAL tool runs. Decline and it becomes a denial the model reads and
adapts to. Nobody, not the middleware and not the person who approved it, gets
to write the tool's answer.

And a transform says so. `allow(value, why)` **requires** the `why`, and the
run commits both the value it received and the value it produced. A prompt
scrubbed by a middleware that hid its own scrubbing would poison every slice
taken afterwards: the trace would show text nobody ever sent.

### Added

- **`.toolMiddleware(...middleware)` — a chain around every tool dispatch.**
  Each link answers `allow()`, `allow(args, why)`, `deny(reason)` or
  `ask({ question })`. Order is call order and each link sees the previous
  one's output; the first non-`allow` answer wins and the rest of the chain
  does not run, because a refusal a later rule could overturn is not a refusal.

  A `deny` reason **reaches the model verbatim**, as the tool result, on the
  same synthetic-tool-result path every other refusal in the dispatch loop has
  always used — so the loop continues and the agent adapts in flight. A denial
  is data, not a crash.

  The chain sits **after the permission gate** (an existing `PermissionChecker`
  still decides first, and a call it denies never reaches a middleware) and
  **before arg validation** (so validation judges the args that will actually
  be sent, not the ones the model proposed).

- **`.messageMiddleware(...middleware)` — a chain around the message
  boundary.** The `'input'` half runs at the very top of the run, BEFORE the
  message is committed; the `'output'` half at the moment the run knows this
  turn is the final answer.

  The input placement is the whole point. Everything downstream reads the
  committed history — the window strategies, the injection engine, all three
  slots, the bytes on the wire, and every slice taken afterwards — so the
  transformed text is what the entire run agrees was said. Transform any later
  and the trace shows one message while the model answered another.

- **`allow` / `deny` / `ask`, flat on the package root.** They are the verbs of
  this domain, written several times inside every middleware body.

- **`ask` suspends on the SHIPPED pause machinery.** `isAskPause(outcome)`
  narrows a paused run and `outcome.ask` carries `{ question, detail?,
  middleware }`. Resume with `checkInApproved` / `checkInDeclined` — the same
  human-answer vocabulary check-ins use, deliberately, because a person
  approving is a person approving and one word for one thing beats a synonym.
  A malformed resume DECLINES, so a governed call can never execute because a
  message was mis-shaped.

  Because it is the shipped wire and not a new one, hosting needed no change at
  all: over a `standingAgent` an outstanding middleware question is refused as
  unfinished work with `PauseNotCarriedError`, naming the tool, session
  untouched — byte for byte what `askHuman` already did. A test pins it.

- **`scope.middlewareDecisions` — the ledger.** One row per decision, in order,
  carrying the middleware's name, the outcome, whether the value changed, the
  `why`, and — for a transform — both the `before` and the `after`.

  Every decision files a row, **including the pass-throughs**: "the rule looked
  and was fine with it" and "the rule never ran" are different facts about a
  run. Written only by an agent that configured a chain; absent otherwise.

- **`MessageDeniedError`** — raised when a message chain refuses, at either
  phase, carrying `reason` / `phase` / `middleware` and never the refused
  content.

- **`mcpServe(tools, { toolMiddleware })`** — the governance law extended to
  the served boundary. It runs before `execute` and before credentials resolve,
  exactly as inside an agent. An `ask` there answers the client with a tool
  error **naming the middleware** rather than executing ungoverned, in the same
  wording the `checkIn` refusal uses.

- **One typed event, `agentfootprint.middleware.decision`** (68 events, 20
  domains). It carries the fact — who, where, which outcome, whether the value
  changed — and deliberately **not** the values.

### The judgements these rest on

**A middleware cannot fabricate a result, and that is a type, not a rule.**
Every framework that lets a wrapper return a value eventually has a run whose
trace says a tool answered when nothing did. Removing the arm removes the
class. It is also why `ask` resumes with a decision: had the human's answer
become the tool result, a middleware would have found the fabrication door
again, through a person.

**`ask` exists only where a pause exists.** `ToolOutcome` has it because tool
dispatch runs inside a footprintjs pausable stage. `MessageOutcome` does not,
because the message boundary is a plain stage — and inventing a second pause to
give it one would be a worse answer than not offering it. The type says so, so
nobody discovers this at run time.

**footprintjs 9.14's `interrupt()` was considered and declined.** It re-enters
the stage from its TOP on resume, and tool dispatch runs N tools in one stage
body — so resuming would re-execute every tool already dispatched that
iteration, which is precisely the class of side effect a middleware exists to
govern. (It would also have forced a peer bump inside a minor.) The pausable
handler's execute/resume split does not re-run the loop, so `ask` rides that.

**At most one human question per resume.** A resumed dispatch has no second
checkpoint to offer. If a later link also asks — or the tool itself declares
`checkIn` — the call is **not executed** and a named refusal reaches the model,
matching the rule already applied to a tool that tries to pause during an
approved check-in resume. Executing a call whose consent gate was silently
skipped would be the worse failure by a wide margin.

**The output chain runs in the Route decider, not in PrepareFinal.**
PrepareFinal is where `finalContent` is set, which makes it look like the seam.
It is not: it lives inside the Final BRANCH subflow, whose state does not merge
back into the run, so ledger rows filed there would sit in an isolated commit
log and split one ledger across two places. The decider is one stage earlier,
in the main chart, and it is the first moment the run knows this turn is the
answer.

**`allow` / `deny` / `ask` are flat exports, and that was a deliberate call.**
They are generic words on a package root and the collision surface is real.
They are also the verbs of this domain, written constantly inside middleware
bodies, and the ergonomic value of `deny('writes to prod need a ticket')` over
a namespaced ceremony is worth more than the theoretical clash. The names were
unclaimed.

**The ledger keeps the original, and for the `'input'` phase that row is the
only copy.** The seed stage commits the transformed message and nothing else
holds what arrived. That is the honest trade: the transform is legible
precisely because the run kept what it replaced. If the original must not
survive in the commit log, that is a redaction question and footprintjs already
answers it — configure redaction over `middlewareDecisions` and `before` /
`after` scrub at write time while the decision row survives. A security test
pins both halves, because honesty and protection are both laws and that is
where they meet.

**Absent middleware is byte-identical.** No chain walk, no committed key, no
bridge attached, the same request bytes, and seed stays the synchronous stage
it always was. A test pins the wire and the committed key set against an agent
built without one.

Docs: [Middleware](https://footprintjs.github.io/agentfootprint/docs/build/middleware) ·
Example: `examples/features/37-middleware.ts`.

## [7.17.0] - 2026-08-02

7.16.0 shipped compaction. It shipped it on a seam — an internal
`WindowStrategy` interface with exactly one implementation behind it, pinned
private, because a seam nobody has used twice is a guess.

It has been used three times now, so it is public, and its two market siblings
ship with it.

**`slidingWindow({ keepRecentTurns })`** keeps the last N turns and drops the
rest. **`tokenBudget({ thresholdTokens })`** keeps compaction's trigger
discipline — counted from the provider's own reported usage, never estimated —
and drops instead of summarizing. Neither makes an LLM call. Both go through
the SAME turn segmentation and the SAME refusal engine as compaction, which is
the whole point: a message-counting trimmer splits an assistant's `tool_use`
from its `tool_result` and the vendor rejects the request. Here that turn
refuses **by name**, and the strategy takes the next oldest instead.

The one-sentence differentiator, true of all three: **every strategy here
records what it removed, by id.** The removed turns stay in the commit log
byte-identical — footprintjs's log is append-only, so nothing can edit them —
and each strategy files its own recorded step naming every `runtimeStageId`
whose messages left, plus one `context.evicted` event per message with its
measured lifetime. Removing is not forgetting.

### Added

- **`.window(strategy)` — the general door.** Pass any `WindowStrategy`.
  `.compaction({ ... })` stays exactly as it shipped and is now sugar for
  `.window(summarizeOldest({ ... }))`; a test pins that the two spellings send
  byte-identical requests and file identical records. Exactly one strategy per
  agent — a second through either door throws at build time, because a window
  policy that quietly changed is a policy you cannot audit.

- **`slidingWindow({ keepRecentTurns })` — keep the last N turns.** No
  summarizer, no LLM call, and **no usage requirement**: it triggers on turn
  COUNT, so it runs on any provider, including the OpenAI-compatible endpoints
  that send no usage while streaming. Nothing about it is unmeasurable, so it
  never throws. It also emits **no** `context.budget_pressure` — it has no
  token budget, and reporting a `capTokens` nobody configured would be exactly
  the invented number this family refuses.

  `keepRecentTurns` is required and has no default. It *is* the policy.

- **`tokenBudget({ thresholdTokens, keepRecentTurns? })` — counted, then
  dropped.** Reads the input tokens the adapter reported for the last call and
  drops the oldest contiguous removable span when they exceed the threshold.
  A provider that reports no usage gets the same named refusal compaction
  makes: **`CompactionUnmeasurableError` is now thrown by both token-triggered
  strategies** and kept its 7.16 name rather than gain a synonym for the same
  refusal.

- **The strategy seam is public**: `WindowStrategy`, `WindowStrategyInput`,
  `WindowStrategyResult`, `WindowEviction`, `RemovalFacts`, `RemovalPlan`,
  `Turn`. Two things are deliberately not left to an implementer. The refusal
  rules arrive **pre-bound** as `input.planRemoval(...)` — a strategy never
  receives the guards, only the answer, so it cannot forget that an unanswered
  tool call must not leave the window. And `input.removalFacts(...)` resolves
  provenance, so a strategy cannot file a removal it is unable to name. The
  TRIGGER, by contrast, is entirely the strategy's own: `plan()` is called at
  every iteration boundary and returns `undefined` when it did not engage.

  Each factory is its own module and registers nothing at import — a bundle
  that never mentions `summarizeOldest` never carries the summarizer
  machinery. A test pins that importing them mutates no registry, and that
  none of them needs an entry in the `sideEffects` allowlist.

- **`WindowRecord` — one record shape for the family**, carrying `strategy`,
  `removedStageIds`, `removedMessageCount`, exact `windowCharsBefore/After`
  and the named `refusals`. `CompactionRecord` now extends it, and
  `SlidingWindowRecord` / `TokenBudgetRecord` add each strategy's own facts.
  All three land on the same `scope.compactions` array; narrow by `strategy`.

  The key stays `compactions` — the name the family's first member gave it.
  It is committed state, which is public surface for everyone reading a run,
  and renaming a committed key one release later would break those readers for
  a better word.

- **`DROP_NOTICE_PREFIX` / `isDropNotice(msg)` — what a drop leaves behind.**
  When a drop removes the window's HEAD, one authored `user` message takes
  that position. The first reason is the wire, not the prose: an agent window
  is `user, assistant+tool, assistant+tool, …`, so dropping the oldest turns
  leaves an assistant message at the head, and the providers that care require
  the window to open on a user turn. Something must occupy that position —
  and a message we are forced to author should say what happened. Unlike the
  compaction frame, **no model wrote a word of it**.

  It appears only at the head (a removal in the middle leaves the opening turn
  in place, so there is nothing to fix and a spliced `user` message is its own
  risk); it never accumulates (the next drop absorbs it); and if it would not
  be *smaller* than the span it replaces, the whole drop is abandoned under
  `summary-not-smaller`, whose meaning generalizes to "the replacement came
  back no smaller than the span" rather than growing the closed reason union.

### Changed

- **`WindowRefusal` / `WindowRefusalReason` are the canonical names** for what
  7.16 called `FoldRefusal` / `FoldRefusalReason`. Refusals are shared by all
  three strategies and only one of them folds. The old names remain exported
  as deprecated **aliases of the same types** — code written against 7.16
  compiles unchanged, and they are not going away in 7.x. Same for
  `CompactionRecord.foldedStageIds` / `foldedMessageCount`, which are still
  written and now sit alongside `removedStageIds` / `removedMessageCount`.

- **Compaction records now carry `strategy: 'summarize-oldest'`** and the two
  family field names described above. Everything 7.16 wrote is still written.

- **The window stage now asks its strategy at every iteration boundary**,
  because the strategy owns its own trigger. For a compaction agent that means
  the reads channel records a read of `history` on iterations that change
  nothing — a read which genuinely happens. Request bytes, committed values
  and the commit-log structure are unchanged; only the recorded reads differ,
  and anyone diffing recorded reads across 7.16 → 7.17 will see it.

- The one-per-run dev warning from a broken summarizer is now prefixed
  `[agentfootprint window:summarize-oldest]` rather than
  `[agentfootprint compaction]`, so the log line names the strategy that
  produced it. The chart's `compact` stage keeps its id (every lens and
  matcher binds to it) and now describes which strategy is mounted.

Docs: [Window strategies](https://footprintjs.github.io/agentfootprint/docs/build/window-strategies) ·
Example: `examples/context-engineering/12-window-strategies.ts`.

## [7.16.0] - 2026-08-02

Every agent framework compacts a long conversation the same way: summarize the
old turns, drop them, carry on. It works, and it costs you the run. The next
day, when you have to explain what the agent did, the middle of the
conversation is gone — replaced by a paragraph a cheap model wrote, presented
as if it were what happened.

A summary is a **claim about the past**. This release files claims as claims.

**The law: compaction edits the WINDOW, never the LEDGER.** The window is
`scope.history`, the array that goes on the wire. The ledger is the run's
commit log, which is append-only — the stages that wrote those turns committed
them before the fold existed, so a fold physically cannot erase them. What it
can do is stop re-sending them, and say so: the summary enters as **its own
recorded step**, naming every `runtimeStageId` it folded, what the last call
actually measured, and every turn that refused to fold and why. A compacted run
is still a provable run. The lens draws a fold seam, not a hole.

The example prints both halves of that sentence — the small window the model
now sees, and the original 1,150-character tool output pulled back out of the
commit log, verbatim.

Two properties make it a compactor you can trust rather than one you hope
about. It is **counted, not guessed**: the trigger reads the input tokens the
provider itself reported, and a provider that reports none gets a named
refusal instead of an invented number. And it **never folds an open question**:
a turn holding an unanswered tool call, a paused tool, or a pending check-in
refuses by name, and the fold takes the next oldest instead — because folding
an unanswered question destroys the referent of the answer that has not
arrived yet.

### Added

- **`.compaction({ thresholdTokens, summarizer, model?, keepRecentTurns? })` —
  keep the live window inside a token budget without ever losing the record.**
  At each ReAct iteration boundary the compaction stage compares the last
  call's **adapter-reported** input tokens against `thresholdTokens`. Over
  budget, it folds the oldest foldable span of the conversation into one
  summary message and sends that instead.

  `thresholdTokens` is **required, with no default**. The right budget depends
  on your model and your bill; a number the library invented would be inherited
  silently by every run. `summarizer` is required and explicit for the same
  reason in the other direction — the library will not quietly bill your main
  model for compaction.

  Never folded: the system envelope (it is not in the window at all — it rides
  `systemPrompt`), the last `keepRecentTurns` turns (default 6), and any turn
  holding something unresolved. The fold always takes a **contiguous** span, so
  a turn that refused never ends up sitting after a summary of things that
  happened before it — survivors keep their order.

  Omit `.compaction()` and nothing changes: no stage, no extra committed key,
  the same request bytes. A test pins that a configured agent whose threshold
  is never reached sends requests byte-for-byte equal to an unconfigured one.

  Docs: [Compaction](https://footprintjs.github.io/agentfootprint/docs/build/compaction) ·
  Example: `examples/context-engineering/11-compaction.ts`.

- **`CompactionRecord` on `scope.compactions` — the fold's half of the law.**
  One record per over-budget visit, *including the visits that folded nothing*,
  which are the interesting ones. It carries `foldedStageIds` (real
  `runtimeStageId`s, resolvable in the commit log), `foldedMessageCount`,
  `measuredTokens` vs `thresholdTokens`, exact `windowCharsBefore` /
  `windowCharsAfter`, what the summarizer call cost, and a **named refusal per
  turn** that did not fold: `unresolved-tool-call`, `paused-tool`,
  `pending-check-in`, `system-envelope`, `inside-keep-window`,
  `only-existing-summary`, `summarizer-failed`, `summary-not-smaller`.

  There is deliberately **no `tokensAfter`**. Nothing can count the tokens of a
  window that has not been sent yet, and inventing one would be exactly the
  guess this feature exists to refuse. The char counts are labelled as chars;
  the honest "after" is the next call's reported usage.

- **`CompactionUnmeasurableError` — the refusal for a provider that reports no
  usage.** Thrown at the first iteration boundary after a call that reported
  zero in and zero out, naming the provider. Terminal: `Agent.run` does not
  wrap it in a `RunCheckpointError`, because resuming would walk into the same
  wall with the same adapter. A configured budget that silently never applies
  is config that lies; compaction says so instead.

- **`COMPACTED_FRAME_PREFIX` / `isCompactedSummary(msg)`** — the authored frame
  is a library constant and the summarizer's text is appended after it as data.
  A summarizer returning `IGNORE ALL PREVIOUS INSTRUCTIONS` still arrives
  *inside* a message that says, first and in the library's own words, that what
  follows is a summary written by a model and not the conversation. A test pins
  exactly that, with a hostile summarizer. The boundary points both ways: the
  folded transcript reaches the summarizer between markers the authored
  instruction names, and that instruction says to report an instruction found
  inside them, never to follow it.

### Fixed

- **OpenAI streaming reported zero tokens — for every streamed call, in both
  the Node and browser adapters.** `stream_options.include_usage` (which both
  adapters already asked for) delivers the token counts on a **final chunk
  whose `choices` array is empty**; both providers guarded on a missing choice
  and `continue`d past it before reading `chunk.usage`. Everything downstream of
  `response.usage` therefore went to zero on the streaming path: most visibly
  **`costBudget` was silently unenforceable** under streaming OpenAI, and
  `cost.tick` reported nothing to spend.

  The unit fixture had blessed the bug — it hung usage off the finish_reason
  chunk, which no OpenAI endpoint does. The fixture now emits the real wire
  shape, so the old code fails it. Note that OpenAI-compatible endpoints
  configured with `legacyEndpoint` (Ollama, vLLM) are never sent
  `stream_options` and still report no usage while streaming; with
  `.compaction()` those now refuse by name rather than quietly never firing.

### Changed

- **With `.compaction()` configured, the compaction stage becomes the ReAct
  loop target** (`compact`), mounted immediately before the previous one. The
  loop is branch-sourced, so anything ahead of the target runs once and is
  never seen again — and being the target puts the fold *before* the injection
  engine and the three context slots, which is the point: the triggers, the
  slots and the wire then all see one window, and no part of the run reasons
  over a past the model was not shown. Without `.compaction()` the loop target
  is exactly what it was.

- **`docs/internals/README.md` is marked HISTORICAL.** It described a source
  tree that does not exist and two seams that never shipped — `MessageStrategy`
  (with `fullHistory` / `slidingWindow` / `charBudget` / `summaryStrategy`) and
  `PromptProvider`. Nothing exports them and nothing ever did. An advertised
  seam that does not exist is a documentation defect whether or not it is on
  the published site, so the file now says so at the top and points at what
  actually governs the window.

## [7.15.0] - 2026-08-02

7.14.0 shipped two hosting ports that name no cloud, plus a conformance suite,
and made a promise: *a cloud adapter is vendor paths and a header mapping on a
port that already worked; if writing one needs a change to a port, the port was
wrong.* A promise like that is worth nothing until somebody writes the adapter.

This release writes it. `agentCoreRuntimeHost` is a real cloud runtime's
container contract — different paths, different body fields, the conversation id
in a header instead of the body — and it **passes the same conformance suite as
`nodeHost`, over a real socket, with no change to any port type**. It is now the
third subject in that suite, so if a future adapter changes an answer, the file
goes red.

The rest of the car is the same shape: an AgentCore session store, an AgentCore
policy store behind the existing permission port, per-request credential vending
for Gateway tools, and the memory adapter's `search()` finally wired.

Three seams did have to move, and none of them was a port. They are listed under
"Changed" rather than buried, because *where an adapter needs more than paths
and headers* is the interesting result of an exercise like this — and two of the
three turned out not to be about this vendor at all.

### Added

- **`agentfootprint/hosting-providers` — `agentCoreRuntimeHost()` and
  `agentCoreSessions()`.** The AgentCore Runtime container contract as adapters
  on the 7.14.0 ports: `POST /invocations`, `GET /ping`, port 8080, `0.0.0.0`,
  `{ prompt }` in / `{ response, status }` out, and the conversation read from
  the `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header (matched
  case-insensitively — a proxy in front of the container is free to re-case it).

  `busy` is a function rather than a flag, because the runtime polls `/ping` to
  decide whether to send you more work: "am I busy" is a live fact about the
  process, not a setting.

  `agentCoreSessions({ store })` picks the checkpoint's home at construction and
  never per call. `'session-storage'` is a JSON file in the runtime's own
  storage — no AWS SDK at all, survives a container stop/resume, written
  then renamed so a kill mid-write leaves the previous conversation rather than
  rubble. `'memory'` is one AgentCore Memory event per persist, outliving the
  session entirely. Both refuse an unknown envelope `format` **by name** through
  the same `readEnvelope` the composer uses — that law is inherited, not copied.

  Its own subpath rather than `agentfootprint/hosting`, on purpose: a test greps
  the hosting sources for vendor names to keep "these ports name no cloud"
  literally true, and the barrel is a hosting source.

  Docs: [AgentCore adapters](https://footprintjs.github.io/agentfootprint/docs/build/infra/aws/agentcore-adapters) ·
  Example: `examples/deploy/agentcore-runtime.ts`.

- **`httpHost({ name, wire, invokePath, healthPath, port?, hostname?,
  capabilities? })` — the HTTP work, parameterised by the JSON dialect it
  speaks.** Draining on close, aborting when the caller hangs up, failing a
  handler that throws, failing a handler that answers nothing, mapping refusal
  codes to status codes, and choosing between one JSON body and Server-Sent
  Events — all of it happens once. An `HttpWire` re-decides five body shapes and
  nothing else: `readRequest`, `health`, `output`, `failure`, `chunk`.

  `invokePath` and `healthPath` are **required, with no defaults**. A default
  here would be inherited by every adapter ever built on this file.

  `jsonWire` (nodeHost's own dialect) and `headerValue(facts, name, ...alts)`
  are exported too — the latter so no adapter re-derives case-insensitive header
  matching and gets it subtly wrong in exactly one deployment.

- **`agentCorePolicy({ policyStoreId, region?, onUnavailable?, onWarning?,
  principalFor?, name?, cacheSize? })` — an AgentCore policy store behind the
  existing `PermissionChecker` port** (`agentfootprint/security`). Every
  attempted tool call becomes one evaluation.

  It **fails closed**: an engine you cannot reach has not said yes, so an
  evaluation that throws is a `deny`. So is a verdict the adapter does not
  recognise — an unfamiliar future value is not a permission. The denial reaches
  the model **as data** (`tellLLM`), so it re-decides with the refusal in front
  of it rather than the run dying; telemetry stays out of it, because a model
  should not be taught the shape of your rule space. Decisions are cached per
  (tool, principal, conversation, **iteration**), so a policy that changes
  mid-conversation lands on the next turn instead of after the run, and the
  cache is bounded.

  `onUnavailable: 'allow-with-warning'` exists for a gradual rollout and is
  deliberately awkward to type. It applies only to a failure to CHECK — an
  explicit denial is always a denial.

  It composes with `gatedTools` unchanged, and neither knows the other exists:
  the gate decides what the model is shown, the checker decides what runs. A
  test pins that. Note that only a local policy can double as a `gatedTools`
  predicate — that predicate is synchronous and a remote engine is not.

- **`gatewayTransport({ url, credentials, service?, scopes?, mode?, headers? })`
  — an MCP transport whose auth headers are vended per request**
  (`agentfootprint/tool-providers`). A third member of `McpTransport`; `stdio`
  and `http` are untouched.

  **The token is used once and dropped.** Not cached between requests, not
  stored on the transport object, not in an event, a log, or any error this
  module throws — including the errors thrown while it is holding one. A test
  asserts exactly that, with a hostile logger capturing every console channel,
  the serialized transport, and every thrown error. Static `headers` are applied
  first so a vended auth header always wins.

  When consent is needed it throws `GatewayAuthorizationRequiredError` carrying
  the authorization URL: a transport cannot run a consent flow mid-request, so
  it says so instead of hanging.

- **`AgentCoreStore.search()` — server-side semantic retrieval over
  `RetrieveMemoryRecords`.** `searchStrategyId` and the namespace reach
  AgentCore's side as filters; `k`, `minScore` and `tiers` are applied to what
  comes back. A `tiers` filter excludes everything, because records carry no
  tier and silently ignoring a filter you asked for is worse than returning
  nothing.

  Results are marked `metadata.source: 'agentcore-memory-record'`, because
  `search` reads a genuinely different population than `list`: the records
  AgentCore's extraction strategies *derived from* your events, whose ids belong
  to AgentCore, so `store.get(result.entry.id)` will not find them.

  There is **no `stream()`**. AgentCore Memory has no streaming data-plane
  operation and `MemoryStore` has no streaming method — inventing one for a
  single backend is how a port stops being a port.

### Changed

- **`nodeHost` is now a configuration of `httpHost`.** Same name, same options,
  same wire, same behaviour; the HTTP implementation is shared rather than
  duplicated, so two adapters can never quietly drift apart on what `close()`
  drains. This is the one seam this exercise found in the hosting layer, and it
  was in the FIRST ADAPTER, not the port: `nodeHost` had hard-coded its own JSON
  dialect, which was fine while it was the only HTTP adapter and wrong the
  moment there was a second. No public type changed.

- **`SearchOptions.text?: string` — one new optional field on the memory port.**
  `search()` takes a vector because the reference backends rank locally by
  cosine; several managed stores embed and rank server-side and their retrieval
  API takes text, so a vector is the one thing they cannot use.

  Stores that rank locally **ignore** it and their results are unchanged, so
  passing both is always safe. `AgentCoreStore.search()` requires it and throws
  a corrective error naming what is missing — not an empty array, which reads as
  "no matches" when it means "wrong query form", and nobody investigates a
  plausible empty result.

- **MCP headers were connection-lifetime only.** That is a real gap and it is
  not AgentCore's — any endpoint behind an expiring token hits it — so the fix
  landed on the generic transport layer and the vendor adapter for it is zero
  lines.

- **`examples/deploy/agentcore-runtime.ts` now USES the adapters** instead of
  carrying its own hand-written `node:http` handler. One source of truth for the
  contract. It still self-tests and exits, still serves forever under
  `AGENTCORE_SERVE=1`, and now also proves a two-turn conversation continuing
  through the session header alone.

### Verification, stated plainly

`agentCoreRuntimeHost` is plain HTTP with no AWS SDK on its path, so its
conformance-suite result is **real verification** of the wire.

Everything that talks to AWS — `agentCoreSessions({ store: 'memory' })`,
`agentCorePolicy`, `AgentCoreStore.search()` — is **contract-mapped and
injection-tested**: every SDK interaction is exercised through the adapters'
`_client` / `_sdk` seams, and no test in this repo reaches AWS or pretends to.
Confirm command and field names against your installed
`@aws-sdk/client-bedrock-agentcore`. Real-cloud verification lands with a field
deployment.

## [7.14.0] - 2026-08-02

An agent in a script answers once and forgets. A deployed one has to do two more
things — be reachable, and continue a conversation it started before the last
restart — and those two things are usually where a framework quietly becomes one
vendor's framework. The request shape arrives from whoever you deployed on, the
session store is theirs too, and by the time a second runtime matters the
"portable" agent has a container contract baked into its type signatures.

So this release adds the two things as **ports that name no cloud**, and proves
they are ports rather than asserting it: a conformance suite runs one handler
against the shipped HTTP adapter and against a second, minimal host written in
the test file, and compares the answers. Both adapters here are local. The
cloud ones come later and have to pass the same suite — that is the whole design,
and if writing one ever needs a change to a port, the port was wrong.

### Added

- **`agentfootprint/hosting` — `AgentHost` + `SessionLifecycle`, the two ports
  between an agent and the place it runs.** `HostRequest` carries an `input`, an
  optional `sessionId`, `headers` and a `signal`; `HostReply` has `complete`,
  `emit` and `fail`; `HostHandler` maps one to the other and `HostHandle` has
  one method. That is the entire surface, and it is the vocabulary every
  transport already has and nothing else.

  Capabilities are **feature-detected, never assumed**: `AgentHost.capabilities`
  is a list of `HostCapability`, today exactly one name — `'streaming'` —
  because that is what a shipped adapter can actually honour. No names were
  pre-minted for transports that do not exist yet; a capability nobody
  implements is a promise the library cannot keep, and inventing one in
  anticipation of a particular runtime would bake that runtime in before it
  arrived. `requireCapability(host, cap)` throws a corrective error naming the
  adapter you are actually holding.

  A handler emits freely and completes once. A host that streams delivers each
  piece as it arrives; a host that cannot buffers them and lets the
  authoritative `complete(output)` settle the buffer — the pieces were a preview
  of the same text, never an addition to it. **The handler cannot tell the
  difference and does not need to.**

  Docs: [Host it](https://footprintjs.github.io/agentfootprint/docs/build/infra/hosting) ·
  Example: `examples/deploy/standing-agent.ts`.

- **`nodeHost({ port?, hostname?, invokePath?, healthPath? })` — plain
  `node:http`, zero dependencies.** `POST /invoke` takes `{ input, sessionId? }`
  and answers `{ output }`; `GET /health` answers `{ status: 'ok' }`. Send
  `Accept: text/event-stream` and the same handler produces Server-Sent Events
  instead — the caller chooses, not the server.

  Both paths are options, and the defaults were chosen rather than inherited.
  `POST /invocations` is one cloud runtime's container contract and it very
  nearly became the default here by momentum; a default that silently matches
  one vendor is that vendor leaking into a library that promises not to know
  about it. A test greps the hosting sources for cloud vendor names **and for
  that path literal** — crude on purpose, because the failure it guards against
  is somebody in a hurry adding `region` to a port "just for now".

  `serve()` resolves to a `NodeHostHandle` reporting the `url` and `port` it
  actually bound, which is the only way to find out when you asked for port `0`.
  `close()` drains: in-flight work finishes, later arrivals get a
  `HostClosedError` (`503`).

- **`standingAgent({ agent, sessions, host, onConcurrentInvoke? })` — the
  composer.** Per request: wake and hydrate the session, resume that
  conversation or start a fresh one, persist what the run left behind, reply.
  Persist happens *before* the answer goes out, so a queued next turn can never
  read state older than the answer already given.

  It restates the `resumeOnError` tool re-execution caveat **verbatim** in its
  own docs. A composition that hides the caveat of the thing it composes is
  worse than no composition.

  **Runs are serialized globally, and that is a correctness requirement rather
  than a tuning choice.** An `Agent` holds per-run state on itself and this
  composer shares one instance across every session; two overlapping runs do not
  crash, which is exactly the danger — they both finish, and the state read
  afterwards belongs to whichever started last, so one session's envelope can end
  up holding another session's conversation with nothing in the recording to say
  so. `ConcurrentInvokePolicy` is the separate question of a second turn of the
  *same* conversation: `'reject'` (default) refuses with a `ConcurrentRunError`
  naming the active run (`409`), `'enqueue'` queues it FIFO behind the run whose
  state it will then read. A request for a **different** session is never
  refused — it waits its turn.

- **`CheckpointEnvelope` + `toEnvelope` / `readEnvelope` / `memorySessions()`.**
  What crosses a restart is `{ format: 'conversation-v1', data, savedAt }`, and
  an unknown `format` is **refused by name**: a store outlives the code that
  wrote to it, someone will deploy a newer runtime, and an older instance still
  running will meet its output. Restoring what it can and hoping means an agent
  answering from a conversation with pieces missing. Formats are added, never
  redefined.

  `SessionLifecycle` is `hydrate` + `persist` + an optional
  `onWake(sessionId, reason)`; `WakeReason` has one member, `'invoke'`, because
  that is the only thing in this release that can fire it.

- **`agent.checkpoint()` — the conversation the last completed run leaves
  behind**, as the same `AgentRunCheckpoint` that `resumeOnError` accepts. Read
  from the run's own recording, cloned on the way out, with the final assistant
  turn appended from the answer `run()` returned.

  That last clause is the load-bearing one. Nothing writes the final assistant
  turn back into the agent's history — the loop appends assistant turns only when
  they carry tool calls, and the turn that ends a run carries none. An agent that
  stored the conversation without it would drop its own reply **every turn** and
  answer the next one having forgotten what it just said: still fluent, still
  wrong, invisible until someone reads a transcript. It is pinned by a test that
  asserts on the provider's actual wire that turn 2's request contains turn 1's
  assistant reply verbatim, and deleting the append turns six tests red.

  Adds no events, no scope writes and no capture — recordings are byte-identical
  to an agent that never calls it.

### The judgements these rest on

**A pause is unfinished work, never a failed run.** If a run pauses to ask a
person something, `standingAgent` answers with a `PauseNotCarriedError` and
writes **nothing** — the session keeps exactly the conversation it had before the
request. Over HTTP that is a `409`, not a `500`, because the agent did not break
and every dashboard that sees a 500 will conclude otherwise. `'conversation-v1'`
stores a conversation; a paused run is a conversation *plus* an engine
checkpoint, and storing half of it would be worse than storing none. Carrying a
pause would be a NEW format name in the same envelope — which is precisely what
the version in the format is for.

**A failed run writes nothing either.** The session keeps its last good state
rather than inheriting the shape of whatever went wrong.

**A request with no `sessionId` is answered and not stored.** There is nothing to
hydrate and nowhere to persist it that the caller could ask for again. And
`sessionId` is documented as caller data, not identity: anyone who can reach the
host can send any string there, including someone else's.

**The conformance suite is the deliverable, not the tests for it.** One handler
constant, served by `nodeHost` and by a minimal in-process host that declares
*no* capabilities so the buffering path is exercised rather than assumed, with a
final pair of cases invoking both and comparing directly. A future adapter —
including a cloud one — is measured against that file.

## [7.13.0] - 2026-08-02

Three small things that were each one step short of usable. Skills could be
declared but only in TypeScript, so the prose a support lead should own lived in
a template literal three imports deep. MCP worked in one direction only: you
could consume anyone's tools and expose none of your own. And an agent was built
once with one model, so serving two tenants meant either rebuilding it per
request or mutating it — and a mutated agent makes its own trace wrong.

None of them needed a new mechanism. Each is a loader, an adapter pointed the
other way, and a value committed where run-level values already commit.

### Added

- **`skillsFromDir(dir)` — Skills authored as files.** A directory of `SKILL.md`
  files, frontmatter `name` + `description` as the disclosure stub, everything
  after the closing fence as the body. The same convention Claude Code made
  familiar, so a skill folder is portable between the two.

  It is a **loader, not a second mechanism**: each file goes to `defineSkill`, so
  the description is still all the model sees until it calls `read_skill(<id>)`,
  and the body still arrives only after it does. What changes is who can edit a
  playbook, and whether changing the refund policy shows up as a reviewable diff.

  A skill body is *instructions to a model*, so where it came from is a security
  property rather than a convenience — content fetched at run time is content
  someone else can change after you reviewed it. The loader therefore accepts a
  local directory and nothing else: a URL is **refused by name**, not fetched.
  Malformed frontmatter is refused naming **the file**, and two files claiming
  one skill name are refused naming **both** — a loader that says "malformed
  frontmatter" over forty files has told you nothing. A directory with no
  `SKILL.md` is an error too, not an empty array.

  Node-only, but `node:fs` is imported lazily inside the call, so importing
  `agentfootprint/injection-engine` in a browser bundle is still safe.

  Docs: [Skills](https://footprintjs.github.io/agentfootprint/docs/build/skills) ·
  Example: `examples/context-engineering/09-skills-from-dir.ts`.

- **`mcpServe(tools, opts)` — MCP, the other direction.** `mcpClient` pulls
  someone else's tools in; this pushes yours out, over stdio (default) or
  stateless Streamable HTTP. `close()` on the returned handle stops it, and is
  idempotent.

  The promise the feature rests on: **a served tool is the object you passed
  in.** `mcpServe` holds your `Tool` by reference and calls
  `tool.execute(args, ctx)` — it never copies the schema and re-implements the
  body, never unwraps a decorator, never reaches past a wrapper to an inner tool.
  So a permission check inside `execute` is still what runs when a remote client
  calls it (pinned by a test that serves a `PermissionPolicy`-guarded tool and
  watches the denial come back over the protocol). Serving is not a back door
  into your tool; it is the same door with a longer corridor.

  A hostile client is the tool's problem, never the server's: unknown tool names,
  `null`/numeric/array arguments and tools that throw all return `isError: true`
  and the loop answers the next call. Arguments are forwarded **verbatim** —
  re-validating them here would be a second, weaker copy of the contract the tool
  already enforces.

  Both transports are exercised for real in the test suite — a spawned child
  process for stdio, a bound socket for Streamable HTTP, and the MCP SDK's own
  `Client` on the other end — rather than only through an injected server. That
  is how the HTTP path's shape got settled: the SDK's stateless transport is
  single-use by design, so the listener mints a server and a transport per
  request. One shared pair initializes fine and then answers `500` to everything
  after it, which no amount of injected testing would have shown.

  Docs: [Serve your tools over MCP](https://footprintjs.github.io/agentfootprint/docs/build/mcp-serve) ·
  Example: `examples/context-engineering/10-mcp-serve.ts`.

- **`.configure((ctx) => ({ model?, instructions? }))` — per-run config that the
  trace can be trusted about.** Resolved ONCE per run at the start of the run,
  with the run's message, identity, runId and the agent's build-time `defaults`
  in hand.

  What it resolves is **committed**: `resolvedModel` and `resolvedInstructions`
  ride the same commit that already carries the run's other run-level facts
  (identity, iteration budget, turn number), landing in the commit log before the
  first LLM call — and the LLM call reads them from there, so what was called,
  what `stream.llm_start` reports and what cost is priced against are one value.
  A run that switched models without recording it would produce a recording that
  says the built-in model answered, which is a lie about the run's most expensive
  fact.

  Omit it and everything is byte-identical: no extra scope writes, no extra scope
  reads, same request bytes (pinned three ways). This is the RUN axis only —
  tools are the iteration axis and `.toolProvider()` already owns it.

  Docs: [Agent](https://footprintjs.github.io/agentfootprint/docs/build/agent) ·
  Example: `examples/features/36-per-run-config.ts`.

### Fixed

- **`McpClientOptions.signal` cancels a hung MCP tool call again — it never
  did.** The signal was being sent as part of the `tools/call` request
  *params*, where an `AbortSignal` JSON-serializes to `{}`: the server received
  a meaningless field and the caller received no cancellation. The SDK takes
  per-request options in a separate trailing argument, which is where the signal
  now goes; it is threaded to `connect()` and `listTools()` for the same reason,
  so the option covers the connect / list / call paths it always claimed to.

  This one is worth naming as a class rather than a typo. The mock the tests
  injected accepted the signal wherever it was put, so every test passed while
  the shipped behaviour was a silent no-op. It surfaced the moment a socket was
  on the other end.

### The judgements these rest on

**`mcpServe` refuses rather than degrades.** Two `Tool` capabilities cannot
survive a request/response protocol, and both fail at construction naming the
tool. `checkIn` asks a human to approve a call before it runs, and MCP has no
pause to carry that ask — serving it anyway would drop a consent gate silently,
which is worse than not serving at all. `needs` without a credential provider
would run the tool with `ctx.credential` undefined; passing `credentials`
resolves it before `execute`, fail-closed, exactly as the Agent does.

**`mcpServe` builds on the SDK's low-level `Server`, not `McpServer`.** Tools
already carry JSON Schema and MCP wants JSON Schema, so the mapping is the
identity function. `McpServer.registerTool` takes zod schemas, which would mean
adding a dependency to convert a JSON Schema into zod in order to convert it
straight back.

**`.configure()` writes only what the resolver actually returned.** Always
stamping `resolvedModel` would make every agent's commit log change shape, and
"absent option = byte-identical" has to mean the recording too, for a library
whose product is the recording. For the same reason, reading `scope.resolvedModel`
in the LLM stage is gated on a build-time flag rather than done unconditionally
with a fallback — an unconfigured run records the same reads it always did.

**`.configure()` is synchronous.** The seed stage where run-level facts commit is
synchronous, and making it async to accommodate a resolver would shift every
agent's timing for a feature most agents do not use. A resolver that needs I/O
can do it before `run()` and close over the result.

Every debugging session starts at a *variable* — "where did that instruction come
from?", "which loop wrote the history it answered from?" — and both halves of the
answer already existed, in vocabularies that did not meet. footprintjs 9.13 records
a variable's whole life in commit indices and runtimeStageIds; the localizer thinks
in loops, injected sources and counterfactuals. Translating between them was left to
whoever was debugging, and each of them did it differently.

Joining them turned out to buy something bigger than a nicer read-out. The backward
walk narrows each loop with embedding similarity — a proxy that points at a
neighbourhood and cannot separate a planted instruction from an innocent same-topic
sibling. But where the recording carries per-write provenance, one part of that guess
is unnecessary: the commit log *says* which write produced the value this loop read.
So the walk stops guessing exactly there — and keeps saying so everywhere else.

### Added

- **`traceVariable(artifacts, key)` — a variable's recorded life, in agent
  vocabulary.** One call over footprintjs's `keyTimeline` + `forwardSliceForKey`:
  every write and read in commit order, each labeled with the **loop** it happened
  in, each recognizable write labeled with the injected fact or tool result it
  introduced, and a `VariableAblationHook` per classifiable writer carrying the
  `AblationSpec` that would remove it. `joinVariableSlice(slice, trajectory, opts)`
  is the same join for a timeline you already hold.

  Pure assembly — no new capture, no scorer, no embedder, no LLM. Every field is a
  re-label of something the run already recorded, and footprintjs's honesty notes
  ride out verbatim rather than re-worded.

  Docs: [Variable recall](https://footprintjs.github.io/agentfootprint/docs/debug/variable-recall) ·
  Example: `examples/observability/21-variable-recall.ts`.

- **`walkToRoot({ variables })` — the hop the log can prove.** When a narrowed
  suspect rode in on a state key whose dataflow coverage is `'exact'`, the descent
  target is taken from that key's recorded ancestry instead of the proxy's
  provenance scrape, and the hop is stamped `narrowedBy: 'dataflow'`. Everything
  else stamps `'text-similarity'`. **Omit the option and the walk is unchanged** —
  same hops, same order, same verdicts (pinned by a deep-equal test).

  The proxy still picks WHO; dataflow picks WHERE. A stage-level edge never becomes
  an exact hop, and a recorded edge outranks the *inferred* proximate-tool hop —
  better evidence wins, and the hop record says which kind it used.

- **`AgentOptions.writeProvenance`** (`'off'` default, `'reads-prefix'` to enable) —
  the fourth executor dial, alongside `readTracking` and `commitValues`. On, every
  write also records the keys read before it, which is what upgrades a variable to
  `coverage: 'exact'`. Off, every recording is byte-identical to 7.11.

- **`variableToBacktrackTrace`** — a variable's life on the same `BacktrackTrace`
  board the localizer report uses (one card per write, custody hops for the rewind
  player). `mode` is always `'correlational'`: nothing here was ablated.

### The judgement this rests on

`coverage: 'exact'` requires **positive** evidence — at least one recorded per-write
edge — not merely the absence of a conservative one. A key nothing ever reads back
(the agent's `lastToolResult`: written by tool-calls, never read by `call-llm`) has
an empty edge set, so "no conservative edges" is *vacuously* true; scoring that as
exact would hand the walk its most confident hop on its least-evidenced key. Absence
of dataflow is `'unknown'`, never exactness.

The gate is also deliberately stricter than the hop strictly needs: the read→value
attribution the hop rests on is recorded independently of the write dial. Requiring
per-write fed-edge exactness on top is a conservative choice, so the deterministic
narrow ships behind the strongest available evidence — and a later release can relax
it with measurements instead of re-deriving why it was strict.

### Changed

- `RootCauseHop.narrowedBy` widens from the literal `'text-similarity'` to
  `HopNarrowedBy` (`'text-similarity' | 'dataflow'`). Additive: without `variables`
  every hop still stamps `'text-similarity'`.
- `ProximateToolSource` gains `stateKey` — the key its value was materialized from,
  so the walk joins on recorded data instead of a hard-coded string. Walk-only, as
  the rest of that record already was: L3's narrow and its measured recall are
  untouched (pinned).
- footprintjs peer dependency: `^9.13.0` (was `^9.10.1`) — `forwardSliceForKey` and
  `keyTimeline` are what this release consumes.

## [7.11.0] - 2026-08-02

A pipeline whose steps form a *shape* rather than a line — one step feeding two
independent lookups, a third waiting for both — had no home here. You could nest
a `Parallel` inside a `Sequence`, but then you were scheduling it by hand, and
the values did not survive the trip.

### Added

- **`graph()` — a fixed DAG of runners, with the concurrency worked out for
  you.** Declare `nodes` and `edges`; Kahn levelization at BUILD time groups the
  nodes that do not depend on each other, and every node in a level runs at the
  same time. The result is every node's output keyed by node id. Roots (nodes
  with no parents) receive the graph's own input, and an edge carries the
  producer's OUTPUT to the consumer unchanged — there is no shared mutable scope
  between nodes.

  A broken shape never runs. A cycle, an edge pointing at a node that was never
  declared, and a duplicate node id each throw at construction, naming the
  offender (`graph: cycle detected — edge 'c' -> 'a' closes a loop.`). So does a
  node with two or more parents and no `join`: a silent merge is a wrong merge,
  so `join` is REQUIRED at fan-in, and it receives `upstream` keyed by parent
  node id.

  A failed node is reported with its name and its real reason
  (`graph 'support': node 'billing' failed: upstream is down`) — one sentence
  regardless of which of the two internal mounts the level used.

  `graph()` is a `Runner` like everything else, so it nests: a graph can be a
  node in another graph or a step in a `workflow()`, and every node's events
  land under ONE run so the causal log composes.

  Docs: [Graph](https://footprintjs.github.io/agentfootprint/docs/build/graph) ·
  Example: `examples/core-flow/06-graph.ts`.

### The trap this was built around

The obvious design — `graph = Sequence(Parallel(level0), Parallel(level1), …)` —
does not work on this codebase, and the second half of that was **not** already
known. v7.10.0 shipped `workflow()` because `Sequence`'s step contract is
`{ message: string } -> string` and its step `outputMapper` coerces a structured
step output to `''`. Verifying `Parallel` the same way turned up the identical
limit one layer down: its branch type is literally
`Runner<{ message: string }, string>`, and its branch `outputMapper` coerces a
non-string branch output to `''`. A `Parallel` level cannot carry a structured
value either. So `graph()` is built on the pass-through model `workflow()`
established — its own composition, its own mappers, the same recorder wiring and
the same `composition.enter` / `exit` events — rather than on top of
`Sequence`/`Parallel`.

Two further engine behaviours were verified rather than assumed, and are pinned
in tests:

- Values merged into parent state by a subflow's `outputMapper` are present in
  shared state but do **not** read back through TypedScope's nested property
  proxy — `scope.results` returns `{}` while `scope.$getValue('results')`
  returns the real record. `graph()` reads through `$getValue`. (`Parallel`
  never met this because it coerces every branch output to a string.)
- A level with ONE node is mounted sequentially rather than as a fork of one.
  Resuming into a fork child completes that child and stops, whereas a
  sequential mount resumes and carries on — so a pausing node that is alone in
  its level resumes through the rest of the graph. A pause inside a genuinely
  concurrent level still resumes only that node; that limit is documented and
  pinned rather than papered over.

### Note

`graph()` reports itself as composition kind `'Sequence'` — a graph's levels ARE
a sequence, and `CompositionKind` stays a closed union so consumers' exhaustive
switches keep compiling. Same reasoning as `workflow()` in 7.10.0.

## [7.10.0] - 2026-08-02

Two routing-shaped gaps closed. Both were things the docs told you to hand-roll,
and both were fiddly in the same way: the wiring is easy to get *nearly* right,
and nearly right fails quietly — at run time, several steps away from the
mistake.

### Added

- **`llmRouter` — the classic Swarm decision, packaged.** `swarm()` asks for a
  `route()` that is sync and pure, and it means it: the `Conditional` evaluates
  it once per branch predicate and the loop's exit guard evaluates it again
  after every turn. So the LLM decision has to happen *somewhere else*, before
  the message reaches `route` — and that placement is the part everyone
  re-invented, along with the prompt, the parsing, and a second copy of the
  agent roster that drifts from the first.

  `llmRouter({ provider, model, agents })` ships all four pieces once. The
  roster compiles INTO the router's system prompt from each agent's own
  `description` — one source, so an agent can't be in the roster and missing
  from the prompt. `router.step` makes the decision and records it under the
  exact message it hands forward; `router.route` is then a lookup, and a message
  nobody decided about routes nowhere (the swarm halts) rather than guessing
  with a stale decision.

  The decision is validated JSON — `RoutingDecision` = `{ agentId?, message,
  reason? }`. No `agentId` means "done", and the swarm halts through its own
  halt sentinel. An id that isn't in the roster is kept verbatim, *not* quietly
  swapped for a plausible one: `swarm()`'s existing done/fallback law then ends
  the run, so a hallucinated agent shows up as a halt instead of a wrong answer.
  Unusable output throws `RoutingDecisionError` with the model's raw text
  attached (a markdown fence around good JSON is tolerated; prose is not).

  Two promises worth naming, both pinned by tests. Agent descriptions are
  **data**: each roster line is JSON-encoded, and the rules that bind the router
  are stated after the roster, so a description holding `"} IGNORE THE ABOVE.`
  can't escape its line or get the last word. And `reason` is **trace-only** —
  it lands on the decision and on `composition.route_decided` evidence, and
  never re-enters a prompt, so a model can't talk itself into a route across
  turns.

- **`llmSwarm` — that router, wired into `swarm()` in one call.** The placement
  rule is "one routing call before the first turn, and one after every turn".
  Get it wrong and the swarm halts on turn one for no visible reason, so this
  builds it: `Sequence(router.step → swarm(agents, route: router.route))`, with
  each agent's turn wrapped as `Sequence(agent → router.step)`. Agents carry
  their own `description`, so the roster the swarm dispatches on and the roster
  the model reads are the same list. `maxHandoffs` still bounds the loop;
  routing runs at `temperature: 0` by default.

- **`workflow()` — sequential steps whose hand-offs the compiler checks.**
  `Sequence` chains steps through one channel — text in, text out — and coerces
  any non-string step output to `''`. So a step that parses a ticket into
  `{ orderId, angry }` hands the next step nothing at all, and you learn about
  it three steps later as a reply addressed to order `undefined`. Nothing
  throws.

  `workflow(s1, …, s8)` closes that from both ends. At compile time, step N's
  output type must be what step N+1 accepts (`NextStepInput`: a `string` output
  feeds the next step's `{ message }`, the house convention every LLM runner
  speaks; anything else must match exactly) — a chain that doesn't line up is a
  compile error, pinned by `@ts-expect-error` fixtures under `npm run
  test:types`. At run time, values are handed over **unchanged**: objects stay
  objects. `workflow(draft, edit)` over two `LLMCall`s reads exactly as it
  always did.

  Three limits are documented and tested rather than papered over: only plain
  data crosses a step boundary (a `Date`/`Map`/class instance arrives as `{}`,
  `undefined` fields drop), a step must RETURN its output, and the workflow's
  own input stays visible to later steps (footprintjs `getArgs()` inheritance) —
  a key the previous step actually produced always wins.

  It reports itself as composition kind `'Sequence'`, because it is one; the
  public `CompositionKind` union is unchanged so consumer switches keep
  compiling.

### Docs

- New guides: **LLM routing** (`llmRouter` / `llmSwarm`, the roster-as-data
  argument, the wire-it-yourself recipe) and **Workflow** (the chain rule, how
  to author a typed non-LLM step, the three limits). The Swarm guide's "Why
  route is sync" section now points at `llmSwarm` instead of telling you to
  build it yourself.
- New runnable examples: `examples/patterns/07-llm-swarm.ts` and
  `examples/core-flow/05-workflow.ts`.

## [7.9.0] - 2026-07-29

### ⚠️ Behaviour change — `openaiEmbedder({ dimensions })` now actually shortens the vectors

**If you pass `dimensions` today, your vectors change length.** They were the
model's native length all along; now they are the length you asked for. Anything
you have already embedded and stored was written at the *old* length, so a store
built with `openaiEmbedder({ dimensions: 256 })` on 7.8 holds 1536-long vectors
and will not match new 256-long queries. **Re-embed, or drop `dimensions` to
keep the old lengths.**

Why: `src/embedders/index.ts` read the option, reported it as `.dimensions`, and
then built the request body as `{ model, input }` — the parameter was never
sent. Asking for 256 returned 1536 numbers from an embedder claiming 256, so any
vector store trusting `.dimensions` was corrupted silently and consistently.

Also changed, in the same spirit of "`.dimensions` must not lie":

- `.dimensions` now reports each known model's **documented native size** when
  you pass nothing — 1536 for `text-embedding-3-small` and
  `text-embedding-ada-002`, 3072 for `text-embedding-3-large`. It used to report
  1536 for everything, so `text-embedding-3-large` under-reported by half.
- An **unknown model with no `dimensions` is now a construction-time error**
  instead of a silent 1536. This is the breaking edge: `openaiEmbedder({
  baseURL, model: 'nomic-embed-text' })` against a gateway, an Ollama server or
  an Azure deployment name now throws until you state the length. That
  population is exactly the one that was being lied to. One option fixes it:
  `{ dimensions: 768 }`.
- `dimensions` is sent **only when you explicitly pass it**. It is ["Only
  supported in `text-embedding-3` and later
  models"](https://developers.openai.com/api/docs/api-reference/embeddings/create),
  so sending a default would have broken every `text-embedding-ada-002` caller
  who asked for nothing. With the option unset the request body is byte-identical
  to 7.8.

### Added

- **`localEmbedder({ backend })` / `staticEmbedder({ backend })` — pass an
  already-imported module, and the on-device embedders work in a browser.** To
  keep the heavy peer deps optional, both factories import them through a
  *variable* specifier — which no bundler can see through. The bare name
  survived a production build and reached the browser unresolved:
  `TypeError: Failed to resolve module specifier '@huggingface/transformers'`.
  The capability was there all along; only the packaging blocked it. Now the
  host can do the static import its own bundler resolves and hand the module in:

  ```ts
  import * as transformers from '@huggingface/transformers';
  const embedder = localEmbedder({ backend: transformers });
  ```

  Verified in a real production bundle with no import map: 384-dimension
  vectors, L2 norm 1.0, near-text cosine 0.55 vs far-text −0.03. Same shape as
  the `client` option on the store adapters — the library states the surface it
  needs (`TransformersBackend`, `Model2VecBackend`, both exported), the host
  owns the construction. The string-specifier path is unchanged, and both peers
  stay optional. (`@yarflam/potion-base-8m` itself reads its weights from disk
  with `fs`/`__dirname`, so `staticEmbedder` remains Node-only in practice; the
  option is there for a browser-capable Model2Vec build.)

- **`agentfootprint/embedders` exports the `Embedder` type it returns.** The
  subpath declared it locally and never re-exported it, so naming the return
  type of its own factories meant importing from `agentfootprint/memory`
  (`TS2459: declares 'Embedder' locally, but it is not exported`).

- **An embedders guide.** [docs-next/content/docs/build/embedders.mdx](docs-next/content/docs/build/embedders.mdx)
  — the module had zero documentation coverage and had never been used by
  anyone, which is why all three defects survived. Covers what each embedder
  needs, which ones run in a browser, and what they cost: `localEmbedder`'s
  first browser call pulls ~27 MiB over the wire (~45 MiB decompressed) from
  **two** third-party origins — `huggingface.co` for the model and
  `cdn.jsdelivr.net` for the ONNX Runtime WebAssembly binary, which nothing
  previously mentioned — and `@yarflam/potion-base-8m` puts ~30 MB of weights on
  disk at install.

- **Docs-truth check — an ongoing, honest answer to "do the docs describe what
  the code actually does?"** `npm run docs:truth` (new CI job `docs-truth`)
  answers three *separate* questions for every capability the package exposes,
  because their combinations are different bugs: DECLARED (in the published
  surface), DOCUMENTED (described in prose on the site), EXERCISED (a real run
  produces it). Declared/documented/never-exercised is the shape a dead or
  unimplemented feature has — exactly the state the resilience events sat in
  for months. Declared/exercised/undocumented is the classic doc gap.
  Documented-but-not-declared is the worst case for a reader, and has zero
  tolerance.
  - The DECLARED column is built from the real export map (`package.json`
    `"exports"` → shipped `.d.ts`, enumerated with the TypeScript checker), not
    from TypeDoc: TypeDoc runs from the single `src/index.ts` entry point and
    therefore cannot see a single `agentfootprint/<subpath>` symbol. The
    surface is reported per subpath, since root-barrel-vs-subpath is itself a
    known source of user confusion. Events come from `ALL_EVENT_TYPES`.
  - The DOCUMENTED column counts *only* prose on the 63 hand-written pages
    under `docs-next/content/docs`. Both TypeDoc trees
    (`docs-next/content/docs/api/`, `docs/api-reference/`) are excluded — they
    are generated from source, so every symbol appears in them by construction
    and counting either would mark 234 undocumented symbols "documented" and
    report a clean bill of health that means nothing. Code-sample-only and
    written-in-the-repo-but-not-published are reported as their own states
    rather than silently counted either way.
  - The EXERCISED column comes from real credential-free runs:
    `npm run docs:truth:exercise` runs all 95 `examples/` scripts (95/95 green)
    with credential-shaped env vars stripped by name, and taps the event bus
    with the listener gates forced open. Anything it cannot observe is UNKNOWN,
    never "absent".
  - **Ratchet, not gate.** Pre-existing gaps are recorded in
    `docs/docs-truth/baseline.json` and pass; CI fails only when the gap grows.
    `npm run docs:truth:baseline` re-records and regenerates the report, so new
    debt lands as a reviewable diff. The docs-promise-nothing class is never
    baselined.
  - Human-readable findings: [docs/DOCS_TRUTH_REPORT.md](docs/DOCS_TRUTH_REPORT.md).

### Fixed

- **Three broken imports in the published docs.**
  `docs-next/content/docs/reference/strategy-everywhere.mdx` told readers to
  import `composeObservability` / `consoleObservability` from
  `agentfootprint/observability-providers` and `ObservabilityStrategy` from the
  root barrel; all three are exported from `agentfootprint/strategies`, so
  every copy-paste failed. They lived in plain `typescript`-tagged fences,
  which the docs build's twoslash gate does not compile — only 7 of the 183
  TS/JS blocks on the site are twoslash-marked, and 137 package imports sit in
  blocks the compiler never sees. Found by the new docs-truth check.

### Known issues (surfaced, deliberately not changed)

- **Two events are emitted but absent from the typed registry.**
  `src/core/outputFallback.ts:169` and `:203` emit
  `agentfootprint.resilience.output_fallback_triggered` and
  `agentfootprint.resilience.output_canned_used` through a loosely typed
  `emit: (eventType: string, …)` parameter, bypassing the typed registry. There
  is no `resilience` domain in `EVENT_NAMES`, no payload interface, no
  `ALL_EVENT_TYPES` entry and no `agentfootprint.resilience.*` wildcard — so
  `runner.on(...)` cannot accept either name, even though
  `docs-next/content/docs/monitor/reliability.mdx` calls them "two typed events
  for observability". Registering them changes the public event contract and
  the pinned event count, so it is left as an owner decision; the docs-truth
  check ratchets the class so no new one can appear unnoticed.
- **Nine import paths named in prose do not exist in the export map** — see
  section 8 of the report. Notably `docs/…/dependency-graph.mdx` documents
  `agentfootprint/providers`, `agentfootprint/memory-redis` and
  `agentfootprint/memory-agentcore` as legacy aliases "still exported in v3.x",
  but `package.json` `"exports"` has no such keys, so they do not resolve.

## [7.8.0] - 2026-07-28

### Added

- **`recordRun(runner)` — save a run so a viewer can show it later.** A
  recording is exactly three things: `events` (the typed stream, in order),
  `snapshot` (the footprintjs run snapshot — state, commit log, every
  attached recorder's data) and `structure` (the build-time chart). Each
  lights a different surface and a missing one darkens exactly that surface.
  Nothing in the stack produced that bundle. It was DEFINED five times —
  footprintjs's `RuntimeSnapshot` (no structure, no events), our `Trace` (no
  snapshot), `ChatTurn.artifacts` (no structure), `ContextBugArtifacts` (no
  structure), and lens's `Recording` (complete, and produced by nothing) — so
  every integration assembled it by hand and each one omitted a different
  field. Most often `structure`, because a finished run does not leave it
  behind: it lives on the chart, and `getSnapshot()` deliberately never
  carries it. `recordRun` is the producer, and it emits exactly the shape
  lens's `observeRecording()` consumes:
  `fs.writeFileSync('run.json', JSON.stringify(recordRun(agent).toRecording()))`
  after the run. It also wires the boundary recorder's three connections,
  which is the part hand-rolling gets wrong — `attach` (no boundaries at all),
  `subscribe` (boundaries with nothing in them) and `getCommitCount` (every
  boundary stamped at commit 0, silently). None of the three can be
  reconstructed from a completed run, so it must be called BEFORE `run()`.
  It attaches no other recorders: `narrative()` and `metrics()` stay the
  consumer's choice, and each viewer says on screen when their data isn't
  there. Options: `maxEvents` (default 10,000, with `droppedEvents` counting
  what a long-running server shed) and `boundaryDetail: 'lean'`. Exported
  from `agentfootprint/observe`.
- **`runner.getCommitCount()`** — the run's time axis, forwarded from
  footprintjs's executor. Two JSDoc blocks (`runner.ts`, `RunnerBase.ts`)
  had described this accessor as if it existed since the observability
  work landed; `grep` found it implemented nowhere. It is real now: `0`
  before the first run, one commit per executed stage, cumulative across
  `resume()` on the same executor. Sample it live — a closure over the
  runner, never a captured number. `Runner` also now declares
  `getLastSnapshot()`, which `RunnerBase` has always implemented and the
  interface never mentioned; both are on the interface so a consumer
  holding a `Runner` can record a run without casting.
- **`Trace.snapshot`** — a Trace can now carry the run's footprintjs
  snapshot, via `enable.localObservability({ includeSnapshot: true })` or
  `serializeTrace(events, { snapshot })`. A Trace was the only documented
  recording format in the ecosystem and it structurally could not feed the
  full viewers: the commit axis, ExplainableShell's memory and provenance
  panels, and WhereFrom all read the commit log, which is a footprintjs
  artifact and appears nowhere in the event log. It is OPT-IN, and that is a
  redaction decision rather than a size one: `redact` runs per domain event
  and cannot reach inside a snapshot, whose `sharedState` is the run's raw
  working memory — filling the field automatically would have widened what
  a carefully redacted Trace exports without one call site changing. Redact
  that half at run time with footprintjs's `setRedactionPolicy()`. For a
  viewer, prefer `recordRun()`.
- **`ContextBugArtifacts.structure`** — the localizer's evidence bag calls
  itself "the frozen evidence of one completed run" and could not draw the
  run it described. The field is unread by the localizer (which works
  entirely off the commit log); it is there so the same literal that
  localizes a bad answer is also a complete recording. `recordedChat` now
  fills it on every turn, captured from the per-turn agent at record time —
  that agent is discarded immediately after, and nothing can reproduce a
  chart from a finished run. `ChatTurn.artifacts` gains the same field.
- **`boundaryRecorder({ snapshot: 'lean' })` — ship the shape of a run
  without shipping its content.** `toSnapshot()` is the copy that leaves the
  process: it lands in `runtimeSnapshot.recorders` and gets written to disk,
  posted to a viewer, or kept as a run artifact. It has always carried every
  field of every `DomainEvent`, and the captured content — entry and exit
  payloads, tool arguments and results, assistant text, injected-content
  previews — is most of its bytes. Sized on the demo turn this was built
  for — four ReAct iterations, four LLM calls, three tool calls, 25 subflow
  boundaries, run end to end against a mock provider with the recorder
  attached — the bundle `toSnapshot()` handed back measured 69.7 KB raw /
  4.6 KB gzipped and its lean projection 21.7 KB / 1.9 KB: content was 69% of
  the raw bytes and 59% after gzip, a 3.2x cut raw and 2.5x gzipped. That is
  one run measured twice, not two runs compared. Two things bound how far it
  generalizes, both in the conservative direction: the content on that run
  was the entry and exit payloads, because only the recorder's boundary side
  was attached (`agent.attach`) and not the typed-event side
  (`subscribe(dispatcher)`) whose events carry assistant text and tool
  results; and a live provider's longer replies ride inside those payloads,
  so a real-traffic turn has a larger content share, not a smaller one.
  The consumer that rebuilds a commit-range index offline reads five fields
  per event (`type`, `runtimeStageId`, `commitIdxBefore`, `subflowPath`,
  `depth`) and none of the content. `snapshot: 'lean'` drops exactly the five
  content-carrying fields — `payload`, `args`, `result`, `content`,
  `contentSummary` — and keeps every field that says where, when and of what
  kind each boundary was, so the index rebuilds range for range from the lean
  bundle alone. The point is not only bytes: a stored artifact stops being a
  second, redaction-bypassing copy of everything the agent read and wrote,
  the same reasoning `BoundaryRangeLabel` already applies to the live range
  index. Two short capture-time annotations do survive by design —
  `rationale` on `decision.branch` and `reason` on `context.injected` — so
  read lean as "no captured payloads", not "no free text at all": a decider
  whose rationale interpolates run values still puts that text in a lean
  artifact. Join back on `runtimeStageId` against the run's own snapshot when
  you want the content. The new `LeanDomainEvent` type (exported from
  `agentfootprint/observe`) names the shape.
  The suite measures a different, larger number, and it is not the one to
  quote: it replays a captured turn, and the capture kept each subflow's
  final state only, so the replay serializes that state twice per boundary —
  once as the entry it has no seed for, once as the exit. That doubling is
  87% of its 276 KB full bundle, which is why the size test asserts a loose,
  fixture-relative bound rather than a headline ratio.
- **`'full'` stays the default, deliberately.** This bundle has carried
  content since it shipped in 2.x, and `buildStepGraphFromEvents()` — the
  offline path behind `<Replay>` — restores its `entryPayload`,
  `exitPayload`, `contentSummary`, `assistantText`, `toolArgs` and
  `toolResult` from this bundle and nowhere else. A lean default would have
  quietly emptied every existing replay of an already-stored run, with no
  error to notice. Nothing changes unless you ask for `'lean'`. The live
  stream is unaffected in both modes — `getEvents()`, `buildStepGraph()` and
  `aggregateForBoundary()` still see full events; only the snapshot
  projection differs. The bundle's `description` records which mode produced
  it, so a stored artifact stays self-describing.
- **`agentfootprint.fallback.triggered`, `agentfootprint.error.retried` and
  `agentfootprint.error.recovered` now actually fire — you can finally ask
  which provider served this call.** All three were fully declared (registry,
  payload types, `ALL_EVENT_TYPES`, domain wildcards) and emitted by nothing:
  a repo-wide grep found zero emitters. They were legal to subscribe to, typed
  end to end, and permanently silent. The reason is structural rather than an
  oversight — `LLMProvider` is a deliberately minimal port (`{ name, complete,
stream? }`) with no emit channel, and the resilience decorators are
  constructed by you _before any run exists_, so a decorator can never reach a
  scope. Routing them through a consumer callback would not have been
  equivalent: an event pushed back in via `runner.emit()` lands with
  synthesized meta (`runtimeStageId: 'consumer-emit#0'`, `runId:
'consumer-scope'`, `runOffsetMs: 0`) and correlates with nothing else in the
  run, which is the entire value of having it. The seam is an optional
  per-call second argument, **`hooks?: LLMCallHooks`**, on `complete()` and
  `stream()` — the channel rides the CALL, not the factory. A decorator
  reports plain data (**`ResilienceReport`**, a three-arm union: `'fell-back'`
  | `'retried'` | `'recovered'`) and knows nothing about runs, scopes or
  events; the in-run LLM call sites translate each report into the
  already-declared typed event from INSIDE the traversal, so it carries the
  real `runId` and `runtimeStageId` footprintjs stamped before the stage ran
  and sits on the same timeline as the tool calls around it. Every payload
  field is filled from a report field of the same name — nothing is
  synthesized. Not a field on `LLMResponse`, because an exhausted retry
  _throws_: there would be no response to carry it. One producer per fact —
  `fell-back` ← `withFallback`, `retried` / `recovered` ← `withRetry`, nothing
  ← `withCircuitBreaker` — so a stack of three decorators produces one
  concatenated stream and de-duplication is structurally unnecessary rather
  than policed. `Agent`, `LLMCall` and `Parallel` attach the new
  **`resilienceRecorder()`** bridge for you, so
  `agent.on('agentfootprint.error.*', …)` works with no setup; a bare
  `FlowChartExecutor` running the exported message-api charts must attach it
  (or any `onEmit` recorder) itself, because these events travel footprintjs's
  emit channel and reach recorders only — never the commit log. Non-breaking:
  TypeScript lets an arity-1 `complete(req)` satisfy the widened signature, so
  every shipped adapter and every consumer test double still assigns unchanged (pinned by
  `test/type-regressions/LLMCallHooks.assignability.test.ts`), and outside a
  run nothing passes hooks so every report site short-circuits and standalone
  decorator behaviour is byte-identical. No new event type was added; the
  67-event count guard is untouched. `LLMCallHooks` and `ResilienceReport` are
  exported from `agentfootprint/llm-providers`, `resilienceRecorder` from
  `agentfootprint/observe`. The honest limits are stated on the [resilience
  page](https://footprintjs.github.io/agentfootprint/docs/monitor/resilience)
  rather than papered over — chiefly that `error.retried.reason` classifies
  the ERROR and not the retry predicate's reasoning (a bare boolean cannot
  expose that), that `withCircuitBreaker` has no event of its own and a trip
  is visible only as the enclosing fallback's `reason`, that a
  fallback-sourced recovery is not expressible in `ErrorRecoveredPayload` so
  `withFallback` never claims `recovered`, and that the LLM-backed memory
  extractors call `complete()` from a port with no scope and stay a blind
  spot. Runnable proof:
  `examples/features/35-resilience-visibility.ts` — four scenes, offline, no
  API key, exits non-zero if any claim stops holding. **If you write your own
  provider wrapper, forward the second argument.** `complete(req, hooks?)` is
  optional in its second parameter and TypeScript never rejects an
  implementation for declaring fewer parameters than its signature, so a
  wrapper that calls `inner.complete(req)` type-checks, runs, passes its
  tests — and silently swallows every report from anything beneath it. Every
  wrapper this library ships forwards.

### Changed

- **The boundary snapshot bundle says which mode produced it, in a field
  code can read.** `toSnapshot()` now returns `meta: { mode: 'full' |
'lean' }`. Full and lean were distinguishable only by the prose in
  `description`, and string-matching a sentence is not a thing offline
  readers do — they render the empty detail panel instead, because
  `buildStepGraphFromEvents()` restores step content from this bundle and
  nowhere else. With `meta.mode` a consumer can SAY "this recording carries
  structure only". The field reaches `getSnapshot().recorders[i].meta` on
  footprintjs 9.12+, which added the pass-through; on older engines the row
  is rebuilt without it and the field is dropped in transit. It is always on
  the value `toSnapshot()` itself returns.
- **`boundaryRecorder().subscribe()` accepts a runner.** It took an
  `EventDispatcher` — which a `Runner` does not hand out — so wiring the
  recorder's typed half from a public runner meant reaching for internals.
  It now takes anything offering a wildcard subscription (`TypedEventSource`),
  which both a `Runner` and the internal dispatcher satisfy:
  `boundary.subscribe(agent)`. Existing `subscribe(dispatcher)` calls are
  unaffected.
- **The "wire it at RECORD time" requirement now lives in the library that
  owns the recorder.** That a `BoundaryRecorder` must be attached AND
  subscribed AND given a commit count, all before the run, was documented
  only in agentfootprint-lens's README and in `observeRecording`'s JSDoc —
  in the consumer, where someone writing the recording side has no reason to
  look. It is on `BoundaryRecorder` itself now, with each of the three
  connections and how each one fails, and `getCommitCount`'s own JSDoc
  states the consequence of omitting it (a recording whose step strip cannot
  be rebuilt) instead of describing it as a legacy mode.
- **Docs: "Offline replay" is now "Replay a saved run", written around the
  path that works.** It was the ecosystem's only replay page and it taught
  the weakest route — capture a `Trace`, render `<Replay>` — leaving readers
  with an artifact that has no snapshot and a viewer that draws a static
  shape. It now leads with the three fields and `recordRun()`, shows both
  destinations (`observeRecording` → `<Lens>`, and `ExplainableShell` with
  its snapshot / graph / overlay props), states the by-hand wiring
  requirement with a table of how each missing connection fails, and keeps
  `<Replay trace>` as what it is: the chart-only subset. Plus
  `examples/observability/20-record-and-render.ts`, which runs a two-step
  pipeline, writes the recording to disk, reads it back, and checks the file
  against what each viewer reads — failing if a core surface would go dark,
  so the path is CI-verified rather than prose.
- **`toSnapshot()` now returns `data: DomainEvent[] | LeanDomainEvent[]`**
  (it used to infer `DomainEvent[]`). The union is the honest type — the
  method really does return one or the other, decided by the option you
  passed — but it is a compile-time break for TypeScript callers that read a
  content field straight off snapshot data: narrowing an element to
  `'run.entry'` and then reading `.payload` no longer type-checks, because
  the lean member of the union has no such field. Narrow on the mode you
  configured, or cast when you know you configured `'full'`
  (`toSnapshot().data as DomainEvent[]`). Nothing changes at runtime: the
  default is still `'full'`, and a full bundle still carries every field it
  carried before.

### Fixed

- **The eight adapter wrappers dropped the `hooks` argument, so anything
  decorated underneath one would have gone dark.** `OpenAIProvider`,
  `AnthropicProvider`, `BedrockProvider`, `BrowserOpenAIProvider`,
  `BrowserAnthropicProvider` and `BrowserAzureOpenAIProvider` (plus the two
  `azure` / `browser-azure` factories) each declared `complete(req)` and called
  `this.inner.complete(req)`. Nothing was lost in practice — each of them wraps
  a leaf vendor provider that reports nothing — but the SHAPE was the trap, and
  it is the one failure in this design that produces no compile error, no
  runtime error and no failing test: `hooks` is optional, and TypeScript never
  rejects an implementation for declaring fewer parameters than its signature.
  All eight forward now, so every wrapper the library ships is transparent and
  the trap can only be introduced by a consumer-authored wrapper. Documented at
  the seam (`LLMCallHooks`'s JSDoc) and in the resilience guide's honest limits,
  since it cannot be enforced by types.
- **A false observability claim inside the honest-absence ledger: the
  message-api charts' resilience emits do NOT "reach the commit log always".**
  Both `buildAgentMessageApiChart`'s call-site comment and MENTAL_MODEL §14
  item 6 said they did. They cannot: footprintjs's `ScopeFacade.emitEvent`
  dispatches only to recorders' `onEmit`, never touches the stage's transaction
  buffer, and fast-returns outright when zero recorders are attached — so an
  emit can never become a `CommitBundle`. The truth is worse than the wrong
  version admitted: on a bare `FlowChartExecutor` with no `onEmit` recorder the
  report is **discarded entirely**, not stored somewhere quieter. Verified end
  to end — a real fallback on a bare executor left no trace in the run return,
  the 14-bundle commit log, `sharedState`, the execution tree or the recorder
  snapshot, while the same chart with one `onEmit` recorder surfaced it
  immediately with a real `runtimeStageId`. Corrected in both places and in the
  resilience guide, and both arms are now pinned by tests rather than prose.
- **Two dead-code claims corrected.** `buildReliabilityGateChart`'s header said
  the chart "is mounted as a subflow in the agent's chart at `Agent.build()`
  time"; `buildAgentChart`'s header said the same mount "lands in the next
  commit". Neither happened: the builder is exported from no barrel and its only
  consumer in the repository is its own test, `.reliability()` is implemented
  inline in the CallLLM stage by `executeWithReliability`, and the
  `TranslateFailFast` stage both headers reference was never written. Comments
  only; no behaviour change. The file is kept rather than deleted because it is
  the only implementation that honours the `providers` failover list.
- **Every run recorded through `enable.flowchart()` or
  `enable.localObservability()` had a flat commit axis — silently.**
  `attachFlowchart` built its `BoundaryRecorder` with no options, so
  `getCommitCount` was undefined and every boundary event in every such run
  was stamped `commitIdxBefore: 0`. Both blessed observability entry points
  go through it, so this was the default for the ecosystem. Nothing errored
  and the events looked complete; what broke was one step removed — the
  boundary range index stayed empty (deliberately: zero-width `[0, 0]`
  ranges would read as real), and an offline consumer rebuilding the step
  strip from the recording found no positions to place, so the strip stayed
  quiet on a run that had plenty to show. Unrecoverable downstream, too: the
  commit log records what each stage WROTE, never when a boundary was
  CROSSED, so nothing can derive the axis after the fact. The runner now
  passes `() => this.getCommitCount()` through to the recorder. Recordings
  made before this carry zeros and cannot be repaired — re-record them.
- **`localObservability`'s header told you to pass its handle to `<Lens>`.**
  "pass the handle to `<Lens recorder={handle} />`" — a
  `LocalObservabilityHandle` is a `FlowchartHandle` plus `getTrace()`, and
  Lens wants a `LensRecorder`: `selectRunTree`, `selectEventLog`,
  `selectSummary`, `liveState`, `runtime`, `boundary.boundaryIndex`. It has
  none of them. The header now shows the path that works — record the run,
  hand the recording to lens's `observeRecording()`, pass THAT to `<Lens>` —
  and says plainly that this handle is not a Lens recorder.
- **`Trace`'s docs claimed `<Replay>` overlays the events.** "`<Replay>`
  rebuilds the flowchart from this and overlays `events`, so an offline
  replay matches the live `<Lens>` exactly" appeared in `trace.ts` and again
  in the offline-replay page. `Replay.tsx` never reads `trace.events`; it
  renders the chart's shape, and its own JSDoc calls time-travel "a planned
  refinement". A consumer following the official doc got an artifact with no
  snapshot and a viewer that could never light the executed path. Both
  places now say what it does: `<Replay>` draws the chart and stops there,
  and is a strictly smaller view than the live `<Lens>`.

- **The root barrel no longer claims to re-export `mcpClient`.** A comment in
  `src/index.ts` told readers that `mcpClient` and the tool-dispatch
  primitives were reachable from the top-level import. They have not been
  since 6.0.0 collapsed the convenience mirrors: `mcpClient`,
  `mockMcpClient`, `staticTools`, `gatedTools` and `skillScopedTools` live
  only under `agentfootprint/tool-providers` — one subpath for everything
  tool-related, which is the intended design. The comment now says so, as
  does its mirror in `src/tool-providers/index.ts`, which made the same claim
  from the other side. Comment-only; no export changed.

## [7.7.0] - 2026-07-27

### Added

- **`parallelToolCalls` on `anthropic()` and `browserAnthropic()` — one tool
  per reply, enforced by the API.** Claude may ask for several tools at once:
  one assistant message carrying many `tool_use` blocks, all executed inside a
  single agent iteration. That is the right default for speed, and the wrong
  one when the SHAPE of the loop is part of what you are measuring. Per-
  iteration analysis reads one tool source per iteration —
  `localizeContextBug` seeds one `'tool'` suspect from that iteration's
  `lastToolResult`, and `removableSources` de-duplicates by tool name — so a
  batched reply is attributed to the LAST tool of the batch; the others never
  appear as their own influence rows and cannot be ablated individually. An
  agent that genuinely consulted three sources could show one. Passing
  `parallelToolCalls: false` sends `tool_choice: { type: 'auto',
disable_parallel_tool_use: true }`, which caps the model at one tool per
  reply and keeps every source separately attributable, at the cost of one
  extra round trip per tool. `auto` is deliberate: the model still chooses
  WHICH tool, and whether to call one at all — only the count is capped.
  Nothing goes on the wire when the option is omitted or `true` (batching is
  already Anthropic's default), and nothing goes on a request that carries no
  tools (Anthropic rejects `tool_choice` there — an agent's final answer call
  often has none). Both the `complete()` and `stream()` paths honor it, and
  the Node and browser adapters emit a byte-identical field so a BYOK page and
  its server behave the same. Prompting is not a substitute: "call one tool at
  a time" in the system prompt is a request the model may ignore; this is a
  request parameter the API enforces.

## [7.6.1] - 2026-07-25

### Fixed

- **Bedrock streaming now delivers tool calls.** `bedrock()`'s `stream()`
  ignored ConverseStream tool-use events and returned `toolCalls: []` on the
  terminal chunk — so an agent on Bedrock with streaming enabled saw
  `stopReason 'tool_use'` with zero tool calls and quietly treated it as a
  final answer. Tool calling via `bedrock()` + streaming never worked; the
  non-streaming path was always correct. The stream loop now accumulates
  tool-use blocks across `contentBlockStart` / `contentBlockDelta` /
  `contentBlockStop` (keyed by `contentBlockIndex`, so parallel tool calls
  that interleave are parsed correctly; no-arg tools yield `args: {}`), and a
  stream/non-stream parity test pins the two paths together.

### Added

- **Honesty invariant on Bedrock responses (both paths):** `stopReason
'tool_use'` with zero parsed tool calls is never returned quietly — the
  provider throws `BedrockProviderError` with `code:
'BEDROCK_STREAM_TOOLUSE_LOST'`. After this fix the contradiction cannot
  happen on today's wire format; the throw is a tripwire for future
  ConverseStream shape drift, and it lands in your `reliability` /
  `withRetry` rules instead of the agent silently answering without tools.
- **Malformed streamed tool-args JSON is a typed error**, not a silent `{}`:
  `BedrockProviderError` with `code: 'BEDROCK_MALFORMED_TOOL_ARGS'` plus
  `.toolName` / `.toolUseId`. A tool is never executed with dropped arguments.
- **Slot budget overflow is loud.** When a context slot composes over its
  `budgetCap` (e.g. tools slot: used 2447 chars of cap 2000), the slot now
  emits the previously-documented-but-never-fired
  `agentfootprint.context.budget_pressure` event with `planAction: 'none'`
  (nothing is truncated — the full content still goes to the LLM) and prints
  one structured `console.warn` per agent. `planAction` gains the `'none'`
  member. Cap defaults are unchanged.

## [7.6.0] - 2026-07-24

### Added

- **`recordedChat` — the chat session that can explain itself.** Every chat
  host that wanted per-turn transparency re-wrote the same correctness-
  critical glue; `recordedChat({ makeAgent })` absorbs it. `send(message)`
  runs one recorded turn through YOUR agent factory and freezes that turn's
  evidence immediately (snapshot, events, last LLM call) — the
  `getLastSnapshot()`-is-last-run-only trap becomes structurally impossible.
  History threading is owned by the library: the exact message string each
  turn ran with is frozen on the `ChatTurn`, and `rerunTurn(k, { ignore,
embedder, checkBaseline? })` replays those bytes verbatim through an
  `AblationRunner` derived from the SAME `makeAgent` — same recorded
  conversation up to that point, minus the ignored sources — delegating to
  `rerunWithoutSources` and returning its result UNMODIFIED (the honesty
  tiers are untouched: a causal verdict only with `checkBaseline: true`).
  `reason(k)` is memoized `localizeContextBug` over the turn's frozen
  artifacts (`atStep` defaulted to that turn's last LLM call), so
  `removableSources(report)` and the existing UI joins compose unchanged.
  `fork(k, { fromRerun? })` branches — never rewrites — the conversation: a
  NEW `recordedChat` seeded with the counterfactual (or original) reply,
  carrying the removed sources into every later turn, and `fromRerun` must
  be a result THIS session's `rerunTurn` produced for that turn (a
  fabricated fork would be a lie). Session registries, UI joins, comparators
  and persistence stay host-side by design. Exported from
  `agentfootprint/debug`. See the
  [recordedChat guide](https://footprintjs.github.io/agentfootprint/docs/debug/recorded-chat/).

## [7.5.0] - 2026-07-24

### Added

- **`checkIn` — evidence-carrying human consent for consequential tool
  actions.** "OpenWorker-class agents check in; agentfootprint checks in WITH
  THE RECEIPTS." A tool declares `checkIn: 'always'` or a
  `(args, ctx) => boolean` predicate (`defineTool` / `Tool.checkIn`). When it
  trips, the tool-dispatch loop pauses BEFORE the tool executes — AFTER the
  permission gate + arg-validation, BEFORE credential resolution — riding the
  EXISTING pause/checkpoint machinery. `agent.run()` returns a
  `RunnerPauseOutcome` whose new `checkIn` field is a typed `CheckInRequest`
  (`{ tool, args, intent?, evidence }`); `isCheckInPause(outcome)` is the clean
  discriminant from a plain `askHuman` pause. The evidence pack
  (`CheckInEvidence`) carries plain-named receipts — `willDo` (tool
  description + rendered args), `read` (context the run consumed, from the
  conversation frames + system rules), `drivers` (which context drove the
  choice, ranked — a PLUGGABLE `CheckInScorer`, default deterministic lexical,
  **zero LLM calls**), and `trail` (compact grouped run-so-far). Two built-in
  assemblers, configured on the builder via `.checkIn({ evidence: 'standard' |
'minimal' | <assembler>, scorer? })`. The human answers with
  `checkInApproved({ by, note? })` / `checkInDeclined({ by, note? })`;
  `agent.resume(checkpoint, decision)` executes the tool on approve, or lands a
  model-visible `"declined by human: <note>"` result on decline (mirroring
  permission rejections). Two new typed events — `agentfootprint.checkin.request`
  / `.decision` (registry now 67 events / 19 domains) — ride the emit channel;
  the built-in `CheckInRecorder` (compose-a-store, attach with
  `agent.attach(...)`) captures the ask + decision as a queryable audit trail
  (`getRequests()` / `getDecisions()` / `getStats()`). The whole pack survives
  `structuredClone` + JSON (checkpoint discipline), so Process A (ask) and
  Process B (decide) can be servers and days apart. **Backward compatible:** a
  tool without `checkIn` is byte-identical — no gate, no events, no pause. NOT a
  policy engine (`PermissionChecker` untouched; policy runs first) and NOT UI —
  this is consent, with the receipts. See the
  [Check-in guide](https://footprintjs.github.io/agentfootprint/docs/monitor/checkin/).
- **Named influence strategies — the ranking stage becomes a picker.** The
  pluggable `InfluenceScorer` seam gets a plain-named descriptor: an
  `InfluenceStrategy` is `{ name, description, requirements, scorer }`, and
  `listInfluenceStrategies()` enumerates the built-ins so a host UI can render a
  strategy selector and grey out what it can't run (`requirements: ['embedder']`
  vs `[]`). Two ship: **`semantic-alignment`** — the existing FDL four-signal
  embedding composite (`scoreInfluence`), the default, needs an embedder — and
  **`lexical-overlap`** — new `scoreLexicalInfluence`, deterministic word-overlap
  scoring with zero dependencies and zero model calls (same four-signal frame,
  set-cosine over tokens instead of embedding cosine, honest `InfluenceScore`
  output including Eq. 6 weight adaptation). `localizeContextBug({ scorer })` now
  accepts a strategy object as well as a bare function (non-breaking), and the
  report's new optional `rankedBy` echoes which strategy ranked. The claim ladder
  is untouched: any strategy only reorders suspects — ablation alone convicts.
  See the strategy section of the
  [localizer guide](https://footprintjs.github.io/agentfootprint/docs/debug/localize-context-bug/).
- **`rerunWithoutSources` — the counterfactual re-run as one call.** Take a
  finished run's `ContextBugReport`, name the sources to ignore (plain ids:
  injection id, tool name, or step id — `removableSources(report)` lists what a
  UI can offer as toggles), pass the same `AblationRunner` the localizer's causal
  mode uses, and get back `{ answer, answers, removed, whatChanged, runs }`:
  the re-run's answer, every seeded re-run's answer, the ablation specs that were
  applied, and an honest `whatChanged` (`answerFlipped` by majority over N≥2
  seeded re-runs, similarity stats, a plain-language summary — never a single-run
  diff). Opt into `checkBaseline: true` and the unchanged scenario is probed too,
  unlocking the causal-tier `verdict` (same `verdictFor` claims as
  `localizeContextBug`). Reuses `applyAblations`/`runAblationProbe` end to end —
  no new machinery — and works identically with mock providers ($0) and real
  ones. **Backward compatible:** additive API only; existing `scorer` functions,
  reports, and runners are untouched. See
  [Re-run without sources](https://footprintjs.github.io/agentfootprint/docs/debug/rerun-without-sources/).

## [7.4.0] - 2026-07-09

### Added

- **`run({ correlationId, traceId })` → `EventMeta` on every event** —
  `EventMeta.correlationId`/`traceId` already existed
  (`src/events/types.ts:92/96`) and `buildEventMeta` already forwarded them
  from `RunContext` (`src/bridge/eventMeta.ts:82-83`), but
  `Agent.createExecutor()` built `currentRunContext` without ever reading
  them, so event meta was permanently `undefined`. New `AgentRunOptions`
  (extends footprintjs `RunOptions`) adds optional `correlationId`/
  `traceId` to `run()`/`runTyped()`/`resume()`/`resumeOnError()`; both land
  in `currentRunContext` so every emitted event on that run carries them.
  `traceId` falls back to `options.env.traceId` (footprintjs
  `ExecutionEnv`) when not set directly; an explicit `traceId` always wins.
  Each `createExecutor()` call rebuilds `currentRunContext` from scratch,
  so an untagged run never inherits a prior run's `correlationId`/`traceId`
  (pinned by test). **Who consumes it:** vizfootprint's `why()` — joining
  agentfootprint's event stream against an external system (an upstream
  request id, an OTEL trace, a cross-tier causal join key) without
  smuggling the join key through tool args (D20/P1 spike).

## [7.3.1] - 2026-07-09

### Fixed

- **`ToolChoiceRecorderHandle` stays assignable to `.recorder()` again** —
  7.3.0's pause/resume fix (`f0a87de`) gave the handle's new `onResume` a
  minimal event slice that shared zero property names with the
  scope-channel `ResumeEvent` branch of `CombinedRecorder`'s union, so
  TypeScript's weak-type check ("no properties in common") rejected the
  whole handle regardless of method-parameter bivariance —
  `agentBuilder.recorder(toolChoiceRecorder(...))` failed to typecheck.
  Fixed by splitting `onResume` onto its own slice that also declares an
  optional `hasInput`, giving it a property name in common with the
  scope-channel variant. **Type-only — no runtime behavior change.** A
  compile-level type-regression test suite (`test/type-regressions/`, run
  via the new `npm run test:types`) is now wired into CI, closing the gap
  that let this slip past 22 passing `ToolChoiceRecorder` tests (the root
  `tsc --noEmit` only covers `src/**`; vitest never typechecks).

## [7.3.0] - 2026-07-08

### Added

- **`agentfootprint/embedders`** — ready-made `Embedder` implementations for the
  embedding-backed scorers (`toolChoiceRecorder`/`scoreMargin`, memory
  retrieval). Core still ships only `mockEmbedder`; these are optional +
  lazy — each heavy backend is an OPTIONAL PEER DEPENDENCY imported on first
  embed, so the core stays dependency-free and you install only what you
  use: `openaiEmbedder()` (hosted, fetch + `OPENAI_API_KEY`, no extra
  install), `localEmbedder()` (on-device MiniLM via
  `@huggingface/transformers`, offline), `staticEmbedder()` (pure-JS
  Model2Vec via `@yarflam/potion-base-8m`, no network).
- **`attributeChoice`** (influence-core / `/debug`) — the transpose of
  `scoreMargin`. `scoreMargin` fixes the context and ranks candidate tools
  (deliberately excluding the constant system prompt), so it is
  structurally blind to PROCEDURAL picks. `attributeChoice` fixes the
  CHOSEN tool and ranks the context units (system-prompt rules + task)
  against it, so a constant-but-load-bearing rule surfaces as a citation
  ("picked because rule-1"), with a per-channel share of positive
  similarity mass (procedural vs topical). New `AttributionUnit` /
  `UnitScore` / `ChoiceAttribution` types. Honest: a Tier-1 similarity
  PROXY (Tier-3 counterfactual ablation is the ground truth) — no causal
  claim.
- **`explainChoice` + `snippetUnits`** (influence-core / `/debug`) — a
  UI-ready verdict for one tool pick. `explainChoice` fixes the chosen tool
  and reports WHICH context channel best explains it — system rules,
  user's task, or data returned by earlier tools — as `{channels (share of
positive similarity mass, sorted desc, zero-share listed), top citation
with unit text, ranked units}`; thin composite over `attributeChoice`.
  `snippetUnits` cuts a tool result (JSON or prose) into citable
  `AttributionUnit`s at the natural grain — one unit per object array
  element as `key: value` pairs — bounded (max/maxLength), total
  (circular-safe), pure. Together they power the answer-first "What drove
  it" verdict card in agentThinkingUI.
- **`anthropic({ timeout, maxRetries })`** — the Anthropic provider now
  accepts `timeout?`/`maxRetries?`, passed straight to the Anthropic SDK
  client (omit for SDK defaults). Long non-streaming turns (slow models,
  long conversations, agent loops) could exceed the SDK's default request
  timeout with no escape hatch.

### Fixed

- **`staticEmbedder` matches potion's async batch embed API** — the
  adapter guessed a synchronous `new Cls().encode(text)` shape; potion-base-8m
  actually exports an async BATCH `embed(texts) => Promise<Float32Array[]>`,
  so the old adapter silently returned `[]`. Rewritten to await the batch
  embed and take the first row, plus `embedBatch` and a `toRows()`
  normalizer (`Float32Array[]` / `number[][]` / a single flat vector).
- **`toolChoiceRecorder` survives pause/resume** — it reset its store on
  ANY runId change in `onRunStart`, but footprintjs's `resume()` fires
  `onResume` (stamping the regenerated runId) and THEN
  `traverser.execute()` fires `onRunStart` with that same runId, wiping
  every pre-pause entry (downstream: a debugger's Meaning-match scores
  vanished after an approve/resume turn). A new `onResume` handler updates
  the tracked runId WITHOUT resetting; a genuinely fresh `run()` still
  resets. **Requires footprintjs ≥ 9.10.1** — the no-collision half
  (post-resume calls landing on new, non-overlapping runtimeStageIds)
  needs 9.10.1's checkpoint `executionCount`/`visitCounts` seeding.

### Changed

- footprintjs peer/dev floor raised to **`^9.10.1`** (required by the
  `toolChoiceRecorder` pause/resume fix above).

## [7.1.0] - 2026-07-02

### Added

- **`backtrack(variable, element?, before?)` — the 6th trace-toolpack tool**
  (reserved under `.selfExplain()` inline mode). Variable-first triage: no
  step id needed — anchors at the variable's last writer and walks the
  dependency chain (fp 9.10.0 `sliceForKey`/`formatSlice`). Element mode is
  the agent mega-key answer: `backtrack({variable: 'history', element: 7})`
  names the exact iteration that produced message 7, with honest attribution
  (`append-verb` = engine-recorded/EXACT under the agent's `commitValues:
'delta'` default). Honest absence (never-written → initial state / args /
  closure), corrective out-of-range/not-an-array answers, chained-triage
  hints with real commit indices.
- **`sliceToBacktrackTrace(sliceJSON, opts)`** (`agentfootprint/debug`) — the
  STRUCTURAL sibling of `toBacktrackTrace`: renders a footprintjs variable
  slice on agentThinkingUI's BacktrackView board. Always
  `mode: 'correlational'`, every card a path-only upper bound (hatched
  meter), score = hop proximity with the formula named in the honesty lines,
  slice honesty (reads-coverage, truncation, incomplete-sources, honest
  absence) mapped verbatim. The parity artifact: the LLM's triage and the
  human's board are the same JSON.

### Changed

- footprintjs peer/dev `^9.10.0` (the slice layer + `writeProvenance` dial).

## [7.2.0] - 2026-07-02

### Added

- **`contextLedger()`** (`agentfootprint/observe`) — which context pieces
  EARNED their tokens? Post-run bookkeeping over the run's own commit log:
  offers = the context in effect at each LLM call (net-change-filter-exact
  folding), uses = structural signals per kind (tool-called /
  skill-activated / answer-slice(slot)), outcomes = consumer labels credited
  to offered pieces. `earnRate` (used ÷ offered) is the headline number;
  export/import merges additively for cross-session accumulation. All
  counters are recorded facts — no causal claims (ablation can upgrade
  individual rows).
- **Ledger gates** (same subpath) — the rows feed three EXISTING seams, no
  new framework surface: `ledgerToolGate(ledger)` → `ToolGatePredicate` for
  `gatedTools(...)`; `ledgerEntryScorer(ledger, inner)` → wraps any
  `EntryScorer` for `skillGraph().entryBy(...)` (demotion is ranking
  pressure re-ranked through `rankEntries`, so the pick and the surfaced
  relevance always agree — never exclusion); `ledgerGated(injection,
ledger)` → rewrites `always` to a ledger-backed rule, ANDs an existing
  rule, passes demand-driven triggers untouched. One `LedgerPolicy`:
  **demote, never starve** (`minOffers` 5, `earnRateFloor` 0.05, parole
  every `refreshEvery` 10th decision so a demoted piece keeps earning data).
- **Runner-shape honesty**: `recordRun` returns `undefined` (and counts
  nothing) for runs with no LLM-call markers — `LLMCall` is refused, never
  silently mis-scored. Grouped agents (`reactMode: 'dynamic-grouped'`) are
  metered correctly: offers fold from each `sf-llm-call` subflow's inner
  commit log (in grouped mode injections earn via `skill-activated`;
  `answer-slice(slot)` needs root-log slot writes — `usedVia` shows which
  signals fired).
- **Example 32** ([examples/features/32-context-ledger.ts](examples/features/32-context-ledger.ts)) —
  the full loop on an over-stuffed fixture: run → rows (5 zero-earners,
  ~1,940 wasted tokens) → gates → 88% fewer input tokens per turn.

## [7.0.0] - 2026-06-26

**Major: API surface cleanup — main barrel is now just the core agent API, everything specialized lives in a named subpath.** A coordinated breaking release (agentfootprint + agentfootprint-lens) so consumers land on the clean surface once. Nothing is removed — every capability is still exported, just from its canonical home.

### Changed (BREAKING — import paths)

- **New `agentfootprint/events`** — the typed event system (`EventDispatcher`, `EVENT_NAMES`, `AgentfootprintEvent`/`AgentfootprintEventMap`, the `Payloads` namespace, context/composition types) moved off the main barrel to its own subpath.
- **`/locales` is the single i18n home** for all prose catalogs (commentary + thinking + status templates); **`/status`** keeps only the status _logic_ (`selectStatus` / `renderStatusLine`).
- **Main barrel trimmed 129 → 53 values** — provider/memory/injection/tool-provider/stream/security/status/locale factories plus `typedEmit` now import from their named subpath (they were convenience mirrors). **Types follow their values**: ~95 type duplicates (including the event types) moved off main to their feature subpath, so each feature's whole surface (values + types) lives in one place.
- **`decideSkill`** — the skill-graph decider, formerly exported as `decide` (now on `agentfootprint/injection-engine`), was renamed to avoid colliding with footprintjs's `decide()`.
- A handful of internal mechanism symbols (`buildMessageApiChart`, `buildDefaultInstruction`, `buildEventMeta`, `parseSubflowPath`, `EmitBridge` / `EmitBridgeOptions`) are no longer public.

### Added (non-breaking)

- **`agentfootprint/debug`** — a debug-focused subpath that re-exports the diagnosis tools (context-bug localizer, influence scoring, trace toolpack / `.selfExplain` machinery, tool-catalog lint). These **also remain available from `/observe`** for one transition version (`/observe` now reads as recorders-first; the debug re-exports are deprecated there). The deep `observability/contextError/finders` path gains a shorter alias, **`agentfootprint/debug/finders`** — the old path still works.
- **`agentfootprint/cache`** — the prompt-cache recorder (`cacheRecorder`) and custom cache-strategy registration are now importable (they were previously unreachable from any path).

### Migration

Re-point imports to the named subpath (e.g. `import { defineMemory } from 'agentfootprint/memory'`, `import { localizeContextBug } from 'agentfootprint/debug'`, `import { EventDispatcher } from 'agentfootprint/events'`). Rename `decide` → `decideSkill` for skill-graph trees. The commentary engine helpers used by viewers (`renderCommentary`, `extractAgentName`, `extractCommentaryVars`, `selectCommentaryKey`) remain on the main barrel. Most old paths that were _aliased_ (`/observe` debug tools, the long finders path) still resolve this major and warn; they're removed next major.

## [6.45.0] - 2026-06-24

### Added — Pluggable entry scorer (keyword router + strategy interface)

Picking the starting skill in a skill graph is now a **pluggable scorer strategy**.
`.entryBy(scorer)` takes any `EntryScorer`; two built-ins ship:

- **`keywordScorer()`** — rank entries by word overlap between the user's message and
  each skill's `description`. **No embedder, no model call, deterministic** — routing
  "on" with zero setup. The new zero-config alternative to wiring an embedder.
- **`embeddingScorer(embedder)`** — semantic (cosine similarity). `.entryByRelevance(embedder)`
  is now **sugar for `.entryBy(embeddingScorer(embedder))`**. Batches via `embedder.embedBatch`
  when available (was N+1 serial).
- Bring your own by implementing `EntryScorer`. New exports: `keywordScorer`,
  `embeddingScorer`, `rankEntries`, `EntryScorer`, `EntryScorerInput`, `EntryCandidate`.
- The chosen scorer's **name + ranking** now land on the snapshot (`entryScores` + the new
  `entryScorer`), so a lens / "Why this skill?" panel can show HOW the entry was chosen.
- `start.scoredBy` added to the `skillGraph({...})` config-object form.

### Changed

- **`EntryScore.cosine` → `EntryScore.score`** — a strategy-agnostic raw score (cosine for
  the embedding scorer, word-overlap for keyword). `EntryScoring` gains a `scorer` field (the
  strategy name). This is a recently-added, niche field; the only internal reader was updated.
  ⚠️ If you read `entryScores[].cosine`, rename it to `.score`.
- The surfaced relevance % and the chosen entry can **no longer disagree** — non-finite scores
  from a custom scorer are sanitized so they can never silently win the pick.

### Fixed

- **`.tree().entryBy()` / `.tree().entryByRelevance()` now throw** instead of silently ignoring
  the scorer (symmetric with the existing `.tree().entryByRead()` guard).

### Added — Context-bug localizer documented (Beta)

The contextual-bug **localizer** (`localizeContextBug`, "git bisect for context") is now
documented as a **beta** feature: trigger → causal slice → influence-weighted ranking →
counterfactual ablation. Honesty model held throughout — the ranking is a proxy; only
ablation verdicts are causal claims.

- **New guide:** _Localize a context bug_ (`debug/localize-context-bug`), debugging-framed,
  in the Debug section. Its code block is twoslash-compiled against the real types (anti-drift).
- **New tested example:** `examples/observability/17-localize-quickstart.ts` — runs `$0` and
  proves the planted fact is the confirmed causal root cause (3/3 ablation flips).
- **`@beta` markers** on the `context-bisect` module + `localizeContextBug`. The API (exported
  from `agentfootprint/observe`) is unchanged — now labeled beta.

### Removed — legacy Astro/Starlight `docs-site/`

The old `docs-site/` (Starlight) is **removed** — `docs-next/` (Next.js + Fumadocs) is the sole,
deployed docs site. All content had already migrated; the CI "docs gate" now builds docs-next
(twoslash-compiling every code block in place of the former `<CodeFile>` transclusion).

## [6.44.0] - 2026-06-22

### Added — `enable.localObservability()` + offline-replay `Trace`

Tier-3 (Debug) observability: **retain** a live run model, render it live via the
lens, and snapshot it for **offline replay** — no agent re-run.

- **`agent.enable.localObservability({ onLive?, onRecorded?, redact? })`** → a handle
  that is `<Lens>`-renderable live (`onLive` per event) and `getTrace()`-serializable.
  `onRecorded` fires once at run exit with the finalized `Trace`.
- **`Trace`** (UI-free, JSON-lossless) — the `BoundaryRecorder` domain-event log + the
  serialized static chart `structure`. The step graph is always a derived projection
  (never stored), so redaction reaches the rendered flowchart with no second content
  surface. `serializeTrace`, `traceToStepGraph`, `buildStepGraphFromEvents`, and the
  ready-made `redactContent` ship from `agentfootprint/observe`.
- **Redaction at the serialize boundary** — `getTrace({ redact })` runs once per event
  so PII never enters the `Trace`; the result is self-describing via `trace.redaction`.
  The engine's `RedactionPolicy` already propagates to subflows; the flat event log
  means one `redact` pass covers the whole tree.

Pairs with `agentfootprint-lens`'s `<Replay trace>` (offline) and `<Lens>` (live). See
`docs/design/local-observability-and-pii.md`. Also adds design notes for governance
(`docs/design/governance.md`). Library is UI-free and browser-bundleable unchanged.

## [6.43.0] - 2026-06-22

### Added — `BedrockAgentMemory` reader for legacy Bedrock Agents memory

AWS has two memory systems: the newer **AgentCore** (`AgentCoreStore` — a read/write event
store, the go-forward path) and the prior-generation **Bedrock Agents** product, whose memory
is **read-only** (the agent auto-generates `SESSION_SUMMARY` records). `BedrockAgentMemory` is a
small, honestly-scoped **reader** for the latter — `readSummaries()` / `readText()` / `forget()`
over `GetAgentMemory` / `DeleteAgentMemory` (peer-dep `@aws-sdk/client-bedrock-agent-runtime`).

It is intentionally **not a `MemoryStore`** (Bedrock owns the writes — there's no `put`); wrapping
it as `defineMemory({ store })` would be a "store that can't store." Use it to surface Bedrock's
built-in memory in an agentfootprint agent (e.g. inject `readText()` as a Fact). Exported from
`agentfootprint/memory-providers`; a command-name test pins the real SDK commands. Prefer
`AgentCoreStore` for a real read/write store — this exists mainly for teams migrating off
Bedrock Agents.

## [6.42.0] - 2026-06-22

### Fixed — `.memory()` now injects recall into the prompt on the Agent path

`.memory()` on an **Agent** read, formatted, and persisted recall but never composed it into
the prompt — the memory READ subflow wrote `memoryInjection_<id>`, while the slot composers
only read `activeInjections`, with nothing bridging the two. So turn N never saw turn N-1's
facts (and the uninformed reply then self-polluted the store). `memoryRecallInjections` now
turns each recall into a `'memory'`-flavored `ActiveInjection` (system-role content → system
slot, the rest → messages slot), folded in by the slot-fork inputMappers in `buildAgentChart`

- `buildDynamicAgentChart`. No new stage, no structure change, a no-op without memories.

This **changes runtime behavior** (an Agent with `.memory()` now sends prior-turn context to
the model) — hence a minor. Regression test asserts recall reaches turn-2's prompt across
classic / dynamic / dynamic-grouped (the coverage gap that let it ship).

### Fixed — `AgentCoreStore` targeted the wrong AWS service

`AgentCoreStore` imported `@aws-sdk/client-bedrock-agent-runtime` (the **old Bedrock Agents**
API) and dispatched `PutMemoryEventCommand` / `GetMemoryEventCommand` / … — commands that
**do not exist in any package**. It only passed because tests injected a mock, so it would
throw the moment a real `memoryId` was wired. It now targets **`@aws-sdk/client-bedrock-agentcore`**
(`BedrockAgentCoreClient` + `CreateEvent` / `ListEvents` / `DeleteEvent`).

AgentCore Memory is an **append-only event log**, so the adapter is mapped accordingly: `put`
appends (the entry is stored as a `blob` document; `actorId` from the identity tuple,
`sessionId` from the conversation); `list` is `ListEvents` (window / episodic memory is the
natural fit); `get`/`delete` by id are list-then-find (server-assigned event ids); `forget`
lists + deletes each event (AgentCore has no `DeleteSession`). New optional peer
`@aws-sdk/client-bedrock-agentcore` (the old `…-agent-runtime` peer is retained for future
adapters). A new test pins the **real command names** so the wrong-service bug cannot recur.

## [6.41.0] - 2026-06-19

### Fixed — OpenAI/Azure adapters use the current Chat Completions params

The `openai` / `azureOpenai` / `browserOpenai` / `browserAzureOpenai` adapters sent
deprecated params that break on current models:

- **`max_tokens` → `max_completion_tokens`** on OpenAI/Azure. `max_tokens` is deprecated
  and **rejected by o-series reasoning models** (o1/o3/o4-mini, Azure reasoning
  deployments); the new param is accepted by all current chat models (incl. gpt-4o).
  Custom OpenAI-compatible endpoints (Ollama/vLLM/Together/Groq — detected via `baseURL`
  / non-`api-key` auth) keep `max_tokens`.
- **Streaming token usage was always 0** — the adapters never sent
  `stream_options: { include_usage: true }`, so OpenAI/Azure emitted no usage chunk.
  Now requested on OpenAI/Azure streams (`usage.input/output` are populated).

### Added — `reasoning` option for o-series models

`openai({ reasoning })` / `azureOpenai({ reasoning })` (and the browser variants). When
set — or auto-detected from a standard o-series model id (`o1`/`o3`/`o4-…`) — the adapter
omits the explicit `temperature` (rejected by reasoning models) and sends the
**`developer`** role in place of `system`. Set it explicitly for Azure deployments whose
name does not reveal the underlying model.

The Tools API format was already current (modern `tools` / `tool_calls`) and is unchanged.

## [6.40.0] - 2026-06-18

### Added — `toolContractCheckup`: diff agent tool schemas vs a tool-server catalog

The server-boundary extension of proposal 009. When an agent's tools call a remote
tool-server (an MCP-ish sidecar, a function gateway), the agent's `inputSchema` and the
server's real contract can drift — the model then calls a tool that 404s, or omits an
arg the server REQUIRES and gets a "doesn't work." Servers usually publish a catalog
(`GET /tools` → `[{ name, inputSchema }]`), so the drift is **checkable at build/CI
time** instead of surfacing as a runtime error.

**`toolContractCheckup(agentTools, serverCatalog)`** — a PURE diff (no I/O; you fetch
the catalog and pass it). Accepts `Tool[]` or `{name, inputSchema}[]` on either side.
Flags:

- **`required-divergence`** (error) — server REQUIRES an arg the agent marks optional/omits → the model omits it → server rejects.
- **`optional-drift`** (warning) — server accepts an arg the agent never surfaces → the model can't use that filter ("tool ignores my narrowing").
- **`arg-divergence`** (warning) — the agent declares an arg the server doesn't know (a rename/typo).
- **`missing-on-server`** (error) — an agent tool not in the catalog → would 404.
- **`dead-endpoint`** (warning) — a server tool no agent tool calls.

New exports (main barrel): `toolContractCheckup`, `formatToolContractCheckup`, types
`ToolContractCheckup` / `ToolContractProblem` / `ToolContractCode` / `ServerToolEntry`.
New example `30-tool-contract-checkup.ts`.

Motivation: a real adopter (Neo) hit "tools don't work" against an MCP-ish Python
sidecar. Running this against the sidecar's `/tools` catalog proves the schemas are
**already aligned** (the failures were a deployment `MOCK`/env config issue, not a
contract drift) — exactly the kind of fast, honest verdict a static check gives.

## [6.39.0] - 2026-06-18

### Added — skill-body ↔ tool-contract check (proposal 009, Tier 1)

A skill's `body` (prose injected into the system prompt) can quietly contradict the tools
it actually unlocks — and the model then **refuses a tool that is right there**, or is told
about one it can't call. This was the core of a real adopter (Neo) tool-visibility report.
The library already knows each skill's real tool set, so it now flags the mismatch at
authoring time.

`graph.checkup()` runs a new **deterministic, no-LLM** pass over each skill's body vs its
`tools[]` and adds two WARNING codes (never errors — they never fail `.build()`):

- **`body-foreign-tool`** — the body names a tool that belongs to **another** skill (not
  callable on this turn). Usually an intentional `read_skill` handoff — confirm it, add the
  tool, or reword.
- **`body-unknown-tool`** — the body has a `tool_name(` call to a tool that exists **nowhere**
  (a typo, or a renamed/removed tool).

New exports (main barrel): `checkSkillContract(skill, knownToolNames?)` (check ONE skill
standalone), `checkSkillContracts(skills)`, `skillToolNames(skill)`. New example
`29-skill-contract-check.ts`; guide section 8.

Honest scope: Tier 1 is deterministic and catches the _adjacent_ class. The **semantic**
contradiction it can't see — a body calling an OPTIONAL tool arg "required" (the exact
shape of the originating bug) — is **Tier 2 (LLM-advisory)**, designed in proposal 009 but
not yet built.

## [6.38.1] - 2026-06-18

### Added — tool-name guardrail (catch the silent "my tool vanished" 400)

OpenAI, Azure OpenAI, and Anthropic all require tool names to match
`^[a-zA-Z0-9_-]{1,64}$`. A name with a dot, space, slash, colon, or >64 chars makes
the provider **400-reject the whole request — so EVERY tool disappears**, not just the
bad one, which reads as "my tool isn't visible." The library never validated this.

- **`warnIfInvalidToolName(name)`** — the new default guard. `defineTool` and the
  agent's tool-registry build call it for every tool name (including `autoActivate`
  skill-scoped tools and raw `{schema,execute}` literals). **Dev-mode warning only**
  (`enableDevMode()`), never a throw — so mock providers, name-sanitizing custom
  providers, and namespaced names (`server.tool`) keep working. Production pays nothing.
- **`assertValidToolName(name)`** — strict variant that **throws** a clear, actionable
  error (names the tool, the rule, and the fix). For consumers who want a hard failure
  in a build step or test.

Both exported from the main barrel. No behavior change at run time unless dev mode is
on (then you get a heads-up instead of an opaque provider 400 later).

## [6.38.0] - 2026-06-18

### Added — `.entryByRead()`: the LLM picks the skill-graph entry, no embedder

A flat `skillGraph()` with multiple `.entry()` skills needs to choose where a turn
starts. Until now that was either an embedder (`.entryByRelevance(embedder)`) or the
silent fallback of loading **every** entry's body each turn. For setups with no
embedder — or where embeddings route poorly for the domain's language — neither fits.

**`.entryByRead()`** makes the agent's **own LLM** pick the entry by reading the menu:

```ts
skillGraph().entry(billing).entry(incident).entryByRead().build();
```

- **Exclusive, like `entryByRelevance`** — only the chosen entry's body loads
  (token-efficient); the others stay dormant.
- **No embedder, no extra model call** — on the first turn **no** entry body is
  injected; the agent is offered the entries through the existing `read_skill` gate
  (`reachableSkills(undefined)` already returns the entries), and its pick becomes the
  cursor. The chosen entry's exclusive trigger (`nextSkill(ctx) === id`) then fires and
  the normal `from`-gated routing takes over — reuses the `read_skill → activatedInjectionIds`
  path, so no engine/runtime change was needed.
- **Object form:** `{ start: { entries: [...] } }` now defaults to `entryByRead`; add
  `byRelevance: embedder` to opt into the embedder ranking instead.
- Guardrails: mutually exclusive with `.entryByRelevance()` (throws); flat-graph only,
  not `.tree()` (throws).

Existing graphs are unchanged — `.entry()` without `.entryByRead()`/`.entryByRelevance()`
keeps its v1 always-on semantics. New: example `28-skill-graph-entry-read.ts`, guide
section 4 (now five entry strategies).

## [6.37.1] - 2026-06-18

### Fixed — a `decide()` rule no longer trips the `no-llm-call-ids` warning

`toBacktrackTrace` emitted the `no-llm-call-ids` honesty flag — _"pass llmCallIds or captured
events … the ranking is structure-only"_ — whenever a slice had zero LLM-call ids. For a
deterministic `decide()` rule that wording is misleading: a rule makes **no** LLM calls, so
structure-only ranking is the _correct, expected_ mode, not a missing input. The localizer can't
tell that case from "an LLM chart whose `llmCallIds` weren't passed" (both have
`llmCallIdCount === 0`) — only the consumer's `decidedAtKind` disambiguates. So when
`decidedAtKind: 'rule'`, that one flag is reframed into a neutral, non-`⚠` note:

> _"this decision is a deterministic rule — it makes no LLM calls, so scores rank recorded operands
> by structure (no influence weighting applies)."_

LLM decisions are unchanged — a genuine "forgot to pass `llmCallIds`" still surfaces as a `⚠`
warning. Visible on the backtrack-board demo's `decide()` rule pill, where the warning previously
read as alarming in exactly the spot the categorization calls "the clean, fully-recorded kind".

## [6.37.0] - 2026-06-18

### Added — pluggable influence scorer for `localizeContextBug` (the RANK extension point)

**`scorer?:` slot + `InfluenceScorer` type.** The context-bug localizer's suspect-ranking step is now
a swappable slot: `localizeContextBug({ scorer })` accepts any `InfluenceScorer` —
`(ScoreInfluenceArgs) => Promise<InfluenceScore[]>` — and defaults to the shipped FDL four-signal
composite (`scoreInfluence`). Bring your own to change the ranking ORDER: `scoreContrastiveInfluence`
(wrap it to remap `answerText` ← `finalAnswerText` and supply a `referenceText`), or a scorer of your
own. New `InfluenceScorer` type exported from `agentfootprint/observe`.

**Claim-ladder guarantee.** A scorer only reorders suspects (how _fast_ ablation reaches a culprit),
never _whether_ a claim is causal — ablation alone convicts. Its output flows into `semanticScore` /
ranking only, never into any verdict path. So any scorer is safe to swap; the worst a bad one does is
make confirmation slower, never wrong.

**Additive, fully back-compat.** Omitting `scorer` reproduces the exact prior behaviour (default ===
`scoreInfluence`, identical args). No existing caller is affected. Runnable + tested example
`examples/observability/16-pluggable-scorer.ts`; new guide section in `docs/guides/contrastive-influence.md`.

### Fixed

- `loop-recall.ts`: corrected a stale field comment — `LoopCandidate.eligibility` documented a
  "forward-eligibility sum" but the shipped mechanism is the BACKWARD recency-weighted sum
  (`Σ_N recencyDecay^(lastLoop−N)·perLoop_N`). Comment-only; the field name is kept for back-compat.

## [6.36.0] - 2026-06-17

### Added — skill-graph v2 remainder: check-up, object form, route recorder, governors, relevance hint

**Build-time check-up.** `graph.checkup()` → `{ ok, problems }` inspects the declared graph
for wiring mistakes — an unreachable skill, an edge/entry to an unknown id, two un-prioritized
edges from one skill, no entry, a self-loop — _before_ you run. `.build({ check: 'throw' | 'warn'
| 'off' })` runs it at build (default `'warn'`: dev-mode console, silent in prod). Pure, no engine
change. New `skillGraphCheckup.ts`.

**Object-literal form.** `skillGraph({ skills, start, steps, tree?, check? })` — an alternative to
the fluent builder that lists `skills` INDEPENDENTLY of the wiring, so the check-up can catch a
listed-but-unwired skill (the fluent form only sees skills that appear in an edge). `start` is
`'id'` / `{ use }` / `{ rules }` / `{ entries, byRelevance }`. Translate-then-delegate; defaults
`check` to `'throw'`. New public types `SkillGraphConfig`, `BuildOptions`, `GraphCheckMode`,
`GraphCheckup`, `GraphProblem`, `GraphProblemCode`.

**`routeRecorder()`** (`agentfootprint/observe`) — records the skill path a run took, hop by hop
with a human-readable reason, by COMPOSING the shipped `context.evaluated` + `skill.rejected`
events (no engine change). `getPath()` / `getHops()` / `getRejections()`. New types `RouteHop`,
`RouteOutcome`, `RouteTrip`; `formatRouteHop`. Powers the lens / "Why this skill?" panel / route figures.

**Grey-area governors** (folded into the route recorder) — `getTrips()` reports oscillation
(`A→B→A→B` within `pingPongWindow`, default 4) and a run of consecutive rejected `read_skill`
jumps (`maxRejectedRetries`, default 3). Observability (`onTrip:'stay'`); a runtime force-stop is
a deferred follow-on (the iteration cap remains the hard stop).

**`defineRelevanceHint()`** — an advisory, anti-anchoring system-prompt note that fires at turn
start ONLY when `entryByRelevance`'s top entries are a near-tie ("a keyword scorer ranked these
close; it can't see the conversation — use your judgment"). Reads `ctx.entryScores` (now threaded
onto `InjectionContext`); rides `context.evaluated` (no new event). Add it explicitly via
`.instruction(defineRelevanceHint())`.

Designed + adversarially reviewed (panel), built tests-first (25 new); full suite 3123 green.

### Still proposed (NOT in this release)

- The agentThinkingUI **Description Doctor** (the red/green description-diff view) and two minor
  enrichments (a runtime governor force-stop; a `cursorBefore`/`cursorAfter` field on
  `context.evaluated`). See `docs/design/skill-graph.md`.

## [6.35.0] - 2026-06-17

### Added — skill-graph follow-ons: scoped `read_skill` + relevance entry routing (proposal 002 v2)

**Scoped `read_skill` (stay on the trail).** `read_skill('id')` is now rejected when `id` is not
reachable from the current cursor — closing the hole where the model could silently jump out of the
`from`-gated graph.

- New `graph.reachableSkills(currentSkillId)` (sibling to `nextSkill`): cold start → entry skills;
  otherwise → the cursor's direct successors ∪ entries \ {cursor}; a decision `tree()` returns all
  leaves (`read_skill` stays a full escape hatch there).
- Runtime gate at `toolCalls.ts`: an out-of-set `read_skill` is rejected with a re-prompt naming the
  allowed skills, the cursor + activations stay unchanged (the model re-picks), and an
  `agentfootprint.skill.rejected` event fires. **Plain `read_skill` agents (no skillGraph) are
  byte-for-byte unaffected** (the gate is off when no graph is mounted).

**`entryByRelevance(embedder)` — pick the starting skill by meaning.** Route the _entry_ by
embedding-similarity to the user's message instead of regex.

- Embeds the message + each `when`-passing entry's `description`, cosine-scores, softmaxes into a
  `relevance` share → starts at the best match. **LLM-free** (an embedder, no extra model call),
  reproducible given the embedder. Reuses the existing `Embedder` + `cosineSimilarity` + `mockEmbedder`.
- The ranking lands on `scope.entryScores` (snapshot / commit-log — the "Why this skill?" relevance %).
  New public types `EntryScore` / `EntryScoring`.
- Under `entryByRelevance` the entries are **exclusive** — only the picked one loads (token-efficient).
- The async embedder runs in a once-per-turn **`PickEntry`** stage mounted _off_ the ReAct loop (before
  the Injection Engine), so `nextSkill` and the route triggers stay synchronous (no async leak into the
  hot loop). Wired in both the flat and grouped charts.

Both features ride **optional** plumbing — agents without the relevant `.skillGraph()` calls are
unchanged. Designed + adversarially reviewed (panel), then built tests-first: `reachableSkills` unit +
property, the gate's real-loop functional/integration + back-compat regression, `softmax` + `scoreEntries`
units, and `entryByRelevance` real-loop tests across reactModes; examples 23 + 24. Full suite 3099 green.

### Still proposed (NOT in this release)

- Grey-area governors (oscillation / fallback-retry caps), the `RouteDecisionRecorder`, build-time graph
  validation, and the object-literal façade. See `docs/design/skill-graph.md`.

## [6.34.0] - 2026-06-17

### Added — skillGraph() `from`-gating keystone: a sticky-cursor skill state machine (proposal 002 v2)

- **`skillGraph()` route edges are now `from`-gated.** A skill graph is a state machine over skills; the
  engine tracks which node it is in via a persisted cursor `InjectionContext.currentSkillId`. An edge
  `A → B on tool X` now fires **only while the cursor is on A** — killing the v1 cross-skill "edge bleed"
  where the same edge also fired while in an unrelated skill D that produced X. (v1 documented `from` as
  informational and NOT enforced; this enforces it.)
- **One pure resolver is the single source of truth: `graph.nextSkill(ctx)`.** Cold start → the first
  matching `entry`; a `from`-gated route whose predicate matches `lastToolResult` → its target; else the
  current cursor (sticky stay). Each route target compiles to the trigger `nextSkill(ctx) === id`, which
  delivers `from`-gating + stickiness (you stay in a skill until an edge leaves it) + a clean handoff
  (the leaving skill deactivates the same iteration the next one activates). Each candidate predicate runs
  in its own try/catch (a throw = no-match, dev-warned) so one bad edge can't crash the loop.
- **The cursor advances inside the Injection Engine** with the SAME ctx the route triggers gate on, so the
  active set and the persisted cursor can never disagree (no off-by-one). Threaded across the flat
  (`buildAgentChart`) and grouped (`buildDynamicAgentChart` + `sf-llm-call`) mount mappers; reset per turn
  at seed (each turn re-enters via the entry router). Plumbed via `Agent` + `AgentBuilder.skillGraph()`.
- **Decision `tree()` graphs are unaffected** (they route per-iteration by stable `ctx` predicates, no
  cursor). Agents without a `skillGraph()` are unchanged (`currentSkillId` stays undefined).
- Reviewed by a 3-lens panel (verdict: SHIP WITH NITS — both high-risk properties confirmed against
  source); covered by per-reactMode (`dynamic` / `classic` / `dynamic-grouped`) real-loop e2e tests
  asserting route-firing AND edge-bleed prevention via the `agentfootprint.context.evaluated` emit.

### Changed

- **`AgentBuilder.skillGraph(graph)` now requires `graph.nextSkill`** (every `skillGraph().build()` supplies
  it). Pass the full `build()` result; for a bare skill list use `.skills({ list })`. Removes a stale-resolver
  footgun when two graphs are mounted.
- Route targets now compile to a cursor-gated `rule` trigger; the drawn edge kind (`on-tool-return` /
  `predicate`) is preserved for `toMermaid()`.

### Still proposed (NOT in this release)

- The runtime activation gate at `toolCalls.ts` (no `allowedSet` enforcement yet), the scoped `read_skill`
  enum, the `'score-match'` entry strategy, grey-area governors, the `RouteDecisionRecorder`, build-time
  validation, and the object-literal façade. See `docs/design/skill-graph.md`.

## [6.33.0] - 2026-06-16

### Added — tool-output provenance unblocks L4's cross-loop descent (proposal 008)

- **`assembleTrajectory` now surfaces each loop's proximate tool result** on a new WALK-ONLY
  `LoopFrame.proximateToolSource` field — the most recent `lastToolResult` committed before that
  loop's `call-llm`, with the PRODUCING loop's tool-calls stage as its `writerId` (the cross-loop
  provenance edge `walkToRoot` descends along). FLAT charts only; `proximate: true` marks it as an
  INFERRED edge (the call-llm read `history`, not this key — honest two-tier claim preserved).
- **`walkToRoot`'s descent now fires on a real flat agent.** Previously the trajectory surfaced only
  injection suspects, so the multi-hop cross-loop descent never fired; now it hops along the
  proximate tool edge from the symptom to the loop that produced it. Component-validated (the real
  trajectory carries the edge AND the algorithm descends on it; +2 tests). The end-to-end
  model-based misdirect gate (realistic embeddings) remains the final promotion measurement.
- **L3 is provably untouched.** The source is WALK-ONLY (NOT in `contextSources`), so
  `shortlistEarlyCulprits`'s narrow + its measured top-3 10/10 recall are unchanged.

## [6.32.0] - 2026-06-16

Per-loop context-bug localization: the trajectory now segments the GROUPED agent too, plus
two new pluggable localizer stages — L3 (recall shortlist) and L4 (the backtracking walk).
Requires **footprintjs ≥ 9.9.0** (the per-loop subflow commit retention).

### Added

- **`shortlistEarlyCulprits(trajectory, { embedder, recencyDecay })` (L3 — proposal 006)** — a
  per-loop RECALL shortlist that surfaces culprits the final answer buries (each source scored
  against the loop it fed, recency-weighted), to NARROW before ablation. It is a recall booster,
  **NOT a #1 ranker** (H2 measured the ranker as a loss). **Gate-validated**: the real scorer
  reproduces top-3 recall 10/10 vs plain 9/10 on the CTXBUG benchmark at the default
  `recencyDecay` 0.5. Joins 1:1 with a localizer `Suspect`; feeds `localizeContextBug({ shortlist })`
  as a REORDER-only narrowing hook. `localizeContextBug` gains the optional `shortlist` option.
- **`assembleTrajectory` now handles the GROUPED chart** (`reactMode: 'dynamic-grouped'`): each
  loop is projected PER-SCOPE over its own `sf-llm-call` inner commit log (retained per-iteration
  by footprintjs 9.9.0). Grouped frames carry `subflowScope`.
- **`walkToRoot(artifacts, { embedder, rerun })` (L4 — proposal 007)** — an influence-guided
  backtracking debugger: narrow (per-loop influence) → hop along `writerId` provenance → isolate
  with run-wide ablation, walking symptom → root for decision bugs. **Honest scope:** the walk
  ALGORITHM is validated synthetically (the deterministic decision-bug gate passes), but the
  multi-hop cross-loop DESCENT does NOT yet fire on a real agent — today's trajectory surfaces only
  injection suspects (the `call-llm` reads `history`, not `lastToolResult`), so on a real run it
  convicts the injection root at the symptom. Promoting the real-agent descent is gated on enriching
  the trajectory's tool-output provenance (follow-up). Exported with this limitation documented.

## [6.31.0] - 2026-06-15

### Added — contrastive influence: cancel the topical-innocent confound

- **`scoreContrastiveInfluence({ evidence, answerText, referenceText, embedder })`**
  — a SEPARATE, opt-in second stage over the four-signal scorer. Identical to
  `scoreInfluence` except the FA term contrasts answer-similarity against a
  reference output: `FA(e) = sim(e, answer) − sim(e, reference)`. A
  topically-central innocent (the policy a refund decision quotes) resembles BOTH
  the wrong and the right output, so it cancels (~0); the true culprit resembles
  the wrong output specifically, so it surfaces. Same `InfluenceScore[]` shape, so
  `rankingConfidence` + ablation compose unchanged.
- Honest scope: still an embedding-geometry PROXY, never causal — the contrast
  removes a confound, it does not prove causation (ablation is the causal tier).
  Opt-in: it needs a reference output, so it is for regression / eval debugging,
  not cold localization. Helps the CONTENT-class confound only — absence/crowding
  bugs stay `rankingConfidence` + `findDroppedContext` + ablation territory.
- New surface from `agentfootprint/observe`: `scoreContrastiveInfluence`,
  `ScoreContrastiveInfluenceArgs`. `assertValidWeights` is now shared by both
  scorers (caller-attributed errors) so contrastive enforces the same
  weight-validation contract as `scoreInfluence`.
- Benchmark result (CTXBUG, bge-small embedder): top-1 culprit accuracy on the
  content-bug classes (B1–B5) **87% → 100%**, recovering 2 topical-innocent cases
  with 0 regressions; full set incl. B6 absence bugs 76% → 88%.

13 tests (7-type coverage), example 11, `docs/guides/contrastive-influence.md`.
Focused review + fix; full suite 2997 green.

## [6.30.0] - 2026-06-11

### Added — restoration: the causal tier for the missing-context finder (interface #3)

- **`localizeContextBug({ missingContext })`** — pass what was `available` for the
  turn and what was `sent`; the report's new `dropped` lists units that never
  reached the model. Add a restoration `rerun` and each candidate gets a
  **restoration verdict** — the mirror of ablation: add the unit back, seeded
  re-runs, majority-flip on a stable baseline = `confirmed` (causal). Report gains
  `dropped` + `restorationBaseline`; an unstable un-restored baseline raises a
  `baseline-unstable` honesty flag. `formatContextBugReport` renders a MISSING
  CONTEXT section symmetric with SUSPECTS.
- New surface from `agentfootprint/observe`: `runRestorationProbe`,
  `RestorationRunner`, `RestorationRerun`, `RestorationProbeConfig`,
  `RestoredCandidate`. `verdictFor` gained an `action` param ('ablating' default,
  'restoring') — ablation claim strings unchanged.

The localizer now identifies a context error whether the culprit is PRESENT
(rank → ablate) or ABSENT (find → restore), each ship-a-default + bring-your-own.
Cost note: restoration confirmation calls your model `samples × (K+1)` times.
Example 10 extended; missing-context guide updated. 7-lens panel review; full
suite 2985 green.

## [6.29.0] - 2026-06-11

### Added — three interfaces for identifying a context error (`agentfootprint/observe`)

- **`rankingConfidence`** — honesty marker for an influence ranking. When no
  source clearly dominates (the signature of an absence/crowding bug
  output-similarity is blind to), it returns `clearWinner: false` with a
  `shortlist` to confirm by ablation, instead of a confident-but-wrong rank-1.
  Guarantees the lead — and, when there's no clear winner, the runner-up — are
  in the shortlist; robust to malformed scores.
- **Pluggable `ConfidenceStrategy`** — the decisiveness rule is swappable:
  `marginStrategy` (default, absolute gap) and `ratioStrategy` (scale-invariant,
  transfers across embedders), plus bring-your-own. Framework invariants hold
  under any strategy.
- **`findDroppedContext`** — missing-context finder (interface #3). Finds context
  that was available but never reached the model (`available − sent`, an exact
  O(n) id diff — no embeddings, no LLM); confirm a candidate by RESTORATION (the
  mirror of ablation). Closes the gap influence-ranking + ablation are blind to
  (a key unit truncated out of the window has nothing to ablate).

Each interface is ship-a-default + bring-your-own. New guides:
`docs/guides/ranking-confidence.md`, `docs/guides/missing-context.md`; examples
09–10. New tests across all 7 Convention-3 types; full suite 2967 green.

## [6.28.1] - 2026-06-11

### Docs

- README: the BacktrackView board and the conversational-doors section now
  link to the dedicated live playground page
  (`agentThinkingUI/demo/backtrack.html`) instead of the generic homepage,
  which only redirected to the runtime player. The doors are code-only (no
  UI page); their link is labeled as the _same evidence the board
  visualizes_, alongside the runnable `06`/`07`/`08` examples.

## [6.28.0] - 2026-06-11

### Added

- **The conversational doors over the trace toolpack** — ask the trace
  instead of reading it (`agentfootprint/observe` + the Agent builder):
  - **`traceDebugAgent({ artifacts, provider, model })`** — one call returns
    a ready dedicated debugger: toolpack mounted, the proven methodology
    (overview → drill by id → cite evidence → respect ⚠) as its system
    prompt. A separate session over a completed run — the B13 security
    posture, packaged — and the cheap-model story made real (a Haiku-priced
    session debugging a Sonnet run, paying only for what it opens, by id —
    ~9% of the trace in the example-01 fixture, widening with run size).
  - **`.selfExplain()`** on the Agent builder — the agent answers follow-up
    why-questions from its OWN previous completed run. Mounts one skill
    (methodology body only) + a `skillScopedTools` provider composed with
    the consumer's own, so the production catalog carries only the
    activation row until the LLM activates the skill — then the next
    iteration gains the trace tools. Evidence binds LATE at each run's
    terminal flush (a fresh per-run control-dep recorder is rotated so
    captured control edges survive Convention-4 resets) and can never see
    the in-flight run; failed runs capture too ("why did you fail?" works).
    `delegate: { provider, model }` switches the model at the why-point:
    one `explain_run` tool runs a nested `traceDebugAgent` at the
    delegate's price.
  - **`lazyTraceToolpack(resolve)`** — the toolpack with late-bound
    artifacts (template schemas pre-run, real index memoized per snapshot,
    honest model-visible answer before the first completed run).
  - **Tool-boundary honesty**: `trace_node` on the tool-execution step now
    marks the consumer-system boundary explicitly (args in / results out;
    internals not traced unless the tool returns its own diagnostic refs).
  - 16 tests across Convention-3 tiers; examples
    `07-trace-debug-agent.ts` + `08-self-explain.ts` (offline, with the
    per-call catalog transcript as the on-demand proof); guide section
    "The conversational doors".

## [6.27.0] - 2026-06-11

### Added

- **`toBacktrackTrace(report, opts)`** (`agentfootprint/observe`,
  `src/lib/context-bisect/toBacktrackTrace.ts`) — serialize a
  `localizeContextBug` report into the `BacktrackTrace` contract that
  agentThinkingUI's `<BacktrackView>`/`<BacktrackOverlay>` render (the
  "why?" board: suspects → influence meters → ablation stamps →
  chain-of-custody rewind). Pure mapping, no UI dependency; the
  interfaces mirror agentthinkingui's `types/index.d.ts` and both sides
  stay framework-agnostic JSON. Honesty preserved, never added: cards
  carry TRUE report ranks even as a subset (default selection prefers
  content-evidence suspects; the rest fold into one fully-disclosed
  line), path-only scores carry `upperBound` (hatched meter + starred
  value), `inconclusive` ablations map to NO verdict, honesty flags ride
  verbatim with the claims-discipline lines. The caller supplies the two
  things the report can't know: the decision's `answer` text (required)
  and optional `custody` panes of recorded state for the rewind player.
  Example: `examples/observability/06-backtrack-trace.ts`. README: "One
  contextual error, walked end to end".

## [6.26.1] - 2026-06-11

### Fixed

- **`agentfootprint/observe` was browser-broken since 6.25.0.** The tool-lint
  CLI (`src/lib/tool-lint/cli.ts`) had a top-level `import { readFile } from
'node:fs/promises'` and is re-exported by the `/observe` barrel, so any
  browser bundle importing `agentfootprint/observe` crashed at load. The
  import is now a lazy `await import('node:fs/promises')` at the one use
  site (file-reading only happens in the Node CLI path) — same pattern the
  audit exporter uses for `node:crypto`. Found by loading the playground in
  a browser; example 21's module-top `process.env` reads got the same guard.

## [6.26.0] - 2026-06-11

RFC-003 Part B (blocks D7–D9): the contextual-bug LOCALIZER — "git bisect
for context" (`agentfootprint/observe`, `src/lib/context-bisect/`). Pure
ASSEMBLY over shipped pieces: footprintjs 9.8.0's complete causal DAG
(control edges D3, honesty markers A2, `EdgeWeigher` hook A3, truncation
flags A4) × influence-core scoring (D6) × consumer-run counterfactual
ablation. No new typed events; no engine changes.

- **D7 — `llmEdgeWeigher({ embedder, llmCallIds, commitLog })`.** Turns an
  LLM call's parent hairball into a RANKED shortlist: each DATA edge whose
  child is an LLM call is weighted by influence-core's composite of the
  parent's WRITTEN content (the edge key's committed value) vs the child's
  OUTPUT (everything it committed). Two-pass adapter over footprintjs's
  synchronous `EdgeWeigher` hook: `prime(dag)` embeds in deduplicated
  batches and memoizes; `weigh` then answers synchronously — re-run
  `causalChain({ weigh })` to stamp the weights. Control edges and non-LLM
  children stay at the engine default 1.0 (a routing decision is not a
  content question). Deterministic: same artifacts + deterministic
  embedder → same ranking, ties keep slice (BFS) order; texts come ONLY
  from the commit log, so policy-redacted values reach the embedder as
  placeholders, never secrets. Acceptance pinned: a 12-parent hairball
  ranks verbatim-reuse first, digit noise last, identically across fresh
  handles.
- **D8 — `localizeContextBug({ artifacts, embedder, atStep?, trigger?,
rerun? })`.** The five-stage pipeline: (1) TRIGGER — explicit `atStep`,
  a custom strategy, or the `QualityRecorder`'s lowest-scoring step;
  (2) SLICE — `causalChain` with `controlDepRecorder` lookups (labeled
  `[control: rule]` hops) + A2/A4 honesty markers; (3) WEIGH — D7;
  (4) RANK — slice nodes classified into ablatable context sources
  (default classifier reads the agent chart's committed shapes:
  `*Injections` records → per-`Injection.id` suspects, `lastToolResult` →
  tool suspect, A2 `args` marker → arg suspect; pluggable `classify` for
  other charts) and scored `structural × semantic` (max-product path
  weight × per-item influence composite vs the trigger's output);
  (5) ABLATE — optional: a consumer-supplied `AblationRunner` re-runs the
  scenario without each top suspect, N seeded times each, against a
  baseline probe. **WITHOUT `rerun` the report stops at the ranking,
  marked `mode: 'correlational'`** — no causal claim anywhere (§B2).
  Report shape: `{ step, suspects: [{ source, kind, score, edgePath,
ablation?, verdict?, runs? }], sliceStats, honestyFlags, baseline? }` —
  every id is a plain runtimeStageId, drillable with the Part C
  trace-toolpack over the same artifacts bag. Honesty flags surface ⚠
  truncated slices, untracked sources, missing control-deps/read-tracking/
  llm-call-ids, and unstable baselines. `formatContextBugReport` prints
  the claim tiers in the output itself.
- **THE ABLATION SEAM (documented because it did not exist):**
  `AgentOptions` has no `ignoredTools` runtime kill-switch — tools,
  injections, and memory entries enter an agent at CONSTRUCTION. The
  counterfactual therefore rebuilds the agent from
  `applyAblations(specs, { tools, injections, memoryEntries })`-filtered
  inputs inside the consumer's runner. Per-kind adapters
  (`ablationForSuspect`): tool → `ignoredTools`, injection/fact/skill →
  `excludeInjectionIds`, memory → `excludeMemoryIds`, arg → consumer
  override note (run input cannot be filtered by the library).
- **D9 — `bisectCulprits({ suspects, rerun, embedder })`.** Multi-culprit
  bisection over the ranked set (two-way ddmin with interference
  handling + an independent-culprit loop): finds MINIMAL suspect sets
  whose joint ablation flips the outcome. Every probe = N seeded reruns
  (`samples` clamps to ≥ 2 — never single-run verdicts) with similarity
  mean ± stdev ALWAYS reported; probes are cached by spec-set and
  budgeted (`maxProbes`); honest exits: `'not-reproducible'` (the full
  ranked set never flips), `'inconclusive'` (unstable baseline or budget
  exhausted). Verdicts/culprits are the ONLY causal claims — the ranking
  merely chooses the search order.
- **Honest-claims discipline (§B2), spelled out on every type:** weights
  and scores are deterministic embedding-geometry PROXIES (semantic
  alignment, never model internals, never causal attribution); slice
  completeness is bounded by tracking and the report SAYS so; ablation
  verdicts are the only causal tier. Falsifiable validation pinned in
  `test/lib/context-bisect/validation.test.ts`: across three planted-bug
  scenarios, ablating the top-ranked suspect flips the outcome strictly
  more often than the bottom-ranked (3 vs 0 with the fixtures).
  Calibration note: `mockEmbedder` compresses prose to ~0.85–0.97 cosine —
  use a DOMAIN `outcomeChanged` comparator with it; absolute similarity
  thresholds only with real embedders.
- Example: `examples/observability/05-context-bisect.ts` — a planted
  misleading FACT injection ('VIP tier override') makes a refunds agent
  approve a 47-day-old refund; the localizer finds it as the top ablatable
  suspect and CONFIRMS it via ablation (3/3 seeded reruns flip
  APPROVED → DECLINED; benign fact + lookup tool come back
  not-confirmed). Part 2: the credit fixture — labeled control edges on a
  plain decide() chart in honest correlational mode. 47 new tests across
  unit/functional/integration/property/security/performance/load +
  falsifiable validation.

## [6.25.0] - 2026-06-11

RFC-002 tiers 1–2 (blocks C1–C6): the tool-catalog confusability LINT
(build-time, CI-gateable, framework-agnostic — the adoption front door) +
the runtime tool-choice MARGIN RECORDER. Both are policy layers over the
6.24.0 `influence-core` engine (`pairwiseSimilarity` / `scoreMargin` /
`EmbeddingCache`); tier 3 (choice-entropy proxy validation) remains
specified-only.

- **C1 — `analyzeToolCatalog(tools, opts)`** (`agentfootprint/observe`,
  `src/lib/tool-lint/`). Input is a plain
  `{ name, description?, inputSchema? }[]` — ZERO stack buy-in
  (`coerceCatalog` normalizes OpenAI / Anthropic / MCP `tools/list` /
  plain shapes; `catalogFromTools` adapts the library's own `Tool[]`).
  Pairwise cosine over `confusabilityText` (tokenized name + description —
  what the model actually reads) via influence-core: pairs ≥
  `confusabilityThreshold` → `confusable` (fail the gate), pairs within
  `watchBand` below → `watch` (advisory). Each flagged pair carries a
  heuristic `hint` naming the differentiating axis (twin-name qualifier,
  or each side's distinct description terms). The report carries the FULL
  ranked pair list — the relative-ordering view that stays meaningful
  under any embedder. Duplicate tool names are a built-in structural
  error (deduped before similarity).
  **Calibration honesty (RFC-002 §3):** `DEFAULT_CONFUSABILITY_THRESHOLD`
  (0.85) is a real-embedder starting point; the test/demo `mockEmbedder`
  compresses prose into ~0.85–0.97, so `MOCK_EMBEDDER_CALIBRATION`
  (0.94/0.02) applies with the mock and only RELATIVE ordering is
  trustworthy — acceptance fixtures assert ordering, never absolute
  scores (the Neo fcns twins are each other's mutual top-1 partner and
  flag confusable; a known-false-positive pin documents the mock's floor).
- **C2 — pluggable structural rule pack** (`defaultStructuralRules` +
  factories `descriptionRule` / `saysWhatNotWhenRule` / `enumInProseRule`
  / `optionalParamRule`; rules are plain `{ id, check }` objects —
  add/remove/re-tune freely). Four field findings from the Neo catalog:
  missing/short description (<40 chars; missing = the only default
  `error`), says-WHAT-not-WHEN (no `for/when/after/first/fallback/only`
  cue), enum-in-prose (`"avg_iops | peak_iops | mbps"` → suggests the
  JSON-Schema `enum`; comma lists only behind an explicit "one of"-style
  marker so `e.g. 1h, 24h` examples don't flag), and
  optional-param-undocumented (omission has meaning, nothing says so).
  One fixture catalog per rule in `test/lib/tool-lint/rules.test.ts`.
- **C3 — CI gate.** `report.ok` (no confusable pairs + no structural
  findings at/above `failOn`, default `'error'`) + new bin
  **`agentfootprint-lint-tools`** (`bin/agentfootprint-lint-tools.mjs`,
  humble shell over the unit-tested `runToolLintCli`): reads ONE JSON
  file of tools, prints the report, exits 0/1/2 (ok / gate failed /
  usage error). Flags: `--threshold` (similarity gating is OPT-IN — the
  CLI's built-in mock embedder is rank-trustworthy, not
  verdict-trustworthy; without the flag similarity is report-only),
  `--watch-band`, `--strict`, `--no-similarity`, `--top`, `--json`.
  Embedding cost on re-lints: wrap your embedder in `embeddingCache`
  (content-hash keyed, from influence-core). FRONT DOOR:
  `docs/guides/tool-catalog-lint.md` (written for non-footprintjs users
  — 5 minutes from a `tools.json` to a gated CI check) + a README
  section.
- **C4 — choice-context construction** (`buildChoiceContext`, exported).
  The margin scorer embeds exactly the two slots the model's
  tool-selection reasoning ran on: the current turn's user message
  (head-capped) + the latest assistant reasoning text of the turn
  (tail-capped; absent on iteration 1). Deliberately EXCLUDED and
  documented: system prompt (constant per run — dilutes without
  discriminating), older history turns (recency dominates choice), raw
  tool results (their distilled effect is the included assistant text),
  tool schemas (those are the candidates, not the context). Candidate
  text per offered tool = the SAME `confusabilityText` the lint embeds,
  so build-time confusability and runtime margins measure one geometry.
- **C5 — `toolChoiceRecorder({ embedder })`** (`agentfootprint/observe`,
  `src/recorders/observability/ToolChoiceRecorder.ts`). A normal
  CombinedRecorder (Convention 1: owns a `KeyedStore<ToolChoiceEntry>`
  keyed by the LLM call's `runtimeStageId`) — attach via
  `Agent.create(...).recorder(...)`; deferred-tier friendly
  (`{ delivery: 'deferred' }` works unchanged). Per LLM call that
  OFFERED tools: menu from `stream.llm_start.tools`, chosen from the
  `stream.tool_start` events of that call (parallel + repeat calls
  visible via `toolCallIds`; `chosen` dedupes by name), context from
  `agent.turn_start` + the previous `stream.llm_end`. **Embeds LAZILY on
  first read** (`getCalls()` / `getFlagged()` / `getSummary()`) — the
  hot path only records strings; scores memoize; open entries (mid-run)
  stay unscored until they close. Convention-4 runId reset via
  `onRunStart`; same-executor `resume()` preserves pre-pause entries by
  design. Unscorable entries carry `skipped`:
  `'nothing-chosen'` (final-answer calls) or `'chosen-not-offered'`
  (wiring anomaly, surfaced not massaged).
- **C6 — `getFlagged()` + run summary.** Flagged = `narrow`
  (margin < `marginThreshold`, default 0.05) OR `proxyDisagreement`
  (top-scored candidate not among the chosen — ALWAYS flagged).
  `getSummary()` → `{ llmCallsWithTools, choices, scored, flagged,
narrow, proxyDisagreement, skipped }`.
- **Examples (Convention 2)** — all offline/deterministic, pinned by
  `test/lib/tool-lint/examples.test.ts`:
  `examples/observability/02-lint-confusable-catalog.ts` (the real
  16-tool Neo fixture in `examples/helpers/neoToolCatalog.ts`; the fcns
  twin pair flagged with its hint + the metric/optional structural
  findings), `03-lint-fix-and-pass.ts` (fail → rewrite descriptions to
  lead with WHEN + real enum + documented optionals → `ok` under the
  SAME thresholds in strict mode), `04-tool-choice-margins.ts` (scripted
  agent walks into the twin trap; margins/flags printed; counting
  embedder proves 0 embeds during `run()`).
- **Tests:** 85 new (rule fixtures, verdict policy via exact-geometry
  planted embedders, Neo relative-ordering acceptance, CLI exit codes +
  shape coercion, property fuzz over report invariants, security
  (hostile/giant descriptions; tool results never reach the embedder),
  performance (100-tool lint < 2 s; record-only hot path), load
  (300 tools / 44 850 pairs), recorder unit tests on REAL engine event
  shapes, lazy-embed + memoization proof, runId reset, parallel tool
  calls, real-Agent functional run).
- NO new typed events (anti-drift): the recorder consumes the existing
  emit stream; the lint is build-time only.

## [6.24.0] - 2026-06-11

footprintjs floor raised to ^9.8.0 (the toolpack consumes RFC-003 Part A: controlDepRecorder, control edges, honesty markers, commitValueAt).

- **`influence-core` — the ONE embedding-based scoring engine (RFC-002/003
  block D6).** New leaf module `src/lib/influence-core/`, exported from
  `agentfootprint/observe`. Extracts the Visible Reasoning paper's FDL
  influence scoring (Eq. 1–6) into named, individually-exported scorers so
  three consumers share one engine and one embedding cache: RFC-002's
  tool-catalog lint (C1) + margin recorder (C4/C5), RFC-003 Part B's
  LLM-edge weigher (D7), and the FDL paper pipeline itself. Extraction +
  module design only — no RFC-002/003 features ship yet.
  - **Four signal scorers + composite** (`finalAnswerSimilarity`,
    `averageRelevancy`, `persistence`, `structuralProximity`,
    `compositeScore`, `adaptWeights`) — the paper's FA/AVG/PERSIST/DEPTH
    with default priors 0.40/0.30/0.20/0.10 and per-item Eq. 6 adaptive
    redistribution (no-ancestor items → α′=0.80/δ′=0.20). `scoreInfluence`
    orchestrates embed → score → rank in one deduplicated pass.
  - **`EmbeddingCache`** — content-hash-keyed (`contentHash`, FNV-1a)
    transparent `Embedder` decorator: bounded LRU (`maxEntries`, default 1024) with VISIBLE eviction/hit/miss counts via `stats()` (the
    bounded-honesty convention), single-flight coalescing for concurrent
    embeds, batch-aware partial misses; rejections never cached. One cache
    instance threads through lint + margins + influence weights (RFC-002
    §3).
  - **`pairwiseSimilarity`** (RFC-002 C1's core) — text set → symmetric
    cosine matrix (diagonal exactly 1 by definition) + ranked pairs.
  - **`scoreMargin`** (RFC-002 C4's core) — (candidates, contextText,
    chosen) → ranked scores, `margin` = score(best chosen) − score(best
    non-chosen), `narrow` / `proxyDisagreement` flags (default threshold
    0.05). Pure function; recorder wiring is C5, later.
  - **Honest-claim discipline (RFC-002 §2)** documented on every scorer:
    all scores are deterministic embedding-geometry PROXIES — semantic
    alignment, never model internals, never causal attribution, not
    additive across items.
  - **One embedder contract:** re-exports the existing
    `Embedder`/`mockEmbedder` adapter interface from `memory/embedding` —
    no second embedder type. Leaf module: zero agent/runtime imports.
  - **D6 parity acceptance:** goldens created FROM an independent
    transcription of paper Eq. 1–6 (the pipeline previously existed as the
    published equations + the embedder machinery; no executable goldens);
    the module reproduces them to 1e-12 and matches a live in-test
    reference recomputation, including fractional-PERSIST and
    adaptive-weight cases. Example: `examples/features/22-influence-core.ts`.
- **Introspection toolpack — `traceToolpack(artifacts)` (RFC-003 Part C,
  `agentfootprint/observe`).** footprintjs trace evidence exposed as TOOLS an
  LLM calls: a debugging model (cheap, in a SEPARATE session) navigates a
  COMPLETED run's evidence by `runtimeStageId`s instead of reading dumps —
  feed the slice, not the trace. Factory over frozen artifacts
  (`executor.getSnapshot()` + optional `controlDepRecorder().asLookup()` +
  optional narrative lines); returns plain `Tool[]` — mount on any Agent or
  drive scripted via the new `callTraceTool` (the offline auditor pattern,
  mirroring the #9 validation boundary).
  - **The tools:** `run_overview` (the entry point: stages with id + name +
    description, loops, error locations, honesty notes) · `trace_node`
    (one step: writes with verb + bounded preview + true size, reads,
    parents with the routing decision's rule label) · `trace_slice` (the
    backward causal chain with `[control: rule]` edges, as an indented tree
    of drillable ids) · `who_wrote` (last writer of a key, optionally
    before a step) · `get_value` (the explicit full fetch, capped +
    truncation-marked) · `read_narrative` (paginated story; only when
    narrative provided).
  - **Bounded by default, honest always:** every output capped; per-call
    params clamp to `TOOLPACK_HARD_CAPS`; truncated slices, untracked
    sources (args/env/silent), missing read tracking / controlDeps, and
    values outside the commit log are ⚠-marked, never silent. Redacted
    payloads pass through verbatim and are flagged `(redacted by policy)`.
  - **#9 synergy:** small runs embed an `enum` of every real step id in the
    schemas (garbage ids rejected before dispatch, model self-corrects);
    key params deliberately carry NO enum so "key outside the commit log"
    gets its honest answer. Bad ids that get through return corrective
    messages naming the real executions.
  - **The demo** (`examples/observability/01-trace-debug-session.ts`): a
    planted wrong value (DTI computed against annual income) flows through
    a decide() decision; a scripted debugger session finds the culprit in
    8 tool calls — ~2.7K chars served vs a ~29K-char full dump (~9%).
  - **Security posture (B13):** serve to a separate debug session over a
    completed run, not the production agent mid-run — trace content can
    carry adversarial text; see docs/guides/trace-debugging.md.

## [6.23.0] - 2026-06-11

- **Deferred observer delivery — `AgentOptions.observerDelivery: 'inline' |
'deferred'` (RFC-001 Block 10; closes RFC-001).** Opting in routes the
  Agent's internal bridge recorders (Context, stream, agent, error, cost,
  permission, eval/memory/skill/tools, validation, reliability) AND consumer
  `.recorder()` / `agent.attach()` recorders through footprintjs 9.6.0's
  bounded capture queue: capture inline (≈ µs/event, `'clone'` payloads —
  the same event shape as inline), delivery one beat behind at the next
  microtask checkpoint, synchronous terminal drain at run resolve / reject /
  pause. Compatibility bar tested hard: `agent.on()` listeners receive
  deep-equal typed events (type + payload + stage anchor, same order) vs
  inline; crash `RunCheckpointError` history and `error.fatal` stay complete;
  pause returns with the pre-pause record delivered. Default `'inline'` is
  byte-identical to 6.22.0 — no queue allocated, `observerStats` absent.
  - **Kept inline for correctness:** the causal-evidence recorder (CAUSAL
    memories) — the memory write stage consumes `collect()` MID-run, so it
    never rides the queue (pinned by test: snapshots persist real evidence
    under `'deferred'`).
  - **Per-recorder override:** a consumer recorder declaring its own
    `delivery` field keeps it; the agent option is the default tier for
    recorders that don't declare one.
  - **`AgentOptions.observerDeliveryOptions`** (`capture` / `maxQueue` /
    `overflow` / `sampleEvery` / `flushBudgetMs`) forwards the queue dials;
    setting it without `observerDelivery: 'deferred'` throws at build time
    (no silently-ignored combinations).
  - **`agent.drainObservers({ timeoutMs })`** — settle async listener
    continuations before serverless freeze / shutdown (RFC-001 §11); zeros
    before the first run. `ObserverDeliveryOptions`, `ObserverDrainResult`,
    `ObserverStats` exported from the main barrel.
  - **The bench number** (50-iteration full-feature agent, 3 747 events,
    deliberately slow 5 ms-per-event wildcard listener, 100 ms mock LLM
    latency; `examples/features/21-deferred-observers.ts`): no-listener
    floor 5.6 s · inline 24.5 s · deferred 24.0 s at back-to-back streaming
    (`chunkDelayMs: 0`, worst case for overlap); at a realistic 20 ms
    streaming cadence inline 34.8 s · deferred **32.1 s (−2.7 s wall, −8%;
    p95/iter 926 → 868 ms)** with `drops: 0`, `terminalStranded: 0`. Honest
    mechanism documented: single-thread work is conserved; deferral recovers
    the wait-ADJACENT share (llm_start/tool_start/token events), and the
    guarantees that don't depend on shape are the bounded queue, error
    isolation, per-listener stats, and terminal completeness.
- **Fixed: typed event payloads carried live scope proxies.**
  `agentfootprint.agent.iteration_end` embedded `scope.history` (a TypedScope
  deep-Proxy view) and the tool-calls handler embedded the
  `scope.llmLatestToolCalls` proxy into history messages and `tool_start`
  args. Live proxies are not structured-clone-safe — under `'deferred'` the
  'clone' capture degraded to a summary and the EmitBridge dropped the typed
  event; inline consumers were silently handed a mutable view of engine
  state. Payloads now use the plain local arrays (value-identical), and
  `typedEmit` gained a dev-mode (`enableDevMode()`) guard that warns once per
  event type when a payload is not structured-clone-safe.

## [6.22.0] - 2026-06-11

- **`agentCoreIdentity` forwards per-request identity (workload identity
  scoping)** — closes the deferred 6.11.0 gap where the AgentCore adapter
  ignored `req.identity` (the `runIdentity` that toolCalls already threads
  into every `getCredential`). Verified against the AWS API reference:
  `GetResourceOauth2Token` carries NO user/tenant field — AgentCore binds the
  user at workload-token acquisition — so the adapter now exchanges
  `(workloadName, userId)` via `GetWorkloadAccessTokenForUserId` for a
  USER-SCOPED workload access token and vends `mode: 'user'` requests with it
  (AgentCore keys its token vault + 3LO grants per workload+user). Opt-in via
  the new `workloadName` option; default `userId` = `identity.principal`,
  overridable via `userIdFor` (e.g. tenant-qualified `${tenant}:${principal}`
  — `tenant` has no native AgentCore field and is not forwarded by default).
  Fail-closed: configuring `workloadName` with a client lacking
  `getWorkloadAccessTokenForUserId`, or an exchange returning no token,
  throws — never silently degrades to workload-level tokens. Without
  `workloadName` the static `workloadIdentityToken` flows byte-identically to
  before (no behavior change for existing configs). `_client` test seam
  extended with the optional second method; 8 tests including an end-to-end
  `agent.run({ identity })` → declare-and-push → AgentCore-receives-userId
  chain.

- **`withCredentialRetry` — transient credential failures retry before
  failing closed** (`agentfootprint/identity`): a `CredentialProvider`
  decorator mirroring the LLM-provider `withRetry` — same option vocabulary
  (`maxAttempts`/`initialDelayMs`/`backoffFactor`/`maxDelayMs`/`shouldRetry`/
  `onRetry`) and the same shared default transience policy (retry 5xx/429/
  network/unknown; never AbortError or other 4xx — AgentCore's documented
  retryable errors, `InternalServerException` 500 + `ThrottlingException`
  429, retry out of the box). Only THROWN errors retry: `issued` and
  `authorization-required` (3LO consent is a human flow, not a fault) return
  immediately. After retries exhaust, the last error is rethrown — fail-closed
  behavior at the tool-dispatch site is byte-identical to an unwrapped
  provider (`credential.failed` + error tool result; the tool never runs).
  Per-attempt visibility is consumer-wired via `onRetry` (the established
  decorator contract; the `error.*` event family stays reserved for
  decorators — NO new event types). Design note: the rules-based reliability
  subsystem is LLM-call-scoped (`ReliabilityScope.request: LLMRequest`; gate
  chart around CallLLM) — extending its rule vocabulary to credential
  resolution is the deferred `sf-credential` gate node, an M+ change; the
  decorator is the honest transport-level home for retry until then.
  13 tests (Convention 3); `examples/features/17-identity.ts` now simulates a
  vault blip and shows `credentialRetries: 1`.

## [6.21.0] - 2026-06-11

- **B16 — circuit-breaker scope design choice documented (feature
  deferred)**: `withCircuitBreaker` is provider-level, not per-tool, by
  design — a provider outage is every run's heartbeat at full QPS, while
  tool throws are caught and fed back to the model as tool results, so the
  ReAct loop absorbs and adapts within the iteration budget. The
  `withCircuitBreaker` module header and orchestration guide now state the
  rationale plus today's escape hatches (wrap a tool's `execute` yourself;
  hide a failing tool mid-run via a `gatedTools` predicate). First-class
  per-tool breakers remain a possible future enhancement. Docs-only.
- **B15 — `Loop.until` string contract documented (feature deferred)**:
  the guard's `latestOutput: string` is by design — the core-flow layer
  composes `Runner<{message: string}, string>` and the Loop chart coerces
  non-string body output to `''`. JSDoc on `UntilGuard` / `.until()` now
  documents the contract, the structured-exit workaround (body emits JSON,
  guard parses), and why a typed `Loop<T>` guard is deferred (it requires
  genericizing the Runner output contract shared by Sequence / Parallel /
  Conditional — an M+ design change, out of scope for a minor).
- **B13 — prompt-injection security guide**
  ([docs/guides/prompt-injection.md](docs/guides/prompt-injection.md)):
  documents the honest posture — core does NOT detect prompt injection;
  `PermissionPolicy` gates _which_ tools, not _why_ the model called them.
  Maps the untrusted-text entry points (user message, tool results,
  persisted causal-memory replay, `on-tool-return` trigger predicates,
  `read_skill`), the containment layers that exist in source (visibility
  gating, fail-closed execute-time checker with sequence awareness, #9
  args validation's never-echo-values property, declare-and-push
  credential scoping, evidence events + audit export), what core
  deliberately does not do (no classifier/scanner; redaction is opt-in),
  and recommended external guards. Cross-linked from security.md and the
  guides index. Every claim grounded in source at write time.
- **B14 — `humanizeLLMError` per-provider-SDK fallthrough tests** (+2 regex
  gaps fixed): pinned the real error formats of `@anthropic-ai/sdk` /
  `openai` v4-v5 (Stainless) / `@aws-sdk/client-bedrock-runtime` v3 / the
  in-repo browser adapter `wrapStatus` shape — 16 new tests so an SDK-major
  message-format drift surfaces as a test diff, not a silent UX regression.
  Two real misses fixed while pinning: Stainless `APIConnectionError`
  ("Connection error.", no status) now maps to the network bucket, and
  Bedrock `AccessDeniedException` ("You don't have access to the model…",
  status only under `$metadata`) now maps to the auth bucket — both
  previously fell through to the generic message. Deliberate fallthroughs
  (Bedrock `ValidationException`/`ServiceUnavailableException`, user abort)
  are pinned as raw-preserving generic.
- **B12 — resume idempotency documented (accuracy-vs-source pass)**:
  `agent.resumeOnError()` docs now state the replay semantics prominently —
  resume restores ONLY conversation history; the failed iteration's tool
  calls may be re-issued by the model and re-execute (mutating tools must
  be idempotent, keyed on stable call content). Fixed three doc-lies found
  against source: there is NO "v2.10.3+ toolCallId dedup"
  (runCheckpoint.ts header), `checkpoint.runId` is NOT reused on resume
  (fresh `runId` per resumed run), and the resumed run re-seeds
  `iteration = 1` with a full budget (`lastCompletedIteration` is
  diagnostic-only). Docs-only; no behavior change.
- **B11 — `skillGraph.tree()` dev-mode "exactly one leaf fires" monitor**:
  in dev mode (footprintjs `enableDevMode()`), compiled tree-leaf triggers
  tally fires per evaluation pass and `console.warn` when 0 or ≥2 leaves
  fire — the symptom of an impure/non-deterministic `decide()` predicate
  (the tree is exhaustive by construction; predicates are re-evaluated per
  leaf). Production behavior unchanged (one `isDevMode()` check per
  evaluation; the monitor observes, never alters activation).

## [6.20.0] - 2026-06-10

**#18/#14: `AgentOptions.readTracking` — the snapshot observability-cost
lever, exposed from the Agent** (+ long-run memory re-measured against
footprintjs 9.3.0's #13b staging-release).

- **`AgentOptions.readTracking: 'full' | 'summary' | 'off'`** — forwarded
  to the Agent's internal `FlowChartExecutor` (which previously received
  no options, leaving footprintjs's #14 lever unreachable from the
  Agent). Controls how `getSnapshot()` records per-stage reads in
  `StageSnapshot.stageReads`: cloned values (`'full'`), cheap
  `ReadSummaryMarker`s (`'summary'`), or nothing (`'off'`).
  `ReadTrackingMode` + `ReadSummaryMarker` re-exported from the main
  barrel so consumers don't need a direct footprintjs import.
- **⚠ Behavior change (default `'summary'`)**: the Agent's executor now
  defaults to `'summary'` — NOT footprintjs's own `'full'` default. In
  `agent.getSnapshot()`, `stageReads` entries are now
  `{ __readSummary: true, type, size?, preview? }` markers instead of
  cloned values. Measurement-gated decision (#18): `stageReads` values
  have ZERO consumers across agentfootprint, agentfootprint-lens, and
  explainable-ui (re-verified by grep at change time), while `'full'`
  retains ~28MB@200 / ~170MB@500 iterations of unread clones. Narrative,
  recorder events (`onRead` payloads), commit log, and shared state are
  IDENTICAL in every mode — only the snapshot's `stageReads` payload
  changes shape. If you inspect read VALUES from snapshots, opt back in:
  `Agent.create({ ..., readTracking: 'full' })`.
- **footprintjs floor: `^9.0.0` → `^9.1.0`** (peer + dev) —
  `readTracking` ships in footprintjs 9.1.0.
- **Long-run memory re-measured** (#18 replication, full-feature agent —
  steering + fact + skill + tool, mock provider `chunkDelayMs: 0`,
  heapUsed after `global.gc()`, 2GB heap cap, footprintjs 9.3.0):

  | Config                                | N=200   | N=500    | N=1000   |
  | ------------------------------------- | ------- | -------- | -------- |
  | #18 baseline (fp 9.0.0-era, `'full'`) | 563.8MB | OOM @2GB | —        |
  | fp 9.3.0 + `'full'`                   | 159.7MB | 917.7MB  | —        |
  | fp 9.3.0 + `'summary'` (new default)  | 132.2MB | 747.6MB  | OOM @2GB |
  | fp 9.3.0 + `'off'`                    | 131.9MB | 747.1MB  | —        |

  The #13b staging-release is the dominant win (563.8 → 159.7MB @200,
  3.5×; N=500 now completes instead of OOM). `readTracking: 'summary'`
  saves a further ~17% @200 / ~19% @500 on top. `'off'` ≈ `'summary'`
  (markers are near-free). Growth remains quadratic (#13c residual:
  commitLog + `_stageWrites` clones) — N=1000 still exceeds a 2GB heap
  (~3GB projected), and per-iteration latency still climbs (≈4ms
  first-10 → ≈110ms last-10 @500). Wall @200 ≈ 4.8s.

- **`iterations-unlocked` RSS budget tightened 1500 → 350MB** — worst
  observed RSS delta over 5 local runs post-#13b + `'summary'` default
  is 210MB; budget = 1.6× worst ≈ 335MB, rounded up for CI variance.
  The budget is now a real regression tripwire instead of a 7× ceiling.

### Fixed

- **Causal snapshots no longer overwrite across turns of one
  conversation.** Previously, every `agent.run()` re-seeded
  `turnNumber = 1` and `writeSnapshot` used the id `snap-{turnNumber}`
  verbatim, so turn 2 of the SAME conversation silently replaced turn 1's
  snapshot — the earlier turn's decision evidence was destroyed. This
  affected every multi-turn causal-memory conversation (including the
  canonical loan-officer example and `examples/memory/06`); the #21
  lighthouse example worked around it by exporting per turn.
  `writeSnapshot` now derives the effective turn from the store:
  `max(scope.turnNumber, maxStoredSnapshotTurn + 1)`, where
  `maxStoredSnapshotTurn` is the highest live `snap-{n}` in the
  conversation's namespace. Consequences:
  - consecutive turns persist distinct, ordered snapshots
    (`snap-1`, `snap-2`, …) — within one Agent instance, across Agent
    instances sharing a store, and across processes (the store namespace
    `identityNamespace(identity)` is the durable conversation anchor;
    an in-process counter could not have fixed the cross-instance /
    cross-process cases);
  - hosts that track `turnNumber` correctly keep their numbering
    (`turnNumber: 5` → `snap-5`, gaps preserved) — the derivation only
    overrides a counter that is provably stale against the store;
  - single-turn consumers are unchanged (`snap-1`, byte-identical ids);
    no existing test needed changes;
  - trade-off, on purpose: a host that deliberately re-runs an
    already-snapshotted turn N with `turnNumber = N` now appends
    `snap-{N+1}` instead of overwriting `snap-{N}`. Causal snapshots are
    decision evidence (audit/replay data) — when a stale counter and a
    deliberate rewrite are indistinguishable, never destroying a prior
    turn's evidence wins. (`writeSnapshot` never documented overwrite
    semantics; `writeMessages`' idempotent-id contract is untouched.)
  - note: the underlying `turnNumber` re-seed in the Agent's seed stage
    still exists and remains a follow-up for the other write-side stages
    (`msg-{turn}-{index}` ids share the same latent class).

### Added

- **`flowchartAsTool` `recorders` option** — closes the #21-lighthouse
  observability gap: the tool builds its `FlowChartExecutor` internally,
  so decide()/select() evidence inside a tool-mounted flowchart could not
  reach the agent's evidence recorders (the #5 causal
  `causalEvidenceRecorder()` bridge, the #19
  `otel.decisionEvidenceRecorder()`). New
  `recorders?: ReadonlyArray<CombinedRecorder>` attaches each entry to
  the internal executor via `attachCombinedRecorder` before every run —
  routed by method-shape detection, so one array covers all three
  observer channels (scope data-flow, control-flow, emit).
  Per-invocation semantics: the tool constructs a FRESH executor per
  call and attaches the SAME recorder instances to each one — a shared
  stateful recorder accumulates events from every invocation; each
  invocation carries a fresh `runId` (Convention 4) for per-invocation
  bookkeeping. The `20-regulated-decisioning` example keeps its
  hand-mounted chart (it predates the hook and demonstrates the manual
  wiring); new code should pass `recorders` instead.

## [6.19.0] - 2026-06-10

**#21: the compliance-wedge lighthouse example** — completes the wedge
(#19 GenAI spans, #20 tamper-evident audit export, #5 causal memory).
Example-only; no library code changes.

- **`examples/features/20-regulated-decisioning.ts` (+ paired `.md`)** —
  a regulated loan-decisioning agent that answers _"why was applicant
  A-1043 declined three weeks ago?"_ from stored evidence, offline. One
  run, three compliance artifacts from the same typed event stream:
  - the agent declines an application under **labeled footprintjs
    `decide()` rules** (the lending policy is a flowchart mounted inside
    the `adjudicate_application` tool; per-rule evidence —
    `dti gt 0.43 → 0.52 (true)` — is captured during traversal), with a
    **permission denial** (data-minimization policy) and a **#9
    validation rejection + model self-correction** in the same chain;
  - `auditExport` + `otelObservability` attach in parallel (multi-
    strategy), the audit bundle is **drained per turn** and persisted
    with an **external anchor of BOTH chain ends** (finalHash + genesis
    identity) per the documented threat model;
  - an exported AUDITOR function loads ONLY the persisted JSON (no
    agent, no provider, no LLM), re-verifies the chain, cross-checks the
    anchor, and reconstructs the decision story as a human-readable
    audit narrative — then a flipped byte in the stored permission
    denial is caught and **named by record seq**.
- **Fix**: `examples/features/18-otel-genai.ts` no longer fails
  `tsc -p examples/tsconfig.json` (the `decide(scope as never, …)` cast
  inferred `WhereFilter<never>` and rejected the filter literal; now
  casts to the chart's state shape).
- **Library follow-ups found (reported, not hacked around in src/)**:
  (1) causal snapshots overwrite across turns — the agent seeds
  `turnNumber = 1` every `run()` and `writeSnapshot` ids are
  `snap-{turn}`, so a conversation's later turn replaces the earlier
  snapshot (the example exports the snapshot per turn as a workaround);
  (2) `flowchartAsTool` has no recorder hook, so decide() evidence
  inside a tool-mounted flowchart can't reach the agent's causal
  evidence recorder or the OTel decision-evidence bridge — the example
  mounts the policy chart by hand and ships an example-level evidence
  ledger file instead.

## [6.18.0] - 2026-06-10

Minor — **#20: tamper-evident audit export** (second item of the
compliance wedge; consumes the same typed event stream #19's spans are
built from — EU AI Act Art. 12 record-keeping is the target shape).

- **`auditExport()`** (`agentfootprint/observability-providers`) — an
  ObservabilityStrategy that hash-chains every typed event into an
  append-only audit log: one `AuditRecord` per event
  (`{ seq, timestamp, eventType, payload, meta, prevHash, hash }`,
  `hash` = SHA-256 over the canonical serialization of the record minus
  `hash`), plus a per-run GENESIS record (`audit.genesis`) carrying
  runId + agent identity + library/app versions. Runs chain
  back-to-back in one log, so silently dropping a whole run breaks the
  chain. Attach via
  `agent.enable.observability({ strategy: auditExport() })`.
- **`verifyAuditBundle()`** — pure OFFLINE verification (no agent, no
  strategy): recomputes the chain and names the exact record any tamper
  broke (`{ valid, brokenAt, reason }`). Accepts one bundle or an array
  of consecutive drained segments.
- **`bundle()` / `drain()`** — the export surface. Bundles are plain
  JSON (persistence is the consumer's job); `drain()` returns the
  records since the last drain while keeping the chain intact across
  segments (`header.chainHead` = previous segment's `finalHash`, so
  concatenated segments re-verify end-to-end).
- **`canonicalJson()` (`afp-cjson/1`)** — the documented byte contract
  under the hashes (sorted keys by UTF-16 code unit, no whitespace,
  JSON.stringify number/string semantics, toJSON honored, bigint/cycles
  throw). Exported so independent verifiers can re-implement.
- **PII discipline mirrors #19** (`payloadMode: 'bounded'`, default):
  tool args → key NAMES, results → TYPE, prompts / LLM content /
  thinking / history / content previews (`contentSummary`,
  `rawContent`, `droppedSummaries`, `resultSummary`) → `[N chars]`
  markers, error MESSAGE strings → `[N chars]`, free-form Records
  (pause payloads, risk/eval evidence) → `[keys: …]`. `contentHash`
  stays verbatim (links identical content without echoing it).
  `payloadMode: 'verbatim'` embeds full payloads for access-controlled
  stores (documented disclosure). `stream.token` /
  `stream.thinking_delta` excluded by default (`includeTokenEvents`).
- **Zero new dependencies** — SHA-256 via `node:crypto`, lazily
  imported with the same gating as the optional vendor SDKs (importing
  the module stays browser-safe; capture/verify need a runtime with
  `node:crypto`: Node ≥ 20, Bun, Deno, edge Node-compat).
- **Honesty note:** the chain is tamper-EVIDENT, not tamper-PROOF — an
  adversary holding the only copy can recompute the whole suffix.
  Anchor `finalHash` externally (write-once store, signed log,
  timestamping service) for non-repudiation; documented on the API.
- `package.json` now exports `"./package.json"` (standard
  self-reference; lets the genesis record carry the real library
  version).
- Example: `examples/features/19-audit-export.ts` — agent run with
  route decisions + a tool call + a #9 validation rejection → export →
  verify OK → flip one byte → verification names the record → drained
  segments re-verify concatenated. Zero new typed events.

### Fixed

- **`xrayObservability` produced no segments on real runs — same
  dead-field bug class as the 6.17.0 otel fix** (masked by fabricated
  test event shapes; no new features, pure correctness):
  - read `payload.runId` — real dispatcher envelopes carry the run
    anchor on `meta.runId` (built by `bridge/eventMeta.ts`), so EVERY
    event was skipped and ZERO segments shipped. Now anchored on
    `meta.runId` with the `payload.runId` fallback kept for hand-fed
    events.
  - `agent.iteration_start` read `payload.iteration` — the real field
    is `iterIndex`, so every iteration segment was named `iteration:?`.
  - `stream.tool_end` read `payload.toolName` — `ToolEndPayload`
    carries only `toolCallId`, so the close fell back to "pop topmost"
    and parallel tool calls closed the WRONG segment. Tool segments are
    now correlated by `toolCallId` (parallel-safe); the toolName-based
    match remains as the legacy fallback. An explicit `error: false`
    on `tool_end` no longer marks the segment as errored.
  - `cost.tick` read `payload.cumulativeCostUsd` — the real shape is
    `cumulative.estimatedUsd` (`CostTickPayload`), so cost annotations
    never appeared. Legacy field kept as fallback; the annotation key
    stays `cumulativeCostUsd` for existing X-Ray Insights queries.
  - `error.fatal` now closes the segment tree (`fault` on the root,
    PII-safe `errorStage`/`errorScope` annotations only) instead of
    leaking the turn in `activeTurns`, where its segments never
    graduated to the outbox.
  - New integration test drives a REAL Agent run (MockProvider +
    scripted tool call) through `xrayObservability` with an injected
    client and asserts segments are actually produced — the test style
    whose absence masked the bug class.

## [6.17.0] - 2026-06-10

Minor — **#19: `otelObservability` speaks OTel GenAI semantic conventions +
explainability span events** (first item of the compliance wedge; #20
tamper-evident export builds on this span/event stream).

- **GenAI semconv attributes (`gen_ai.*`) — ON by default** (purely
  additive attribute names; current spec, `gen_ai.provider.name` era):
  - turn span → `gen_ai.operation.name: 'invoke_agent'`,
    `gen_ai.agent.name`, turn-total `gen_ai.usage.input_tokens` /
    `output_tokens`, `agentfootprint.run.id`, `agentfootprint.turn.index`;
    provider + model back-filled from the first LLM call.
  - llm span → `gen_ai.operation.name: 'chat'`, `gen_ai.provider.name`,
    `gen_ai.request.model`, `gen_ai.request.temperature`,
    `gen_ai.usage.input_tokens`/`output_tokens`/`cache_read.input_tokens`/
    `cache_creation.input_tokens`, `gen_ai.response.finish_reasons`,
    `gen_ai.response.id`.
  - tool span → `gen_ai.operation.name: 'execute_tool'`,
    `gen_ai.tool.name`, `gen_ai.tool.call.id`,
    `agentfootprint.tool.protocol`, `agentfootprint.tool.args.keys`
    (key NAMES only), `agentfootprint.tool.result.type` (type only),
    `error.type` on failure.
- **Explainability span events — ON by default** (`explainability: false`
  to opt out): route decisions (`agent.route_decided` /
  `composition.route_decided` incl. decide()-shaped `evidence`), skill
  routing provenance (`agentfootprint.skill.routing` per routed
  injection: decision path, route edge, unlocked tools),
  `skill.activated`, validation rejections (#9, type-level issues),
  permission checks/halts, credential lifecycle. Span EVENTS (not
  attributes) because decisions have per-span multiplicity + ordering;
  attribute fallback when the injected tracer lacks `addEvent`.
- **`decisionEvidenceRecorder()`** on the returned strategy — a
  footprintjs CombinedRecorder bridging decide()/select() operator-level
  evidence (rule label + `key op threshold → actual (result)` conditions)
  from the FlowRecorder channel into span events
  (`agentfootprint.decision.evidence`). Attach via
  `Agent.create(...).recorder(...)` or `executor.attachCombinedRecorder`.
  Skips evidence-less decisions (already on the typed channel) and
  sf-cache / slot-fork plumbing.
- **`genAiSpanNames: true` (opt-in)** — spec span names
  (`invoke_agent {service}`, `chat {model}`, `execute_tool {tool}`).
  Off by default: existing dashboards key on the legacy span names
  (`{service}` / `llm` / `tool:{name}`); all `gen_ai.*` ATTRIBUTES are
  emitted regardless, so semconv-aware backends work without the rename.
- **Fixed (latent — masked by fabricated test event shapes):** the
  adapter read `payload.runId` / `payload.cumulativeCostUsd` /
  `tool_end.toolName`, none of which exist on real dispatcher envelopes —
  on a REAL agent run it produced ZERO spans. Now anchors on
  `meta.runId` (payload fallback kept for hand-fed events), reads
  `cumulative.estimatedUsd`, and correlates tool spans by `toolCallId`
  (parallel tool calls close the right span). `error.fatal` now closes
  the span tree (ERROR status on root) instead of leaking until `stop()`.
- **PII discipline (mirrors the #9 contract):** prompts, LLM content,
  tool arg/result VALUES, and error messages are never emitted as
  attributes; evidence value summaries are redaction-aware upstream and
  re-capped here (256 chars / 20 list items).
- New: `examples/features/18-otel-genai.ts`,
  `test/observability-providers/otel-genai.test.ts` (24 tests — unit /
  functional / integration on a REAL Agent run + REAL decide() chart /
  security). Exported types: `OtelObservabilityStrategy`,
  `OtelDecisionEvidenceRecorder`, `OtelAttributeValue`.

## [6.16.0] - 2026-06-10

Minor — **#9: tool-args validation with model-visible retry.**

LLM-produced tool args were dispatched to `tool.execute` unvalidated; a
malformed call surfaced as a deep tool stack trace (or silent misbehavior).
Now they are validated against the tool's declared `inputSchema` BEFORE
dispatch.

- **`AgentOptions.toolArgValidation: 'enforce' | 'warn' | 'off'`** — default
  `'enforce'`: a mismatch rejects the call (the tool never runs), the model
  receives a structured retry message as the tool result, and corrects its
  args on the next ReAct iteration. `'warn'` emits the event but executes
  anyway; `'off'` disables. Exported `ToolArgValidationMode`.
- **Honest JSON-Schema subset** — enforces `type` (incl. unions),
  `required`, nested `properties`/`items`, primitive `enum`, and
  `additionalProperties: false` only when explicitly set. Everything else
  (`pattern`, `oneOf`, `$ref`, …) is IGNORED — a schema using them still
  validates the supported core, never false-rejects. Total function: a
  malformed schema can only under-validate, never throw or block.
- **Security: issues name paths, expectations, and received TYPES — never
  the supplied values** (they flow to history/LLM/trace and can carry PII
  or injection payloads). Enum expectations echo schema values only
  (already LLM-visible). Issues capped at 10 per call.
- **Ordering** — the permission gate still sees every attempted call
  (deny/halt precede validation); a rejected call never resolves
  credentials and never activates `read_skill`.
- **⚠ Behavior change (default-on):** two patterns some models emit, which
  previously reached `tool.execute` unchecked, are now rejected in
  `'enforce'` mode — the model gets the retry message and usually
  self-corrects in one extra iteration, but schemas can also opt them in:
  - `null` sent for a `{type: 'string'}` field → declare
    `{type: ['string', 'null']}` to allow it.
  - stringified numbers (`"3"` for `{type: 'integer'}`) → declare
    `{type: ['integer', 'string']}` if your tool coerces.
    Escape hatch: `toolArgValidation: 'warn'` (observe first) or `'off'`.
- **New event** `agentfootprint.validation.args_invalid`
  (`Payloads.ValidationArgsInvalidPayload`: toolName, toolCallId,
  iteration, issues, enforced) — 64 typed events / 18 domains. Bridged to
  `agent.on(...)` via the new always-on `validationRecorder`.
- Example: `examples/features/06-tool-args-validation.ts` — deterministic
  bad-args → rejection → self-correction → success, no API key needed.
- `read_skill` benefits automatically: a hallucinated skill id now fails
  the schema's `enum` with the valid ids in the retry message, before
  execute.

## [6.15.0]

Minor — **#16: footprintjs 9 adoption + iterations unlocked.**

### Changed

- **Peer/dev dependency: footprintjs `^9.0.0`** (was `^7 || ^8`). The 9.0.0
  trampoline runs linear chains and loops on a flat stack — the depth wall that
  capped agents around iteration 71 is gone. Full suite (2462) green against 9.
- **`clampIterations` no longer silently caps at 50.** The cap existed only to
  stay under the old engine wall. `maxIterations` is now an honest COST budget
  (each iteration = one LLM call): lower bound 1 kept; dev mode warns above 100.
  A 200-iteration agent run is tested end-to-end.
- **Engine loop-limit headroom:** `agent.run()` passes
  `maxIterations: agentBudget × 2 + 10` to the executor so footprintjs's own
  loop-iteration limit (default 1000) can never fire below the agent's budget —
  the two libraries' limits are now co-engineered. Consumer-provided run options
  still win.
- **#17 — cross-repo limits test in CI:** the 200-iteration run is a FULL-FEATURE
  agent (steering + fact + skill-with-tools, all three context slots) with an RSS
  budget assertion, running against the pinned footprintjs on every build — the
  boundary between the two libraries is pinned, not assumed.

## [6.14.1]

Patch — **`skillGraph.tree()` merges repeated leaves.** Using the SAME skill as
the leaf of more than one branch ("ESXi questions" and "io questions" both
route to the io-profile bundle) compiled into two same-id injections and
exploded in `Agent.injection()`'s duplicate-id guard at build time. The
compiler now merges repeated leaves into ONE injection whose trigger ORs the
path predicates; routing provenance gains `paths` (all root→leaf paths — the
existing `path` stays as the first); the graph keeps one node with an edge per
converging branch (the drawing shows both diamonds reaching the shared leaf).

## [6.14.0]

### Added

- **Listener/recorder lifecycle** (backlog #11a): long-lived runners
  (servers reusing one Agent across requests) get a complete,
  bounded-leak subscription lifecycle.
  - `removeAllListeners()` on `EventDispatcher` and every `Runner` —
    bulk escape hatch that drops all typed, domain-wildcard, and `'*'`
    listeners in one call (listeners ONLY; recorders added via
    `attach()` keep their own Unsubscribe). Safe mid-dispatch.
  - `listenerCount(type?)` diagnostic on `EventDispatcher` and every
    `Runner` — no-arg returns the total retained listener count (the
    number servers watch for leaks); with a subscription key returns
    that exact bucket.
  - `once(type, listener, { signal })` — one-shot subscriptions now
    accept AbortSignal auto-cleanup, same as `on()`.
  - Bounded-leak guarantee: EVERY removal path (manual unsubscribe,
    `off()`, signal abort, once-fire, `removeAllListeners()`) now
    prunes emptied internal listener buckets from the dispatcher's maps
    AND detaches the abort handler from the consumer's AbortSignal
    (previously a manual unsubscribe left the abort handler on the
    signal — long-lived, never-aborted server signals accumulated one
    handler per subscription cycle). Dispatcher storage is bounded by
    LIVE subscriptions, never subscription history. Enforced by
    property tests (randomized op interleavings vs a reference model)
    and a load test: 1,000 sequential `agent.run()` calls with per-run
    `{ signal }` subscriptions hold `listenerCount()` at the pre-loop
    baseline after every run.
  - Documented the lifecycle contract (who owns cleanup, what
    auto-expires): `Runner.attach()`/`on()` JSDoc, `CLAUDE.md`
    observability section, `src/events/README.md` Decision 6. Summary:
    listeners and recorders live for the RUNNER's lifetime — nothing
    auto-expires per-run; `once()` is the only self-expiring
    subscription; the caller owns cleanup via Unsubscribe handles,
    AbortSignals, or `removeAllListeners()`.

## [6.13.0]

### Added

- **Required parallel branches** (backlog #10):
  `Parallel.create().branch(id, runner, { required: true })` marks a branch
  whose failure must reject the WHOLE run — even under a tolerant
  `.mergeOutcomesWithFn()` merge — with an error naming the branch
  (`Parallel 'x': required branch 'y' failed: <reason>`). When EVERY branch
  is required, footprintjs's fork-level `failFast` is engaged
  (`Promise.all`): the first failure aborts the fan-out immediately —
  no waiting on slow siblings, no merge — and a synthetic
  `composition.exit` (`status: 'err'`) preserves enter/exit pairing for
  dashboards, carrying the same real `runId` as the paired
  `composition.enter` (Convention 4 run-scoping). Fail-fast
  re-attribution correlates by error IDENTITY: the branch-error recorder
  stores the ORIGINAL error object (footprintjs
  `FlowErrorEvent.structuredError.raw`) per branch and matches the raw
  rejection by reference first, bare message second — so attribution
  works for ANY error class (`TypeError`, provider-SDK subclasses like
  `RateLimitError`), not just bare `new Error(...)`. The per-branch error
  map is epoch-scoped per run: late failures from a rejected run's
  abandoned fail-fast siblings are dropped instead of contaminating the
  next run's attribution. With a MIXED required/optional set the fan-out
  stays best-effort (fork-level `failFast` is all-or-nothing, so engaging
  it would wrongly abort when an _optional_ sibling throws); required
  failures are enforced at the Merge join instead. Default behavior
  (no `required` flags) is unchanged. Documented limitations (README
  Decision 8 + `ParallelBranchOptions.required` JSDoc): under all-required
  fail-fast the first PAUSE pre-empts siblings, and a Parallel chart
  MOUNTED into an outer composition (e.g. a Sequence step) rejects raw —
  attribution + the synthetic exit only engage on the `run()`/`resume()`
  path (behavior pinned by test). `ParallelBranchOptions` is exported
  from the package barrel.

### Fixed

- **Parallel `outputMapper` failures are now attributed to their branch**
  instead of surfacing as `unknown error`. footprintjs swallows mapper
  throws without firing `FlowRecorder.onError` (they route to
  `addError('outputMapperError', ...)`), so Parallel's branch-error
  recorder never saw them. Every branch mount now wraps its
  `outputMapper` (`wrapBranchOutputMapper`) to record the throw against
  the branch id — first error per branch wins — before rethrowing along
  footprintjs's existing path. Strict aggregates and tolerant
  `BranchOutcome.error` strings now carry the real message.

## [6.12.0]

Minor — **the evidence bridge (backlog #5)**: causal-memory snapshots now persist
REAL run evidence, and the causal READ works inside an Agent for the first time.
The flagship "agent reads its own trace" claim is now true end-to-end.

### Added

- **`causalEvidenceRecorder`** (`agentfootprint/memory` causal) — harvests during
  the run: tool calls (name / bounded args / result preview / errored), token
  usage + iterations, duration, skill-graph routing provenance, and footprintjs
  `decide()`/`select()` operator-level evidence (`onDecision`/`onSelected`;
  internal cache-gate deciders filtered, incl. the double-prefixed
  `dynamic-grouped` shape). Auto-attached by the Agent when a CAUSAL memory is
  mounted; `mountMemoryWrite` gains `evidenceSource` and `writeSnapshot`
  populates the previously-TODO fields (zeros when absent — back-compat).
- The DECISIONS projection now includes **tool evidence** + the final answer —
  in LLM-decided flows the operator facts (creditScore=580) arrive as tool
  results.

### Fixed

- **Causal READ inside an Agent never fired** (pre-existing): the read mount
  looked for `parentState.messages`, but agents carry `history` — retrieval
  silently injected nothing. Fallback added.
- Panel-found bridge bugs fixed before release: `DecisionRecord.stageId` now
  uses the real `FlowDecisionEvent` fields (`traversalContext.stageId` /
  `decider` — was always the literal `'decider'`); the mid-run runId reset that
  wiped iteration-1 skill decisions and pause/resume evidence is removed
  (per-turn reset anchors on `turn_start`); skill-routing reads `injectionId`.

### Security notes

- Tool args + decision evidence persist into snapshots **bounded**
  (`maxFieldChars`, default 2000; result previews 200 chars). The Agent does not
  configure a RedactionPolicy by default — treat the snapshot store as
  PII-bearing. The DECISIONS projection replays stored tool output into future
  prompts — a persisted prompt-injection surface if tools ingest untrusted
  content (documented at the projection).

### Docs

- Causal claims across CLAUDE.md / AGENTS.md / SKILL.md / README / MENTAL_MODEL /
  docs-site / examples restored to the now-true state (decisions + tool evidence
  real; commitLog/narrative capture still on the roadmap).

## [6.11.1]

Patch — **truth-in-docs sweep** (backlog Phase-0 #4, panel-reviewed). No runtime
behavior change.

### Fixed (docs/claims that a reader could falsify against source)

- **Causal-memory claims calibrated to what ships today.** The "answers from
  EXACT past facts (zero hallucination)" claim assumed operator-level decision
  evidence in snapshots — today `decisions[]`/`toolCalls[]` persist **empty**
  (only query + final outcome are wired; the evidence bridge is backlog
  Phase-1 #5). Softened with an honest status note — keeping the vision, not
  overstating the present — in: CLAUDE.md, AGENTS.md, README,
  `ai-instructions/claude-code/SKILL.md` (what AI IDEs load), 5 docs-site pages
  (causal-deep-dive now explicitly narrates the _target design_),
  MENTAL_MODEL.md, the public `defineMemory`/`SnapshotEntry` JSDoc (ships in IDE
  tooltips) + generated api-reference, and the causal examples.
- **Event/domain counts mechanized.** Docs said "59 typed events × 16 domains"
  (SKILL.md said 47×13; the registry's own header said 45×13) — the registry
  has **63 events / 17 domains**. All stated counts fixed; hard numbers
  **stripped** from non-doc locations; a new **anti-drift test** derives both
  counts from `EVENT_NAMES` and asserts them across **9 docs** (CLAUDE.md,
  AGENTS.md, MENTAL_MODEL.md, SKILL.md, 5 docs-site pages) so this can't
  silently drift again.
- Removed the stale `MIGRATION_PLAN.md` (completed historical work plan;
  preserved in git history).

## [6.11.0]

Minor — **declare-and-push credentials**: a tool DECLARES the credential it needs;
the framework RESOLVES it before invoking and INJECTS `ctx.credential`. This adds
the consumption half that `agentfootprint/identity` (6.10.0) was missing, and
reshapes the credential as a generic, extensible protocol.

> **⚠️ Breaking to the `agentfootprint/identity` subpath only** (shipped 6.10.0,
> one week ago, pre-adoption). Versioned as a minor since that surface has no
> released consumers yet; the rename is small and mechanical — see Migrate below.

### BREAKING (vs the 6.10.0 `agentfootprint/identity` subpath)

- A credential is now a **`Credential` protocol** (`{ kind, toHeaders() }`), not a
  bare token. `CredentialResult`'s success branch is `{ status: 'issued', credential }`
  (was `{ status: 'token', token }`); `isCredentialToken` → **`isCredentialIssued`**;
  `CredentialToken` type → **`CredentialIssued`**.
  - **Migrate:** `if (isCredentialIssued(r)) useHeaders(r.credential.toHeaders())`
    instead of `if (isCredentialToken(r)) useToken(r.token)`.
  - `staticTokens({ svc })` now accepts a `string` (→ `bearer`) **or** a `Credential`;
    `agentCoreIdentity` issues `bearer(accessToken)`.

### Added

- **`defineTool({ needs: { credential, scopes?, mode? } })`** — declare a credential.
  Resolved before `execute`, injected as `ctx.credential`; it is NOT in `inputSchema`,
  so the LLM never sees it.
- **`Agent.create({ credentials })`** — attach a `CredentialProvider` (swap
  `staticTokens` ↔ `agentCoreIdentity` in one line; tool code unchanged).
- **`ToolExecutionContext`** gains `credentials` (fail-closed pull escape — an
  unconfigured provider THROWS, never `undefined`), `hasCredentials`, and the pushed
  `credential`.
- **Built-in credential kinds** — `bearer` / `apiKey` / `basic` / `headers` (the
  universal escape) from `agentfootprint/identity`; custom kinds plug in via the
  protocol with no library change.
- **4 typed events** — `agentfootprint.credential.{requested,acquired,authorization_required,failed}`
  (carry kind/service/reason only — **never the token**).
- **Failure ladder:** issued → inject; `authorization-required` → surface the URL to
  the LLM + skip the tool; throw → surface the reason + skip (a denial is **not**
  retried). Resolution happens before `execute` (fail-closed — never half-authed).

### Security

- The vended token lives only in the tool-call closure + `ctx`, never in tracked
  scope / commit log / recorders / emit payloads / `inputSchema`. Tested. Provider
  implementers MUST NOT echo secrets in thrown error messages (documented on the
  port). `agentCoreIdentity` does not yet forward `req.identity` (tenant isolation
  derives from the workload token — documented).
- **Secret fields are non-enumerable** on the built-in kinds: accidentally
  serializing a credential (returning `ctx.credential` from a tool, logging it)
  emits only the non-secret fields — `JSON.stringify(bearer(t))` is
  `{"kind":"bearer"}`, never the token. Direct reads (`cred.token`) still work.

### Migration note for test fixtures

- `ToolExecutionContext` gained two non-optional fields. If you construct ctx
  literals in your own tests, add them:
  `{ ..., credentials: unconfiguredCredentialProvider(), hasCredentials: false }`
  — both `unconfiguredCredentialProvider` and `CredentialNeed` are exported from
  `agentfootprint/identity`.

### Deferred (documented follow-ups)

- **Transient-retry via `reliability`** — the failure ladder currently surfaces
  transient failures (not auto-retried); wiring `withRetry` is a follow-up.
- **A dedicated `sf-credential` subflow node** — resolution is inline-with-emit for
  v1 (observable via the `credential.*` events; no hidden control flow since it
  returns a value); promote to a node when auto-pause-on-3LO is wanted.

### Tests / Examples

- `test/identity/declare-and-push` (inject / fail-closed / no-leak incl. emit /
  LLM-never-sees / denial-not-retried) + updated `identity` (kinds + 7 types);
  `examples/features/17-identity` rewritten to declare-and-push.

## [6.10.0]

Minor — **AWS Bedrock AgentCore integration**: make agentfootprint easy to run on
AgentCore. A deploy template, a complete integration guide, and a new `./identity`
port for downstream OAuth. Additive.

### Added

- **`agentfootprint/identity`** — the `CredentialProvider` port for OUTBOUND auth
  (vend a token so a tool can call GitHub/Slack/Google on the user's behalf;
  distinct from `agentfootprint/security` authorization). Two flows mirroring
  AgentCore Identity: `mode:'machine'` (2LO, token inline) and `mode:'user'`
  (3LO — may return `authorization-required` with a consent URL). Adapters:
  - **`agentCoreIdentity({ region })`** — wraps AgentCore Identity's
    `GetResourceOauth2Token` (lazy `@aws-sdk/client-bedrock-agentcore`; `_client`
    test seam). Maps `mode`→`M2M`/`USER_FEDERATION`, `service`→credential-provider
    name, response→`token`/`authorization-required`.
  - **`staticTokens({ service: token })`** — dev/test, no network.
  - Exports: `CredentialProvider`, `CredentialRequest`, `CredentialResult`,
    `CredentialToken`, `CredentialAuthorizationRequired`, `isCredentialToken`.
  - **Security invariant:** vended tokens are used locally inside a tool's
    `execute` and MUST NOT be written to tracked scope — so they never reach the
    commit log / recorders / observability export. Enforced by convention +
    proven by a test (token never appears in the snapshot/narrative).
- **AgentCore Runtime deploy template** — `examples/deploy/`: the HTTP contract
  handler (`POST /invocations` + `GET /ping` on `:8080`), ARM64 Dockerfile, and
  README. The example self-tests the contract then exits; `AGENTCORE_SERVE=1`
  listens forever (the container's mode).

### Docs

- **`docs/guides/agentcore.md`** — coverage matrix + verified setup for the
  primitives agentfootprint supports: Runtime (template), Memory (`AgentCoreStore`),
  Observability (`agentcoreObservability`/`otel`), Gateway (MCP via `mcpClient` +
  `toolProvider`), Bedrock model, Identity, and code-interpreter/browser as
  `defineTool` examples. Linked from the guides index.

### Tests / Examples

- `test/identity` — the 7 test types (unit/functional/integration/property/
  **security**/performance/load); the security test proves a vended token used
  locally never reaches the snapshot or narrative.
- `test/deploy` — Runtime handler contract + error paths (bad JSON / throw → 500,
  no stack-trace leak).
- `examples/features/17-identity` (CredentialProvider; asserts `tokenInSnapshot:
false`) + `examples/deploy/agentcore-runtime` (the contract, self-testing).

## [6.9.0]

Minor — **`skillGraph().tree()` scopes tools to the routed leaf by default** —
turning the library's on-demand-tools promise into the default, not a trick you
have to know.

### Changed

- **`.tree()` now stamps `autoActivate: 'currentSkill'` on every leaf.** A decision
  tree routes to exactly ONE skill per turn, so each leaf's `inject.tools` now reach
  the LLM **only when the tree routes there** — instead of every skill's tools
  landing in the always-on static registry on every call. `read_skill` remains the
  escape hatch to reach another skill mid-run. This is what makes a routed skill
  graph token-efficient out of the box (and sharpens tool selection — fewer choices
  per call).
  - **Opt out:** `.tree(root, { scopeTools: false })` restores the legacy additive
    behavior (all leaves' tools always visible).
  - A leaf that sets its **own** `autoActivate` in `defineSkill(...)` is always
    respected — the tree only fills the default.
  - Flat `.entry()` / `.route()` graphs are **unchanged** (not auto-scoped, since
    several skills may be active at once) — set `autoActivate` on those yourself.
  - **Migration:** if you relied on a `.tree()` exposing every leaf's tools every
    call, add `{ scopeTools: false }`. New export: `TreeOptions`.

### Tests / Examples

- `test/skillGraph` — default leaf scoping, `scopeTools: false` opt-out, explicit
  per-leaf `autoActivate` preserved, flat graphs not auto-scoped.
- `examples/features/15-skill-graph` — surfaces `treeToolScoping` (every leaf →
  `'currentSkill'`).

## [6.8.0]

Minor — **Azure OpenAI in the browser** (`browserAzureOpenai()`) + **env-driven
provider resolver** (`providerFromEnv()`), so "a company shows up with an API key"
is a `.env` edit, not a code change. Additive.

### Added

- **`browserAzureOpenai({ endpoint, apiKey, apiVersion, deployment })`** (main
  barrel) — drives an **Azure OpenAI** endpoint from the browser/edge over
  `fetch`, no Node SDK. Builds the deployment-scoped URL
  (`{endpoint}/openai/deployments/{deployment}/chat/completions?api-version=…`)
  and authenticates with the **`api-key` header** (not `Authorization: Bearer`).
  Reuses `browserOpenai`'s request/response/streaming logic. The request's
  `model` is the deployment; the shorthand `'azure'` resolves to the configured
  `deployment`. New exports: `BrowserAzureOpenAIProvider`,
  `BrowserAzureOpenAIProviderOptions`. **CORS:** point `endpoint` at a
  same-origin proxy when the browser blocks the direct call.
- **`browserOpenai({ authScheme })`** — new `authScheme?: 'bearer' | 'api-key'`
  option (default `'bearer'`); `'api-key'` sends the `api-key` header (the Azure
  shape). Backward-compatible — existing callers default to Bearer.
- **`providerFromEnv({ fallbackToMock? })`** (main barrel, **Node-only**) — reads
  `process.env`, detects which provider is configured, and returns
  `{ provider, model, kind }` with no branching in your code. Detection order:
  **Azure** (`AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT`|`OPENAI_BASE_URL`)
  → **Anthropic** (`ANTHROPIC_API_KEY`) → **OpenAI** (`OPENAI_API_KEY`) →
  throws, or the mock with `{ fallbackToMock: true }`. Lazy-loads only the
  detected provider's SDK. New export: `ProviderFromEnv`.

### Docs

- `docs/guides/adapters.md` — `browserAzureOpenai` in the providers table + an
  **Env-driven: `providerFromEnv()`** section (detection table + a typical
  company `.env`) + a browser-providers CORS note. CLAUDE.md providers section
  updated (env-driven snippet + barrel exports).

### Tests / Examples

- `test/adapters/unit/AzureBrowserAndEnv` — `browserAzureOpenai` URL / `api-key`
  header / deployment routing / validation via a recording fake `fetch`;
  `providerFromEnv` detection order + mock fallback + the no-creds error.
- `examples/features/16-providers` — now uses `providerFromEnv({ fallbackToMock })`
  (dogfoods the resolver); runs offline on the mock.

## [6.7.0]

Minor — **Azure OpenAI provider** (`azureOpenai()`), for the common "company with
an Azure resource + API key" case. Additive.

### Added

- **`azureOpenai({ endpoint, apiKey, apiVersion, deployment })`** (from
  `agentfootprint/llm-providers`) — drives an **Azure OpenAI** endpoint. Azure is
  NOT OpenAI-compatible (deployment-scoped path, `api-key` header auth, an
  `api-version` param, deployment-as-model), so `openai({ baseURL })` can't reach
  it. This wraps the `openai` SDK's `AzureOpenAI` client and **reuses all of the
  OpenAI provider's** completion / streaming / tool-call logic. The request's
  `model` is the Azure **deployment**; the shorthands `'azure'` / `'azure-openai'`
  resolve to the configured `deployment` (pass a concrete deployment id to target
  another). Env fallbacks: `AZURE_OPENAI_ENDPOINT`/`OPENAI_BASE_URL`,
  `AZURE_OPENAI_API_KEY`/`OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`,
  `AZURE_OPENAI_DEPLOYMENT`/`MODEL_NAME`. New export: `AzureOpenAIProviderOptions`.

### Docs

- `docs/guides/adapters.md` — a **supported-providers table** + the "connect a
  company endpoint" 3-bucket guide (OpenAI-compatible → `openai({ baseURL })`;
  Azure → `azureOpenai()`; anything else → the `LLMProvider` interface). CLAUDE.md
  providers section updated.

### Tests / Examples

- `test/adapters/unit/AzureOpenAIProvider` — deployment routing (shorthands → the
  configured deployment; concrete ids pass through), streaming delegation, the
  `deployment`-required guard (fake `_client`, no network).
- `examples/features/16-providers` — one agent, provider picked from the env
  (Azure / Anthropic / OpenAI / mock); runs offline on the mock.

## [6.6.0]

Minor — capture **"what the model saw"**: the tool catalog (name + description)
available to the model at each LLM call, for debugging tool selection. Additive;
behavior-safe.

### Added

- **`stream.llm_start.tools`** — the tool CATALOG the model saw for the call:
  `{ name, description }` per tool sent to the provider, in request order (absent
  when the call had no tools). The structured "what was at the model's disposal
  when it chose" payload — pair it with the iteration's reasoning to debug WHY a
  tool was (or wasn't) picked. (Skills already have the equivalent `skillCatalog`
  on `context.evaluated`.)
- **`AttToolSeen` + `toolsSeen` on `agentThinkingTrace` beats.** The recorder now
  attaches the tool menu to the iteration's first `ask` (and the terminal
  `answer`) — `toolsSeen: { name, description }[]` — so AgentThinkingUI ≥ 0.10 can
  render an expandable "Tools the model saw (N)" next to the reasoning. New export
  `AttToolSeen` from `agentfootprint/observe`.

### Fixed

- **`stream.llm_start.toolsCount` now reflects the DYNAMIC tool set** actually sent
  (registry + skill-unlocked `inject.tools`), not the static startup schemas. The
  count is computed from `activeToolSchemas` (the same list the request uses), so
  it matches `tools.length` and what the model truly saw. Previously it reported
  the startup `deps.toolSchemas.length`, which undercounted once a Skill unlocked
  tools mid-run.

### Tests / Examples

- `test/recorders/AgentThinkingTraceRecorder` — `toolsSeen` on the answer beat
  (name + description), on a tool-calling iteration's first ask, and absent when
  the agent has no tools.

## [6.5.0]

Minor — skill-graph **routing provenance**: capture _why_ a skill was reached
(the decision path / edge) as structured JSON, narrate it richly. Additive; zero
engine change; behavior-safe (routing logic is unchanged — we only record it).

### Added

- **Routing receipt on every compiled skill.** `skillGraph().build()` now stamps
  each skill's `metadata.skillGraph` with a `SkillRouting`: how it's reached
  (`via: 'tree' | 'entry' | 'route' | 'model'`), and for a decision tree the full
  root→leaf **decision path** (each predicate's caption + the `yes`/`no` branch
  taken). The compiler is the only thing that knows the routing semantics, so it's
  the right place to record them. New exports: `SkillRouting`, `SkillRoutingStep`,
  `SKILL_GRAPH_METADATA_KEY`.
- **`context.evaluated` carries `routing`.** The Injection Engine's per-iteration
  `agentfootprint.context.evaluated` event now includes a `routing` array — one
  entry per active skill-graph injection (`injectionId`, `via`, `path`, `label`,
  `from`, `triggerKind`, unlocked `tools`). The structured "what routed this turn,
  and why" payload for the lens. Absent when no active injection came from a
  `skillGraph()` (non-skill-graph runs are unchanged).
- **`context.routed` commentary.** A new template narrates the routing in prose —
  _"Neo routed to the `powermax-performance` skill (matched “array latency /
  cache?”) — 4 tools now available."_ Names the skill, the matched predicate (the
  deciding `yes`; an all-`no` path reads "no specific intent — default"), and the
  tool count. Silent when no skill-graph routing happened (no regression to other
  runs). The full path + every route ride the event payload; the prose stays
  concise (the COMMENTARY/DETAILS split).
- **`agentThinkingTrace` leads the iteration with the routing.** The Notepad's
  first beat each iteration now opens with the routing decision (then the LLM's
  reasoning), so AgentThinkingUI shows _why this skill_ before _what it did_.

### Tests / Examples

- `test/skillGraph` — routing provenance: tree leaf path (root→leaf with
  sibling-negated branches), existing metadata preserved (surfaceMode/cache),
  flat entry/route/model `via`.
- `test/recorders/observability/commentary/routing` — the three commentary fns
  over a `context.evaluated` payload: silent without routing, named skill + matched
  predicate + tool grammar (singular/plural), default-leaf clause, route-edge label.
- `test/recorders/AgentThinkingTraceRecorder` — the iteration's first beat leads
  with the routing line (and stays plain when no skill-graph routed).
- `examples/features/15-skill-graph` — captures the live run's `context.evaluated`
  `routing` off the emit stream (`runtimeRouting`), showing the per-turn provenance
  end-to-end (entry turn 1; the `CRC > 0` route edge turn 2).

## [6.4.0]

Minor — `skillGraph()`: a declarative, visualizable, token-efficient skill graph
(proposal 002, v1 + v3 decision tree). Additive; zero engine change.

### Added

- **`skillGraph()`** — declare an **entry** skill + routing **edges**; each edge
  compiles to the target skill's injection **trigger**, so a skill (its body +
  tools) loads **just-in-time**, only when its edge fires — fewer tokens, sharper
  reasoning, and the topology **draws itself**.

  - `.entry(skill, { when? })` → `always` (persistent base) or `rule` (intent-
    conditional).
  - `.route(from, to, { onToolReturn })` → `on-tool-return` trigger on `to`.
  - `.route(from, to, { when })` → `rule` trigger over `ctx.lastToolResult` on `to`
    (the deterministic "predicate on tool result → next skill" edge).
  - a bare `.route(from, to)` keeps `to`'s default `llm-activated` trigger (still
    reachable via `read_skill`; drawn as a dashed "model" edge).
  - **`graph.toMermaid()`** renders the declared graph (declared === drawn).
  - **`Agent.create().skillGraph(graph)`** mounts it (sugar over `.injection()`).

  v1 is pure sugar over the existing trigger model — the generic evaluator already
  activates a `'skill'`-flavor Injection by any trigger kind, so **no engine
  change**. Scoped `read_skill` (gating the model-reachable set by graph position)
  is deferred to v2. See `docs/proposals/002-skill-graph.md`.

- **`skillGraph().tree(...)` + `decide(...)`** (v3) — a **decision tree** whose
  **predicate nodes actually route**. `decide(predicate, whenTrue, whenFalse,
label?)` builds a branching node; leaves are skills. The compiler walks the tree
  and gives each leaf a `rule` trigger equal to the **conjunction of the predicates
  on its root→leaf path** (with earlier-sibling negation, so exactly one `if/else`
  leaf fires) — evaluated per iteration by the same generic evaluator, so still
  **zero engine change**. `toMermaid()` draws predicate **diamonds** → skill
  **boxes** with `yes`/`no` branch captions, and `graph.nodes` exposes the drawn
  shape (`{ id, kind: 'predicate' | 'skill', label? }`) for richer renderers.

  New exports: `skillGraph`, `decide`, `SkillGraph`, `SkillGraphBuilder`,
  `SkillRouteOptions`, `SkillEntryOptions`, `SkillEdge`, `SkillEdgeKind`,
  `SkillNode`, `DecisionNode`.

### Tests / Examples

- `test/skillGraph` — edge→trigger compilation, activation through the REAL
  evaluator (entry active at start; routed skill activates only when its predicate
  fires; body lands in the slot; dormant otherwise), `toMermaid`, guardrails; **v3
  decision tree** — each leaf compiles to a path-conjunction `rule`, exactly one
  leaf fires per question through the real evaluator, single-skill tree, non-skill
  leaf guard, and the diamond/box/`yes`-`no` Mermaid.
- `examples/features/15-skill-graph` — triage entry + sfp-diagnostics routed on
  `CRC > 0`, with the Mermaid + just-in-time load shown; **plus a `decide(...)`
  intent tree** routing `iops`/`sfp`/default to one leaf each.

## [6.3.0]

Minor — `agentThinkingTrace` now surfaces the model's extended-thinking
chain-of-thought. Additive.

### Added

- **Extended thinking on the beat.** `agentThinkingTrace` consumes
  `stream.thinking_end` and attaches the iteration's reasoning (the joined
  `blocks[].content`) to that iteration's first `ask` beat — or back-fills it
  onto a terminal `answer` beat (`thinking_end` fires just after `llm_end`, which
  already pushed the answer). Exposed as a new optional **`thinking`** field on
  the `AttStep` `ask`/`answer` shapes, so AgentThinkingUI ≥ 0.9 can render
  Claude's chain-of-thought in its callout. Empty/absent when the provider
  produced no reasoning (thinking disabled, or a mock). Enable it on the agent
  with `.thinking({ budget })`.

### Tests

- `test/recorders/AgentThinkingTraceRecorder` — synthetic-emit coverage: reasoning
  rides the first ask; terminal answers are back-filled; `thinking` stays
  undefined with no blocks.

## [6.2.0]

Minor — two new observability recorders (tool→tool data-flow graph; the
"watch it think" Trace, now narrated through one commentary engine). Additive.

### Added

- **`toolLineageRecorder()`** (from `agentfootprint/observe`) — reconstructs the
  tool→tool **data-flow graph** of a run that footprintjs `causalChain` cannot
  see. In a ReAct loop a tool's output goes back to the LLM as text and the LLM
  picks the next tool's args, so the dependency never touches the shared scope.
  This recorder rebuilds it by **value provenance**: when a distinctive value an
  earlier iteration's tool RESULT produced reappears in a later tool's ARGS, it
  records an edge (producer → consumer). Attach via
  `.recorder(toolLineageRecorder())` and read `getLineage()`.

  Conservative by design: short/common values are ignored (`minValueLength`,
  default 4), numbers are off by default (`matchNumbers`), and same-iteration
  (parallel) tool calls never link to each other. Run-scoped (resets per run).

  New exports: `toolLineageRecorder`, `ToolLineageRecorderHandle`,
  `ToolLineageOptions`, `ToolLineageGraph`, `ToolLineageEdge`, `ToolCallRef`.

- **`agentThinkingTrace()`** (from `agentfootprint/observe`) — builds an
  [AgentThinkingUI](https://github.com/footprintjs/agentThinkingUI) `Trace`
  (`prompt → ask → return → answer` beats) from the emit stream as the run
  traverses, so any agentfootprint agent drives the "watch it think" player for
  free. The `Trace` contract is kept inline, so agentfootprint does NOT depend on
  AgentThinkingUI. Attach via `.recorder(agentThinkingTrace({ agent, model }))`
  and read `getTrace({ task })` — it returns the run **so far**, so consumers can
  tail it live.

  **Commentary through one engine.** Each beat's `brain` (what AgentThinkingUI's
  Notepad / bottom caption render) is filled from agentfootprint's OWN commentary
  engine — the same `selectCommentaryKey` / `extractCommentaryVars` /
  `renderCommentary` the Lens uses — so the "watch it think" view and the Lens
  commentary panel read identically, from one source, consumer-overridable via a
  new **`commentaryTemplates`** option (same shape as the Lens's prop). The LLM's
  own reasoning still wins on the first ask of each iteration; the engine fills
  every other beat so no Notepad line is ever blank (previously tool-result and
  follow-up-ask beats had an empty `brain`).

  New exports: `agentThinkingTrace`, `AgentThinkingTraceHandle`,
  `AgentThinkingTraceOptions`, `AttTrace`, `AttStep`, `AttCost`, `AttAnswer`.

### Tests / Examples

- `test/recorders/ToolLineageRecorder` — unit (synthetic emits: cross-iteration
  edge, same-iteration gating, short-value/number filtering, run-scope reset)
  plus a functional real-agent `lookup → fetch` recovery.
- `test/recorders/AgentThinkingTraceRecorder` — functional (real skill-then-tool
  run → beat classification) plus the commentary engine (return beats carry
  engine prose, `commentaryTemplates` override, LLM reasoning wins on first ask).
- `examples/features/14-tool-lineage` — the FLOGI→FCID→io_profile chain, with
  the derived lineage printed.

## [6.1.0]

Minor — a self-explaining injection engine and clearer commentary. Additive; the
`activeInjections` result is byte-identical to 6.0.0.

### Changed

- **The injection engine runs as a readable `Gather → Evaluate → Route → Delta`
  subflow.** `buildInjectionEngineSubflow` is decomposed into four named stages so
  a run narrates _how_ context was assembled (which injections were gathered,
  evaluated, routed to a slot, and what changed) instead of one opaque step. The
  computed `activeInjections` is unchanged.
- **`Evaluate` emits `agentfootprint.context.evaluated`** carrying the offered
  skill catalog and a typed payload, so observers can narrate the decision.

### Fixed

- **Commentary for instruction injections now shows the rule content** (the
  injected text) instead of an empty `": ."`. The raw `context.evaluated` emit is
  no longer surfaced as prose — it is structured signal, not human narration.

### Tests

- `InjectionEngineSubflow` (the four-stage decomposition + emit) and commentary
  cases.

## [6.0.0]

Major — one breaking API simplification. No runtime behavior change.

### Changed (BREAKING)

- **`reactMode` + `reactStructure` merged into a single `reactMode`.** The two
  knobs interacted with a silently-ignored combination (`reactMode: 'classic'`
  ignored `reactStructure: 'subflow'`). They are now one setting with three
  honest, valid choices:

  - `'dynamic'` (default) — re-engineer all slots each turn; flat chart.
  - `'classic'` — engineer context once, loop only Messages; flat chart.
  - `'dynamic-grouped'` — `'dynamic'` semantics **+** the LLM turn wrapped in an
    `sf-llm-call` subflow for richer Lens grouping (was `reactStructure:'subflow'`).

  Migration: `reactStructure: 'subflow'` → `reactMode: 'dynamic-grouped'`;
  `reactStructure: 'flat'` → drop it (the default). `reactMode: 'classic' |
'dynamic'` are unchanged.

### Internal

- Renamed the internal `recorders/observability/thinking/` directory to
  `status/` (its symbols became `Status*` in 5.0.0) — no public API change.

## [5.0.0]

Major — API surface simplification (round 2). Three breaking refactors + one
additive factory. No runtime behavior change. The lens was updated in lockstep.

### Changed (BREAKING)

- **Observability recorders are `agentfootprint/observe`-only.** The ~15 recorder
  factories/classes (`ContextRecorder`, `streamRecorder`, `agentRecorder`,
  `compositionRecorder`, `costRecorder`, `evalRecorder`, `memoryRecorder`,
  `permissionRecorder`, `skillRecorder`, `toolsRecorder`,
  `contextEvaluatedRecorder`, `boundaryRecorder`/`BoundaryRecorder`,
  `liveStateRecorder` + `Live*` trackers, the `RunStep*` family,
  `attachFlowchart`/`attachLogging`/`attachStatus`, and their option/`Domain*Event`
  types) were removed from the main barrel — import them from
  `agentfootprint/observe`. `enable.flowchart()` stays on the runner, so its
  public types (`FlowchartHandle`/`FlowchartOptions`) remain on the main barrel.

- **The agent status-line concept renamed `Thinking*` → `Status*`** to
  disambiguate from the MODEL's extended-thinking reasoning (which keeps the
  "thinking" name — `ThinkingHandler`, `thinkingBudget`, `thinking_delta`):
  `ThinkingState`→`StatusState`, `ThinkingStateKind`→`StatusKind`,
  `ThinkingContext`→`StatusContext`, `ThinkingTemplates`→`StatusTemplates`,
  `selectThinkingState`→`selectStatus`, `renderThinkingLine`→`renderStatusLine`,
  `defaultThinkingTemplates`→`defaultStatusTemplates`,
  `ThinkingRecorder`→`StatusRecorder`, `attachThinking`→`attachStatus`,
  `ThinkingEvent`→`StatusEvent`, `ThinkingOptions`→`StatusOptions`.

- **Event payload shapes are namespaced under `Payloads`.** The ~60 `*Payload`
  types no longer flood the top-level barrel. Reach a shape by name as
  `Payloads.AgentRouteDecidedPayload`; `event.payload` is still typed via
  `AgentfootprintEventMap`.

### Added

- **`defineInjection({ type })`** — a unified injection factory. Pass
  `type: 'instruction' | 'skill' | 'steering' | 'fact'` and it routes to the
  matching named factory, returning the same `Injection`. For programmatic /
  config-driven flavor selection; the named factories remain the recommended
  self-documenting form. Purely additive.

## [4.0.0]

Major — API surface cleanup. Two breaking removals + one additive subpath. No
runtime behavior change.

### Removed (BREAKING)

- **Three redundant subpath aliases collapsed:**

  - `agentfootprint/providers` → use `agentfootprint/llm-providers`
  - `agentfootprint/memory-redis` → use `agentfootprint/memory-providers`
  - `agentfootprint/memory-agentcore` → use `agentfootprint/memory-providers`

  These were back-compat aliases of the canonical subpaths (same exports). 18
  subpaths → 15 real ones (16 with the new `./strategies` below).

- **`enable.thinking()` and `enable.logging()` removed** (deprecated since v2.8;
  the docs had promised removal). Use the uniform strategy enablers instead:

  ```ts
  import { chatBubbleLiveStatus, consoleObservability } from 'agentfootprint/strategies';

  agent.enable.liveStatus({ strategy: chatBubbleLiveStatus({ onLine: onStatus }) }); // was enable.thinking({ onStatus })
  agent.enable.observability({ strategy: consoleObservability() }); // was enable.logging()
  ```

  `enable.flowchart` is **kept** — it is a real, non-deprecated composition-graph
  feature. The low-level `attachThinking` / `attachLogging` helpers remain
  available from `agentfootprint/observe`.

### Added

- **`agentfootprint/strategies` subpath** — the public home for the strategy
  system (`chatBubbleLiveStatus`, `consoleObservability`, the `compose*`
  combinators, typed strategy interfaces, and the `attach*` helpers). Previously
  these defaults had no public import path, which made the strategy enablers
  unusable from outside the package; that gap is now closed.

## [3.1.2]

Patch — fixes a browser-load regression introduced in 3.1.1.

### Fixed

- **ESM build crashed on load in browser bundlers (Vite).** 3.1.1's ESM
  `lazyRequire` imported `createRequire` from `node:module` with a _named_ import,
  which Vite's CJS interop compiles to a top-level property read on the
  browser-externalized `node:module` stub — throwing `Cannot access
"node:module.createRequire" in client code` at import, even though
  `lazyRequire` is never called in a browser. Switched to a namespace import with
  the `createRequire` access deferred inside the function (call-time, never
  reached in a browser bundle). Verified end-to-end in a Vite playground (agent
  runs clean, zero console errors) and guarded by an ESM-packaging test. Node ESM
  - CJS behavior unchanged.

## [3.1.1]

Patch — packaging only. No API or behavior change.

### Changed

- **The ESM build now loads as true ESM.** Every relative import carries an
  explicit `.js` extension and `dist/esm` is marked `type:module`, so Node,
  Deno, and Bun load it as real ECMAScript Modules (not just bundlers). The ESM
  `lazyRequire` now uses `createRequire(import.meta.url)` instead of a bare
  `require()`, so optional peer-dep adapters (Anthropic, OpenAI, Bedrock,
  ioredis, AgentCore, MCP, OTEL/CloudWatch/X-Ray) work for ESM consumers instead
  of throwing `ReferenceError: require is not defined`. CJS consumers unaffected.

### Fixed

- **`sideEffects` now declares the cache-strategy registration files.** Those
  files self-register prompt-caching strategies as a side effect, so listing them
  keeps aggressive bundlers from dropping the registrations (defensive — not
  observed dropping under esbuild).

### Added

- **Tree-shaking guard test + badges.** A CI smoke test bundles a minimal
  `import { defineTool }` and asserts the Agent runtime / injection engine /
  memory stores / providers are pruned, plus true-ESM load of the main barrel and
  all 18 subpaths and an ESM `lazyRequire` check. README gains minzipped-size and
  tree-shakeable badges.

## [3.1.0]

Agent runtime + observability. Additive — `^3.0.0` consumers upgrade safely
(tracks `footprintjs@^6.0.0`).

### Added

- **`reactMode: 'classic' | 'dynamic'`** (default `dynamic`, back-compat): classic
  caches the static system-prompt/tools slots after turn 1 and re-selects only
  Messages; dynamic recomposes every slot each iteration. Same chart + loop shape.
- Runtime restructured to the merge-tree the Lens renders: context slots are a
  parallel selector fork (`failFast`), cache grouped into one `sf-cache` subflow,
  branch-sourced `loopTo` from ToolCalls — in both flat + dynamic agent builders.
- **`milestoneFor(id)`** classifier (iteration / slot / llm-turn / tool-call /
  decision) exported from conventions — drives the Lens time-travel scrub stops.
- `ErrorBridge` (`onRunFailed` → typed `error.fatal`), `ReliabilityRecorder`,
  `ContextEvaluatedRecorder`, `humanizeLLMError`.
- README coverage badge from generated v8 coverage.

### Fixed

- `cacheRecorder` slot resolution (matched by `splitStageId` local id);
  `buildMessages` / `buildTools` slot fixes.

## [3.0.0]

Major release. Tracks `footprintjs@^6.0.0` and propagates the build-time
observer rename.

### Breaking changes

- **API rename**: `buildTimeExtractor?: BuildTimeExtractor` removed from
  the config of every composition primitive. Replaced by
  `structureRecorders?: readonly StructureRecorder[]` — matching
  footprintjs v6's options-bag shape on `flowChart()`.
  Affected factories:
  - `Agent.create({ buildTimeExtractor })` → `Agent.create({ structureRecorders: [...] })`
  - `LLMCall.create()` — same rename
  - `Sequence.create()` / `Parallel.create()` / `Loop.create()` /
    `Conditional.create()` — same rename
  - **Migration**: pass a `StructureRecorder` (event-handler interface)
    instead of the v5 `BuildTimeExtractor` (per-node spec mutator).
    See footprintjs `MIGRATION-6.md` Recipe 1 for the recorder shape.
- **Peer dep**: bumped `footprintjs` from `>=4.17.2` to `^6.0.0`.

### Added

- **`agentfootprint.context.evaluated` event** — the Injection Engine now
  emits a per-iteration summary of trigger evaluation (active count, skipped
  count + reasons, trigger-kind breakdown, active ids). It is the upstream
  counterpart to `context.slot_composed` ("what was considered / active /
  skipped and why" vs "what landed in each slot"). Subscribe via
  `agent.on('agentfootprint.context.evaluated', …)`. Brought to the dispatcher
  by a new `contextEvaluatedRecorder` (an `EmitBridge` scoped to the exact
  event name — not the whole `context.` domain — so it never double-dispatches
  `context.slot_composed`, which is also `typedEmit`'d in the viz chart).
  Replaces a **dead** `injectionEvaluation` scope write that nothing read and
  that never left the Injection Engine subflow (the documented emit had never
  actually been wired). Event count 58 → 59.

### Changed

- **Setup stage renamed `Seed` → `Initialize` (display only)** — the root
  setup stage of every primitive (Agent, LLMCall, Parallel, Loop, Conditional)
  now displays as **`Initialize`** in the Lens/flowchart. "Seed" read like
  planting/growing to non-experts; "Initialize" says what it does (sets up the
  starting state). DISPLAY-ONLY: the internal id stays `'seed'`, so
  `runtimeStageId` `seed#0` is unchanged — no break to recorders / Lens / trace
  / tests that key on the id. (Per the stage-naming audit; the inner dynamic
  per-iteration `TurnSeed` is left as-is.)
- All internal `flowChart()` call sites migrated from the legacy
  5-positional signature `(name, fn, id, undefined, 'desc')` to v6's
  options-bag form `(name, fn, id, { description: '...' })`. Affected
  internal builders: every composition primitive, every slot builder
  (system-prompt / messages / tools / thinking), every memory pipeline,
  injection-engine, cache decision, reliability gate.
- `test/core-flow/unit/buildTimeExtractor.test.ts` — 14 tests rewritten
  to validate the v6 observer contract (events fire with expected
  payloads, throw isolation) instead of v5 spec-tree mutation (v6
  explicitly removed that capability per Recipe 2). All 7 test-type
  sections preserved.
- Adopted `splitStageId` (new in footprintjs v6) at `conventions.ts:96`
  and `RunStepRecorder.ts:428`. Left `eventMeta.ts:74` as
  `parseRuntimeStageId` since it consumes full runtimeStageId strings.
- Docstring sweeps: `translator.ts` + `RunnerBase.ts` reference v6
  `StructureRecorder` semantics, not v5 `BuildTimeExtractor`.
- **Agent chart restructure** — the context slots (system-prompt /
  messages / tools) now run as a **parallel selector fork** and the cache
  machinery is a single `sf-cache` subflow, so the execution tree the agent
  runs IS the merge-tree the Lens draws. Applies to both `buildAgentChart`
  (classic) and `buildDynamicAgentChart` (dynamic). `ContextRecorder` and
  `cacheRecorder` made parallel- and nesting-safe (resolve slot/gate from
  each event's own `runtimeStageId`/`stageId`).
- **`iterationStart` stage folded into `callLLM`** — the former dedicated
  `stages/iterationStart.ts` stage existed only to fire the per-iteration
  `agentfootprint.agent.iteration_start` emit. Emits are passive (no business
  logic, no scope writes), so the marker now fires from the top of `callLLM`
  and the standalone stage is removed. No consumer depended on the stage's
  own `runtimeStageId`; all read the `iterIndex` payload. Removed from
  `AgentChartDeps` and both chart builders. `stages/iterationStart.ts` deleted.
- **`UpdateSkillHistory` is now conditionally mounted** — the stage (and thus
  the skill-churn rule) is added ONLY when ≥1 Skill is registered
  (`injections.some(i => i.flavor === 'skill')`, the same gate that
  auto-attaches `read_skill`). With no skills the window could never show
  churn, so the stage was dead weight + a misleading box. Applies to both
  builders; the dynamic chart's fan-out `convergeAt` retargets to `sf-cache`
  when the stage is absent so the merge target always exists. Mirrors the
  existing `NormalizeThinking` conditional-mount pattern.

### Fixed

- **Skill-churn detection was dead** — `updateSkillHistory` sampled the
  **head** of `activatedInjectionIds` (`[0]`). Since `read_skill` appends new
  ids to the END and the list is cumulative + deduped per turn, the head was
  frozen at the first-activated skill and never changed mid-turn — so the
  rolling window recorded one constant value and `detectSkillChurn` could
  never fire. The cache's skill-churn rule was effectively inert. Fixed to
  sample the **tail** (most-recently activated skill), so churn is detected
  across A→B→C activations and the gate correctly skips caching when skills
  thrash. Known limitation (documented): multiple skills activated in the
  same iteration record only the tail.

### CI / publish workflow

- Migrated to npm **trusted publishing** (OIDC) — no `NPM_TOKEN`
  secret required. `id-token: write` permission already present.
  Workflow upgrades `npm@latest` after tests but before publish
  (trusted publishing requires npm >= 11.5.1; Node 22 ships npm 10.x).

### Internals (accumulated 2.14.5+ work)

- New `RunStepRecorder` with structural design notes
  (`RunStepRecorder.STRUCTURE.md`).
- New observability internals (`observability/internal/`),
  `observeRunId` helper.
- Multi-run aliasing test coverage, parallel-events test fixture,
  agent-toolprovider test coverage, snapshot/getLastSnapshot test
  shape, BoundaryRecorder-ranges coverage.
- `docs/design/` notes added.

### Verification

- Suite: 2177 / 2177 passing (175 files).
- Build: CJS + ESM clean.

## [2.14.5]

### Added — `name` field on `CompositionExitPayload`

Mirror of the `name` field already on `CompositionEnterPayload`, so consumers narrating the exit moment can reference the same human-readable identity used at entry — no name-cache required across the start/stop pair.

```ts
// Before (v2.14.4 and earlier):
interface CompositionExitPayload {
  kind: CompositionKind;
  id: string;
  status: 'ok' | 'err' | 'break' | 'budget_exhausted';
  durationMs: number;
}

// After (v2.14.5):
interface CompositionExitPayload {
  kind: CompositionKind;
  id: string;
  name?: string;          // ← NEW (optional for back-compat)
  status: ...;
  durationMs: number;
}
```

**Why:** the v2.14.4 `composition.exit` commentary template (`'`{{name}}` finished — {{status}} in {{durationMs}}ms.'`) had to fall back to `id` because the exit payload didn't carry `name`. For runs like `Sequence.create({ name: 'IntakePipeline' })`, the closing line read `'`sequence` finished'` (lowercase id) instead of `'`IntakePipeline` finished'`. Now reads correctly.

### Changed — Sequence / Parallel / Conditional / Loop emit `name` on exit

All four core-flow primitives now pass their build-time `name` through to `composition.exit`. Pre-existing consumers reading only `id` are unaffected. Consumers using the `composition.exit` template automatically get the right name.

`extractCommentaryVars` for `composition.exit` reads `p.name ?? p.id` so v2.14.4-emitter events still render (using id as a fallback).

### Tests

2071/2071 unchanged — the field is optional for back-compat, and existing test fixtures that asserted on the exit payload didn't reference `name`.

Pure addition. No breaking changes.

## [2.14.4]

### Added — `{{agentName}}` template variable + multi-agent commentary templates

Commentary templates can now surface the **active agent's identity** for multi-agent / multi-LLM runs (Sequence-of-LLMCalls, Swarm, Debate, etc.) via a new `{{agentName}}` template variable:

```ts
'stream.llm_start.iter1': '{{agentName}} sent the question to the LLM.',
```

For single-Agent runs, `{{agentName}}` falls back to `{{appName}}` — so existing copy reads identically (no breaking change). For Sequence-of-LLMCalls or Swarm, the active agent's name surfaces (e.g., `'classify sent the question…'` then `'respond sent the question…'`).

**`extractAgentName(event, ctx)`** — new exported helper that walks `event.meta.subflowPath` right-to-left, skipping library-internal segments (slot subflows `sf-*`, agent-routing subflows, thinking-handler subflows, the `final` route-branch), and returns the first meaningful segment with the optional `step-` Sequence prefix stripped. Falls back to `appName` when no meaningful segment is found.

```ts
import { extractAgentName } from 'agentfootprint';

extractAgentName(event, { appName: 'Chatbot' });
//   path: []                                   → 'Chatbot' (single-Agent runner)
//   path: ['step-classify']                    → 'classify' (Sequence stage)
//   path: ['agent-A', 'agent-B']               → 'agent-B' (Swarm: latest hand-off)
//   path: ['agent-Triage', 'sf-system-prompt'] → 'agent-Triage' (skips slot subflow)
//   path: ['sf-injection-engine']              → 'Chatbot' (all internal → fallback)
```

### Added — Composition templates (Sequence / Parallel / Loop / Conditional)

Each composition primitive gets its own `composition.enter.<Kind>` template, plus a `composition.exit` template:

```ts
'composition.enter.Sequence':    'Started pipeline `{{name}}` — {{childCount}} stages chained.',
'composition.enter.Parallel':    'Forked `{{name}}` into {{childCount}} parallel branches.',
'composition.enter.Loop':        'Started loop `{{name}}` — repeat until done.',
'composition.enter.Conditional': 'Entering router `{{name}}` — picking a branch.',
'composition.enter.Generic':     'Entered composition `{{name}}` ({{kind}}) with {{childCount}} children.',
'composition.exit':              '`{{name}}` finished — {{status}} in {{durationMs}}ms.',
'composition.handoff':           'Handed off `{{fromAgent}}` → `{{toAgent}}`.',
```

`selectCommentaryKey` routes `agentfootprint.composition.enter` to `composition.enter.${kind}` and `composition.exit` to `composition.exit`. Single-Agent runs never fire these, so they're additive only — no existing behavior changes. Override per-key for locale or brand voice via the existing `commentaryTemplates` consumer override mechanism.

### Updated — default templates use `{{agentName}}` where actor identity matters

Updated keys (semantically equivalent for single-Agent runs):

- `stream.llm_start.iter1`
- `stream.llm_start.iterN`
- `stream.llm_end.tools`
- `stream.llm_end.terminal`
- `stream.tool_start`
- `stream.tool_end`

Backward-compat verified — all 2053 pre-existing tests continue passing because `agentName === appName` when no inner-agent context exists.

### Tests

18 new tests covering 5 edge cases (single-Agent, Sequence-of-LLMCalls, Swarm, slot-subflow walk-past, pause/resume) + composition.enter/exit rendering + variable bag includes agentName for every event type. Total suite 2071/2071.

### Public exports

- `extractAgentName(event, ctx): string` — re-exported from `'agentfootprint'` (used by Lens, custom dashboards, tests).

Pure addition. No breaking changes. No new public API beyond the new template variable + helper.

## [2.14.3]

### Added — `BoundaryRecorder.aggregateForBoundary` + `aggregateAllBoundaries`

Per-boundary rollups for multi-agent / multi-LLM UIs. Two new methods on the existing `BoundaryRecorder` (no new class) plus a new `BoundaryAggregate` type.

**Why this exists:** Lens, CLI live monitors, Sentry breadcrumbs, OTel exporters, and custom dashboards all need the same per-Agent rollup (tokens, llmCalls, toolCalls, iterations, duration). Re-implementing the prefix-match-by-`subflowPath` fold in each consumer is exactly what the recorder pattern is meant to prevent. Domain math (what counts as an "iteration"? does a cache hit count separately?) lives in the library; consumers hook up.

**API:**

```ts
import { boundaryRecorder, type BoundaryAggregate } from 'agentfootprint';

const boundary = boundaryRecorder();
// ... attach + run ...

// One boundary's rollup
const triage: BoundaryAggregate | undefined = boundary.aggregateForBoundary('agent-triage#0');

// Every primitive boundary's rollup, in entry order
const all = boundary.aggregateAllBoundaries();
all.forEach((r) => {
  console.log(
    `${r.label}: ${r.tokens.input}+${r.tokens.output} tokens, ` +
      `${r.llmCalls} llm calls, ${r.toolCalls} tool calls, ` +
      `${r.durationMs ?? '(in flight)'}ms`,
  );
});
```

**Shape:**

```ts
export interface BoundaryAggregate {
  readonly runtimeStageId: string;
  readonly subflowId: string;
  readonly subflowPath: readonly string[];
  readonly primitiveKind?: string; // 'Agent' | 'LLMCall' | 'Sequence' | ...
  readonly label: string; // subflow display name
  readonly tokens: { readonly input: number; readonly output: number };
  readonly llmCalls: number; // count of llm.start
  readonly toolCalls: number; // count of tool.start
  readonly iterations: number; // count of loop.iteration
  readonly startedAtMs: number;
  readonly endedAtMs?: number; // undefined while in flight
  readonly durationMs?: number; // undefined while in flight
}
```

**Semantics:**

- Events count toward a boundary's rollup when their `subflowPath` is a **prefix-match** of the boundary's path. Nested boundaries (e.g., `LLMCall` inside an `Agent`) contribute to BOTH rollups — caller decides which level to render.
- `aggregateAllBoundaries` filters to `primitiveKind`-tagged subflows ONLY (Agent / LLMCall / Sequence / Parallel / Conditional / Loop). Slot subflows (`sf-system-prompt` / `sf-messages` / `sf-tools`) are NOT included — they're context-engineering machinery, not user-facing rollup units.
- Works **mid-run** — in-flight boundaries get partial values (`endedAtMs` / `durationMs` undefined). Lens uses this for per-agent live chips that update as the run progresses.
- Works **post-run** — same call, terminal state.

**Performance:** O(N events × M boundaries) for `aggregateAllBoundaries`. Pure projection over the existing flat event stream — no parallel state, no drift risk vs. `getEvents()`. For typical agent runs (<1000 events, <10 boundaries) this is sub-millisecond.

**Tests:** 9 new tests covering single-boundary rollup, in-flight partial, prefix-match isolation, nested rollup contribution, ordering, primitive-kind filter. Total suite 2053/2053.

**Public exports:** `BoundaryAggregate` type from `'agentfootprint'` main barrel + `'agentfootprint/observe'` subpath.

Pure addition. No breaking changes.

## [2.14.2]

### Added — `LiveStateRecorder` — O(1) "what's happening RIGHT NOW" reads

A live-state recorder built on the new footprintjs **`BoundaryStateTracker<TState>`** storage primitive (v4.17.2). Three bracket-scoped trackers + one façade answer "is something in flight, and what's the partial?" without folding the event log.

**The three trackers:**

| Tracker                | Boundary                  | Key                 | Tracks                                                                                       |
| ---------------------- | ------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `LiveLLMTracker`       | `llm_start` ↔ `llm_end`   | `runtimeStageId`    | partial content (token-stream accumulation), tokens, iteration, provider, model, startedAtMs |
| `LiveToolTracker`      | `tool_start` ↔ `tool_end` | `toolCallId`        | toolName, args, toolCallId, startedAtMs                                                      |
| `LiveAgentTurnTracker` | `turn_start` ↔ `turn_end` | `String(turnIndex)` | turnIndex, userPrompt, startedAtMs                                                           |

**The façade — `LiveStateRecorder`:** bundles all three with one subscribe call, exposes O(1) convenience reads:

```ts
import { liveStateRecorder } from 'agentfootprint';

const live = liveStateRecorder();
live.subscribe(agent); // wires all 3 trackers to the agent's dispatcher

await agent.run({ message: input });

// Read live, O(1), at any moment during the run:
live.isLLMInFlight(); // true between llm_start ↔ llm_end
live.getPartialLLM(); // accumulated tokens of latest active call
live.isToolExecuting(); // true between tool_start ↔ tool_end
live.getExecutingToolNames(); // names of currently-executing tools
live.isAgentInTurn(); // true between turn_start ↔ turn_end
live.getCurrentTurnIndex(); // most-recent active turn (-1 if none)

live.unsubscribe();
```

Each tracker is also independently usable when a consumer only needs one slice (e.g., a CLI status line that only cares about LLM streaming):

```ts
import { LiveLLMTracker } from 'agentfootprint';

const llm = new LiveLLMTracker();
llm.subscribe(agent);
llm.isInFlight();
llm.getLatestPartial();
```

**Mental model:**

> Existing recorder _interfaces_ (`Recorder` / `FlowRecorder` / `EmitRecorder` / `CombinedRecorder`) are **observers**. Storage primitives (`SequenceRecorder<T>` / `KeyedRecorder<T>` / **`BoundaryStateTracker<TState>` 🆕**) are **bookkeeping shelves**. A real recorder picks ONE observer interface AND ONE storage shelf via `extends + implements`. `LiveLLMTracker` extends the new `BoundaryStateTracker` shelf and subscribes to typed events from the agentfootprint dispatcher.

**Subscribe semantics:** `live.subscribe(runner)` is idempotent — calling twice unsubscribes the prior subscription before re-attaching, so consumers don't have to track state. `live.clear()` resets transient state across all three trackers without unsubscribing.

**Tier 1 (live) only.** Past states are not stored — when a boundary closes, its transient state clears. For time-travel queries ("what was the LLM partial at slider step N?"), snapshot to a `SequenceRecorder<TState>`. See the `BoundaryStateTracker` JSDoc on the footprintjs side for the rationale.

**Multi-consumer story:**

- Lens / UI live commentary (the "Chatbot is responding: …" line)
- CLI live monitor (stdout status line)
- Sentry breadcrumb capture ("agent in flight at exception time")
- Test harness (`await waitForLLMIdle()`)

Each consumer reads `live.*` getters in O(1) — no per-render fold over the event log.

**Tests:** 27 new tests across 7 tiers (unit / scenario / integration / property / perf / security / ROI). Total suite 2044/2044.

**Example:** [examples/features/13-live-state.ts](examples/features/13-live-state.ts) — full ReAct turn with mid-stream peeks demonstrating the transient state evolving and clearing.

**Public exports:** main barrel `'agentfootprint'` + `'agentfootprint/observe'` subpath:

- `LiveStateRecorder` / `liveStateRecorder()` factory
- `LiveLLMTracker` / `LiveToolTracker` / `LiveAgentTurnTracker`
- `LLMLiveState` / `ToolLiveState` / `AgentTurnLiveState` (state shape types)
- `LiveStateRunnerLike` (minimal Runner shape required by `subscribe`)

### Bumped — peer dependency on footprintjs to `>=4.17.2`

`LiveStateRecorder` extends `BoundaryStateTracker<TState>` which lands in footprintjs v4.17.2. Existing v4.17.1 consumers will see a peer-dep warning until they bump. No breaking changes in either library.

## [2.14.1]

### Added — `StepNode` payload fields for ReAct steps

`StepNode` now carries the actual data crossing each ReAct boundary, not just metadata. Three new optional fields populated during `buildStepGraph`:

- `assistantText` — LLM's text content. Set on `llm->tool` (the reasoning emitted alongside `tool_use` blocks) and on `llm->user` (the terminal answer).
- `toolArgs` — tool input arguments the LLM produced. Set on `llm->tool` from the matching `tool.start` event payload.
- `toolResult` — tool result returned to the LLM. Set on `tool->llm` from the preceding `tool.end` event payload.

Lets renderers (e.g. agentfootprint-lens NodeDetailPanel) surface "what arrived / what was produced" per ReAct step without consumer-side correlation.

### Fixed — `SUBFLOW_IDS.FINAL` now matches the route-branch key

`SUBFLOW_IDS.FINAL` was `'sf-final'` but the Agent mounts the final-answer composition via `addSubFlowChartBranch('final', ...)` — the branch key IS the subflow id, no `sf-` prefix. The mismatch leaked the final subflow into the user-facing StepGraph as a phantom "step". Now `SUBFLOW_IDS.FINAL = 'final'`, and `BoundaryRecorder`'s `AGENT_INTERNAL_LOCAL_IDS` correctly skips it.

### Added — `SUBFLOW_IDS.THINKING` registered + filtered

The v2.14 thinking-normalize subflow (`sf-thinking`) and its inner handler subflows (`thinking-anthropic`, `thinking-openai`) are now declared in `SUBFLOW_IDS` and filtered from the StepGraph via `AGENT_INTERNAL_LOCAL_IDS` plus a new `thinking-` prefix matcher in `isAgentInternalId()`. The wrapping LLM step's `assistantText`/`toolArgs`/`toolResult` already carry the relevant info, so the inner subflows don't surface as separate user-facing steps.

## [2.14.0]

### Added — Extended-thinking subsystem (Anthropic + OpenAI o1/o3)

When the LLM emits reasoning blocks (Anthropic extended thinking, OpenAI o1/o3 `reasoning_summary`), v2.14 normalizes them into a provider-agnostic `ThinkingBlock[]`, persists the assistant message with byte-exact signature for the round-trip the next turn requires, and surfaces them on the typed-event stream so live UIs can render reasoning per iteration without post-walking `scope.history`.

**Two-layer architecture:**

- **CONSUMER-FACING:** `ThinkingHandler` — a small function-pair `{id, providerNames, normalize, parseChunk?}`. Provider authors and custom-LLM consumers implement this shape. Auto-wired by `provider.name` via the registry.
- **FRAMEWORK-INTERNAL:** each handler is auto-wrapped in a real footprintjs subflow at chart build time. The subflow gets its own `runtimeStageId`, narrative entry, and InOutRecorder boundary — full trace observability for free without consumers writing flowchart code.

Same pattern as v2.6 caching, v2.11.5 reliability, v2.11.6 tool-providers: a small typed surface for the consumer, a real subflow for the framework.

**Pre-implementation 7-panel review** (Anthropic + OpenAI + Architect + footprintjs + SRE + Security + QA, each with architect + coder dual lens) ran before EVERY phase. **Post-implementation 7-panel review** at the end of every phase, with must-fixes folded in before the next phase opened. Each phase shipped its own 7-pattern test matrix (unit · scenario · integration · property · security · performance · ROI).

#### Builder surface

```ts
// Request-side: ASK the model to think.
//   Anthropic: sets thinking: { type: 'enabled', budget_tokens } on the wire.
//   OpenAI:    no-op (o1/o3 reasoning is selected at the model id level).
Agent.create({ provider: anthropic({...}), model: 'claude-sonnet-4-5' })
  .thinking({ budget: 5000 })
  .build();

// Response-side: NORMALIZE the response (auto-wired by provider.name).
// Override per-agent when you need custom normalization or opt out:
agent.thinkingHandler(myCustomHandler);  // override
agent.thinkingHandler(null);             // opt out
```

`max_tokens` is auto-bumped to `budget + 1024` when the resolved value would violate Anthropic's `max_tokens > thinking.budget_tokens` invariant. Consumers who explicitly set `maxTokens` keep their choice.

#### Round-trip integrity (Anthropic)

Anthropic's signed thinking blocks must echo back BYTE-EXACT in subsequent assistant turns or the API rejects with HTTP 400. `LLMMessage.thinkingBlocks` (PERSISTED — different from `ephemeral`) carries the signature through `scope.history`; `AnthropicProvider.toAnthropicMessages` serializes them first in the assistant content array (Anthropic's wire-format ordering rule). Tested with tricky base64 + padding + trailing-whitespace signatures across the full pipeline.

#### Live event stream — collect during traversal

Per-iteration thinking content lands on `agentfootprint.stream.thinking_end.payload.blocks`. Live UIs subscribe once, accumulate as iterations complete — no post-walking `scope.history`:

```ts
agent.on('agentfootprint.stream.thinking_end', (e) => {
  // e.payload.blocks: readonly ThinkingBlock[]
  // e.payload.iteration: which agent loop iteration produced these
  // e.payload.totalChars / blockCount / tokens: metadata
});
```

Same data the framework persists to `LLMMessage.thinkingBlocks` (post-`providerMeta` strip). Privacy: wildcard (`*`) recorders piping to external sinks (Datadog, CloudWatch, OTel) will see reasoning content — same risk profile as `stream.token`.

#### Three new typed events (count 52 → 55)

- `agentfootprint.stream.thinking_delta` — per-chunk streaming reasoning fragments (Anthropic streams these; OpenAI doesn't, as of early 2026)
- `agentfootprint.stream.thinking_end` — per-call summary with full blocks (use this for live per-iteration UIs)
- `agentfootprint.agent.thinking_parse_failed` — graceful-failure signal when a handler's `normalize()` throws; framework drops the blocks and continues, same pattern as v2.11.6 `tools.discovery_failed`

#### Three shipped handlers

- `anthropicThinkingHandler` (`'anthropic'` + `'browser-anthropic'`) — Anthropic + browser direct-fetch, byte-exact signature
- `openAIThinkingHandler` (`'openai'`) — o1 string + o3+ structured `reasoning_summary` array; all blocks marked `summary: true`
- `mockThinkingHandler` (`'mock'`) — canonical reference implementation; defensive `isMockRaw` guard against malformed shapes

Future provider authors implement `ThinkingHandler` and append to `SHIPPED_THINKING_HANDLERS`; the cross-cutting contract test (`test/thinking/cross-cutting.test.ts`) iterates the registry and pins invariants for every handler.

#### `providerMeta` strip — defense in depth

`ThinkingBlock.providerMeta` is documented as "escape hatch for fields the normalized shape doesn't model." The framework strips it from blocks before persisting to `scope.thinkingBlocks` (which feeds `LLMMessage.thinkingBlocks` → audit logs and the event payload). Type doc declared this; Phase 6 enforced it via test + source fix.

#### Phase summary

- **Phase 1** — types foundation (`ThinkingBlock`, `ThinkingHandler`, registry, mock)
- **Phase 2** — three typed events (`thinking_delta`, `thinking_end`, `thinking_parse_failed`)
- **Phase 3** — framework wiring: `buildThinkingSubflow` + auto-wire by `provider.name` + build-time conditional mount (zero overhead for non-thinking agents)
- **Phase 4a** — `AnthropicThinkingHandler` (response normalization, byte-exact signature)
- **Phase 4b** — `AnthropicProvider` serialization (request → response → round-trip on second turn)
- **Phase 5** — `OpenAIThinkingHandler` (string + structured array shapes)
- **Phase 6** — cross-cutting: registry-iterating contract test + E2E 2-turn signature round-trip + `providerMeta` non-leak. Source fixes for `MockThinkingHandler` defensive guard and `providerMeta` strip in `buildThinkingSubflow`
- **Phase 6.5** — request-side activation: `LLMRequest.thinking?: { budget }`, `AgentBuilder.thinking({budget})`, plumbed through `callLLM`. `AnthropicProvider` translates to wire format; OpenAI ignores
- **Phase 6.5b** — `BrowserAnthropicProvider` reaches v2.14 parity (request body + response + streaming `thinking_delta` + `signature_delta` accumulation). `max_tokens` auto-bump in both providers
- **Phase 6.6** — `StreamThinkingEndPayload.blocks` for live per-iteration consumers; closes the "post-walk scope.history" anti-pattern

Test suite: 2017/2017 (was 1862 before v2.14). Build clean (CJS + ESM). Lint clean. Format clean.

## [2.13.0]

### Added — Instructor-style schema retry on the reliability gate

When the LLM emits valid JSON that fails your `outputSchema` (e.g. `amount` came back as `"USD 50"` instead of `50`), v2.13 re-prompts the same model with the validation error — within the SAME turn — for up to N retries. Each retry's feedback is an ephemeral message: visible to the model, never persisted to memory or audit logs. Composes on top of the existing v2.11.5 reliability gate; no new factory.

**Pattern parallels v2.11.6 `discoveryProvider` + v2.12 `sequencePolicy`:** the library extends primitives, ships a recipe; consumers build the convenience layer in user-land. Avoids API lock-in before real usage shapes the right factory.

**Pre-implementation 7-panel review** (Anthropic + OpenAI + tool-dispatch + architect + footprintjs + SRE + security + QA) surfaced 7 must-fix items + 10 doc notes; all folded in before code landed. **Post-implementation 7-panel review** in CHANGELOG section below.

#### `ReliabilityScope` extension

```ts
interface ReliabilityScope {
  // existing
  attempt, providerIdx, response?, error?, errorKind, latencyMs, ...

  // NEW in v2.13
  validationError?: { message: string; path?: string; rawOutput?: string };
  validationErrorHistory: readonly string[];   // accumulates across retries
}
```

Rules read these to drive `retry`/`fail-fast` on schema-fail outcomes.

#### `ReliabilityRule.feedbackForLLM`

```ts
interface ReliabilityRule {
  // existing
  when;
  then;
  kind;
  label?;

  // NEW in v2.13
  feedbackForLLM?: string | ((s: ReliabilityScope) => string | Promise<string>);
}
```

When a rule fires with `then: 'retry'` (or `'retry-other'`) AND `feedbackForLLM` is set, the gate appends an ephemeral user message to the next request. Sync OR async (callback may return Promise). Throwing callbacks are caught and fall back to a generic message — never abort the run.

#### `LLMMessage.ephemeral` (persistence flag)

```ts
interface LLMMessage {
  // existing
  role;
  content;
  toolCallId?;
  toolName?;
  toolCalls?;

  // NEW in v2.13 — persistence flag (NOT a visibility flag)
  ephemeral?: boolean;
}
```

Critical clarification (v2.13 7-panel security reviewer's concern): `ephemeral` is a PERSISTENCE flag, not a VISIBILITY flag. Ephemeral messages:

- ✅ ARE sent to the LLM in the next request (visible to the model, count toward context window)
- ✅ ARE observable via narrative / recorders / typed events (visible to humans for debugging + forensics)
- ❌ NOT persisted to `scope.history` (so memory writes / `getNarrative()` snapshots don't include them)

An attacker cannot use the ephemeral marker to construct audit-invisible prompts.

#### `ValidationFailure` sentinel + `OutputSchemaValidator` hook

```ts
class ValidationFailure extends Error {
  readonly stage: 'json-parse' | 'schema-validate';
  readonly path?: string;
  readonly rawOutput?: string;
}

type OutputSchemaValidator = (response: LLMResponse) => void;
```

Caller-supplied validators throw `ValidationFailure` to signal schema-fail to the reliability loop. The framework auto-builds a validator from `outputSchemaParser` when both `outputSchema()` AND `reliability()` are configured on the same agent — consumers don't need to write their own validator for the common case.

#### `defaultStuckLoopRule` + `lastNValidationErrorsMatch` helpers

```ts
import { defaultStuckLoopRule, lastNValidationErrorsMatch } from 'agentfootprint/reliability';

// Drop in BEFORE retry rules:
.reliability({
  postDecide: [
    defaultStuckLoopRule,                // ← fail-fast on 2 identical errors
    { when: ..., then: 'retry', feedbackForLLM: ..., ... },
    { when: ..., then: 'fail-fast', ... },
  ],
})
```

Stuck-loop detection is a built-in rule (must-fix #4 from 7-panel review). `kind: 'schema-stuck-loop'` surfaces on `ReliabilityFailFastError.kind` for caller branching. Custom n: `lastNValidationErrorsMatch(scope, 3)`.

#### `agentfootprint.agent.output_schema_validation_failed` event

```ts
interface AgentOutputSchemaValidationFailedPayload {
  message: string;
  stage: 'json-parse' | 'schema-validate';
  path?: string;
  rawOutput?: string;
  attempt: number;
  cumulativeRetries: number; // leading indicator for model drift
}
```

**Naming clarification** (security reviewer's concern): the event lives in the `agent.*` domain (parallel to `agent.turn_end`), NOT `eval.*` — because "schema" is overloaded in agentfootprint and `output_schema` makes the scope unambiguous. Tool-input schema validation is a different concern handled at the provider layer.

Fires BEFORE PostDecide rules evaluate, so observability sees every validation failure even if a buggy rule routes to fail-fast or swallows it (must-fix #2). Payload includes `attempt` + `cumulativeRetries` for SRE dashboards (must-fix #3).

Total event count: 51 → 52.

#### Validation only fires on terminal turns (must-fix #1)

When the LLM returns `toolCalls.length > 0` (a tool-using turn, not a final answer), validation is skipped. Tool-call turns aren't terminal output; validating them would be premature and break the agent loop. This guard is enforced in `callLLM.ts`; consumers writing custom validators should mirror it.

#### Implementation

- **`src/adapters/types.ts`** — `LLMMessage.ephemeral` field; widened `PermissionChecker.check()` (was already widened in v2.12).
- **`src/reliability/types.ts`** — `ReliabilityScope.validationError` + `validationErrorHistory`; `ReliabilityRule.feedbackForLLM`.
- **`src/core/agent/stages/reliabilityExecution.ts`** — validation hook in retry loop; ephemeral feedback append via `applyFeedback` helper; `lastNValidationErrorsMatch` + `defaultStuckLoopRule` exports.
- **`src/core/agent/stages/callLLM.ts`** — `outputSchemaParser` dep; auto-builds `postValidate` hook from parser; passes through to `executeWithReliability`. Guards on `toolCalls.length === 0` (must-fix #1). Extracts `path` from Zod-style `.issues` when present.
- **`src/core/Agent.ts`** — passes `outputSchemaParser` through to `callLLM` deps when both reliability + outputSchema are configured.
- **`src/events/payloads.ts`** + **`src/events/registry.ts`** — `AgentOutputSchemaValidationFailedPayload`; new entry in `ALL_EVENT_TYPES` (count 51 → 52).
- **`src/reliability/index.ts`** — export `ValidationFailure`, `lastNValidationErrorsMatch`, `defaultStuckLoopRule`, `OutputSchemaValidator`.

#### Tests (16 new in `test/reliability/strict-output.test.ts` — full 7-pattern matrix)

| Pattern        | Coverage                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Unit        | `lastNValidationErrorsMatch` (4 tests); `defaultStuckLoopRule` (2 tests)                                                                                                                           |
| 2. Scenario    | Model fails once → retry with feedback → succeeds (1 test)                                                                                                                                         |
| 3. Integration | `runTyped()` returns parsed value after retry (1 test); throws `ReliabilityFailFastError` when exhausted (1 test)                                                                                  |
| 4. Property    | Random fail counts 0..3 preserve dispatch invariant (1 test)                                                                                                                                       |
| 5. Security    | Throwing `feedbackForLLM` falls back to generic + run continues (1 test); ephemeral messages never leak to `scope.history` (1 test)                                                                |
| 6. Performance | 50 successful runs without validation fail under 5s (overhead bound, 1 test)                                                                                                                       |
| 7. ROI         | RefundBot stuck-loop guard fires before retry exhaustion (1 test); event payload carries the right fields (1 test); validation does NOT fire on tool-call turns (1 test, must-fix #1 verification) |

Running total: 1862/1862 tests across the suite.

#### Recipe + example

- **`examples/features/12-strict-output.ts`** — `strictOutputRules({maxRetries})` factory in user-land (~30 LOC); 3 scenarios (happy, retry-with-feedback, stuck-loop fail-fast).
- **`docs-site/src/content/docs/guides/strict-output.mdx`** — full recipe page using CodeFile region markers; explains why no library factory ships; composition order with reliability + outputFallback; streaming trade-off; anti-patterns including security concerns from the 7-panel review.

#### Backward compatibility

None broken. Existing v2.11.5 reliability rules work unchanged — the new `feedbackForLLM` field is optional and ignored when absent. Existing `outputSchema` consumers (parseOutput / runTyped) work unchanged — validation INSIDE the loop only happens when `reliability` is ALSO configured on the same agent.

#### Pattern locked in across 3 features

| Feature                                          | Library effort | Recipe                       |
| ------------------------------------------------ | -------------- | ---------------------------- |
| v2.11.6 `discoveryProvider` (async ToolProvider) | ~5 days        | docs/tool-discovery.mdx      |
| v2.12 `sequencePolicy` (sequence governance)     | ~2 days        | docs/sequence-governance.mdx |
| v2.13 `strictOutput` (Instructor-style retry)    | ~3 days        | docs/strict-output.mdx       |

Library extends primitives; consumers ship convenience layers; recipes in docs. Avoids API lock-in before real consumer patterns shape the right factory. If 5+ consumers ship the same factory shape over the next quarter, we promote to first-class library export in v3.

## [2.12.1]

### Fixed — 7-pattern test coverage backfill

Project rule: every release ships tests covering all 7 patterns of the matrix (unit · scenario · integration · property · security · performance · ROI). Pre-release reviews of v2.11.6 (`async-provider`) and v2.12 (`policy-halt`) found gaps in the property + performance + ROI columns. This patch release backfills them retroactively. **No source code changes; tests only.**

#### v2.11.6 backfill — `test/tool-providers/async-provider.test.ts` (+6 tests)

- **PROPERTY** — random sync/async/throw provider compositions hold dispatch-shape invariants (sync → non-Promise; async → Promise; sync-throw → throws; async-reject → rejects, drained safely)
- **PROPERTY** — random forbidden-pattern + random sequence runs never silently dispatch a denied tool
- **PERF (sync)** — `staticTools.list()` × 1000 < 250ms (zero-overhead claim, ~50µs/call)
- **PERF (sync)** — `gatedTools(staticTools, pred).list()` × 1000 < 300ms (decorator overhead bound)
- **PERF (async)** — 50 turns × 2 iterations dispatch never doubles `list()` calls (cache contract holds under load)
- **ROI** — Rube-style hub adapter end-to-end: TTL cache + AbortSignal + start/completed events + dispatch all wired together

#### v2.12 backfill — `test/security/policy-halt.test.ts` (+5 tests)

- **PROPERTY** — random safe-name sequences vs random dangerous-name patterns: no false-positive matches
- **PROPERTY** — random-prefix + dangerous-suffix sequences ALWAYS match their dangerous pattern
- **PERF** — `extractSequence(history)` over 1000-message history < 50ms
- **PERF** — `extractSequence` skipping synthetic denies in 1000-message history < 50ms
- **PERF** — sync `permissionChecker.check()` × 1000 < 300ms (overhead bound)

#### Process change

Going forward, every new feature release MUST hit all 7 patterns from the start. The pre-release 7-panel review now includes a Test/QA reviewer who audits the matrix and blocks release if any column is missing.

#### Tests

1846/1846 (1835 pre-backfill + 11 new). No source changes.

## [2.12.0]

### Added — sequence-aware PermissionChecker (the recipe primitive)

Single-call permission (v2.4) answers _"is this tool allowed?"_ in isolation. v2.12 enriches the check ctx so consumers can build sequence-aware governance — security (exfil chains), cost (wasteful patterns), correctness (idempotency caps) — over the SAME `PermissionChecker` interface, no new factory required.

**Pattern parallels v2.11.6 `discoveryProvider`:** the library extends a primitive, ships a recipe; consumers build the convenience layer in user-land. Avoids API lock-in before real usage shapes the right factory.

#### `PermissionRequest` enrichment (5 new fields)

```ts
interface PermissionRequest {
  // existing
  capability;
  actor;
  target?;
  context?;

  // NEW in v2.12
  sequence?: readonly ToolCallEntry[]; // dispatched calls so far this run
  history?: readonly LLMMessage[]; // full conversation
  iteration?: number; // current ReAct iteration
  identity?: { tenant?; principal?; conversationId };
  signal?: AbortSignal;
}
```

The framework derives `sequence` on demand from `scope.history` via `extractSequence()` — single source of truth, survives `agent.resumeOnError(checkpoint)` correctly. No parallel state in scope.

#### `PermissionDecision` extension — `'halt'` + `tellLLM` + `reason`

```ts
interface PermissionDecision {
  // existing
  result: 'allow' | 'deny' | 'gate_open';
  rationale?, policyRuleId?, gateId?

  // NEW in v2.12
  result: ... | 'halt';                   // terminates run via PolicyHaltError
  reason?: string;                        // telemetry tag (machine-readable)
  tellLLM?: ToolResultContent;            // LLM-facing synthetic tool_result
}
```

`'halt'` writes a synthetic tool_result (using `tellLLM`) to history BEFORE throwing — Anthropic / OpenAI tool_use ↔ tool_result protocol stays satisfied; conversation history is consistent for resume.

#### Default `tellLLM` is deliberately generic

Omitted `tellLLM` defaults to `"Tool '${name}' is not available in this context."` — NEVER falls back to `reason` (which is telemetry, e.g. `'security:exfiltration'`). Leaking the reason tag to the LLM teaches it the rule space; consumers who want a richer message provide `tellLLM` explicitly.

#### `PolicyHaltError` typed error

```ts
class PolicyHaltError extends Error {
  reason: string; // telemetry tag from rule
  tellLLM?: ToolResultContent;
  sequence: readonly ToolCallEntry[];
  iteration: number;
  history: readonly LLMMessage[];
  proposed: { name: string; args: unknown };
  checkerId?: string;
}
```

Parallel to `ReliabilityFailFastError`. Caller branches on `e.reason.startsWith('security:')` etc. for alert routing (PagerDuty / Slack / dashboard).

#### Strict halt ordering (audit-trail completeness)

When `{ result: 'halt' }` fires:

1. Synthetic tool_result appended to `scope.history`
2. `agentfootprint.permission.halt` event emitted
3. Stage commits (commitLog has the entry, runtimeStageId complete)
4. `scope.$break` propagates
5. `Agent.run()` catches at the API boundary, throws `PolicyHaltError`

If anything in the halt path throws, the audit trail is still committed before the run terminates. `agent.run()` exempts `PolicyHaltError` (and `ReliabilityFailFastError`, `PauseSignal`) from the auto-checkpoint wrapping so callers can `instanceof` the typed error directly.

#### One new typed event — `agentfootprint.permission.halt`

```ts
interface PermissionHaltPayload {
  checkerId?: string;
  target: string;
  reason: string;
  tellLLM?: string;
  iteration: number;
  sequenceLength: number;
}
```

Routes via existing `PermissionRecorder` bridge (no new bridge). `PermissionCheckPayload.result` widened to include `'halt'`; `PermissionCheckPayload.reason` field added for telemetry routing on the existing event. Event count: 50 → 51.

#### `extractSequence(history, iteration, options?)` exported helper

Pure function: walks history, returns `readonly ToolCallEntry[]` of dispatched calls in order. Filters out:

- Calls without a matching `tool` message (in-flight from current turn)
- Calls whose tool_result starts with `[permission denied:` (synthetic denies — never executed)

Optional `resolveProviderId(toolName) => string | undefined` for cross-hub policy matching (`'local'` for static tools; provider's `id` for `discoveryProvider` tools).

#### Implementation

- **`src/adapters/types.ts`** — `PermissionRequest` enriched; `PermissionDecision` widened with `'halt'` + `tellLLM` + `reason`; `PermissionChecker.check()` may return `Promise<Decision>` OR `Decision` (sync zero-overhead path); `ToolCallEntry` + `ToolResultContent` types added.
- **`src/security/PolicyHaltError.ts`** (new) — typed error class, `PolicyHaltContext` shape.
- **`src/security/extractSequence.ts`** (new) — pure helper, `SYNTHETIC_DENY_PREFIX` exported for consumer policies that want to filter their own.
- **`src/core/agent/stages/toolCalls.ts`** — pass enriched ctx to `permissionChecker.check()`; handle `'halt'` result with strict ordering (synthetic → event → commit → $break).
- **`src/core/agent/types.ts`** — `AgentState.policyHalt*` fields added.
- **`src/core/Agent.ts`** — halt translation in `finalizeResult()`; `PolicyHaltError` exempted from `RunCheckpointError` wrapping (parallel to `PauseSignal` / `ReliabilityFailFastError`).
- **`src/events/payloads.ts`** + **`src/events/registry.ts`** — `PermissionHaltPayload` + entry; `PermissionCheckPayload.result` widened; `PermissionCheckPayload.reason` field added; `ALL_EVENT_TYPES` count 50 → 51.

#### Tests (14 new in `test/security/policy-halt.test.ts`)

Enriched ctx (sequence + history + iteration + identity) / halt → PolicyHaltError with full context / halt without `tellLLM` defaults to safe generic (NEVER leaks `reason`) / `permission.halt` event / strict ordering (synthetic before throw) / `extractSequence` helper (skips synthetic denies, skips in-flight, custom providerId resolver) / async checker (Promise return) / no regression on `'allow'` / `'deny'` / sequence-aware user-land policies (forbidden-suffix + frequency-limit).

#### Recipe + example

- **`examples/features/11-sequence-policy.ts`** — `sequencePolicy({ forbidden, limits })` factory in user-land (~80 LOC); three scenarios (happy path, cost rule denies + LLM recovers, security rule halts via `PolicyHaltError`).
- **`docs-site/src/content/docs/guides/sequence-governance.mdx`** — full recipe page using CodeFile region markers; explains why no library factory ships (lock-in risk + cost-benefit); composition with `gatedTools`; anti-patterns; deny vs halt decision matrix.

#### Backward compatibility

None broken. Existing v2.4 `PermissionChecker` consumers work unchanged — the new fields are optional reads, the new result is opt-in. The `PermissionDecision.result` widening is a strict superset; existing return types still satisfy the new union.

## [2.11.6]

### Added — async ToolProvider for runtime tool discovery

`ToolProvider.list(ctx)` may now return EITHER `readonly Tool[]` (sync, the 99% case — `staticTools`, `gatedTools`, `skillScopedTools`) OR `Promise<readonly Tool[]>` (async, discovery-style providers backed by tool hubs / MCP registries / per-tenant catalogs). The agent runtime checks `result instanceof Promise` before awaiting, so sync providers pay zero microtask overhead.

```ts
const provider: ToolProvider = {
  id: 'rube',
  async list(ctx) {
    const response = await fetch('/api/tools', { signal: ctx.signal });
    return parseTools(await response.json());
  },
};

const agent = Agent.create({ provider: llm, model: 'claude-sonnet-4-5-20250929' })
  .toolProvider(provider)
  .build();
```

This is what unlocks Rube / Composio / Arcade / custom-hub adapters as user code over the existing `ToolProvider` abstraction — no library API additions required.

#### Type widening

`ToolProvider.list(ctx): readonly Tool[]` → `readonly Tool[] | Promise<readonly Tool[]>`. No code changes needed for existing sync providers; the sync return type is a strict subset of the new union.

#### `ToolDispatchContext.signal`

`ctx` carries the agent's `AbortSignal` (propagated from `agent.run({ env: { signal } })`). Async providers MUST honor it — when the agent run is cancelled, an in-flight catalog fetch should abort instead of holding the run open. Sync providers can ignore.

#### `agentfootprint.tools.discovery_failed` event

A throwing or rejecting provider emits the typed event with `{ providerId, error, errorName, iteration }` and re-throws. Discovery failure is loud by design — silently dropping tools mid-conversation produces non-deterministic agent behavior harder to debug than a crash. For graceful degradation, configure `.reliability(...)` to route discovery failures via retry / fallback / fail-fast.

#### One `list()` call per iteration

The Tools slot caches the resolved `Tool[]` in a closure shared with the toolCalls handler. When the LLM dispatches a tool from your provider, the handler reads from the cache instead of re-invoking `list()` — async providers pay the discovery cost once per turn, not twice. Fresh chart per `agent.run()` ensures concurrent runs don't share cache state.

#### Tools subflow split: Discover → Compose

The Tools slot subflow now exposes two stages instead of one, so async discovery is first-class observable in every recorder/trace surface:

```
sf-tools subflow:
  ├── Discover  ← own runtimeStageId, own InOutRecorder boundary,
  │              own narrative entry. Calls provider.list(ctx).
  │              Emits discovery_started → discovery_completed (or
  │              discovery_failed). When no toolProvider is set,
  │              early-returns in microseconds (no-op fast path).
  └── Compose   ← merges static + provider + per-skill schemas into
                  the slot. Reads providerToolCache.current populated
                  by Discover.
```

Why: with discovery + compose merged into one stage (the v2.5–v2.11.5 shape), async-discovery latency was indistinguishable from compose latency in the trace, the discovery had no dedicated `runtimeStageId` for KeyedRecorder lookups, and InOutRecorder showed one boundary instead of two. The split fixes all three. Sync providers pay zero extra cost — Discover early-returns when no provider is set, and the dynamic `instanceof Promise` check still skips await for sync provider returns.

Two new typed events round it out:

- **`agentfootprint.tools.discovery_started`** — `{ providerId, iteration }`. Fires before `provider.list(ctx)`.
- **`agentfootprint.tools.discovery_completed`** — `{ providerId, iteration, durationMs, toolCount }`. Fires after a successful `list()` resolution. Use the started→completed pair for per-iteration discovery latency.

`tools.discovery_failed` payload now also carries `durationMs` so timeouts are distinguishable from immediate rejections.

Event count: 48 → 50.

#### Implementation

- **`src/tool-providers/types.ts`** — widened `list()` return type; added `signal?: AbortSignal` to `ToolDispatchContext`.
- **`src/core/slots/buildToolsSlot.ts`** — split into Discover + Compose stages; dynamic `instanceof Promise` check (sync fast-path); typed `discovery_started` / `discovery_completed` / `discovery_failed` emits; `ProviderToolCache` written by Discover, read by Compose AND the toolCalls handler.
- **`src/core/agent/stages/toolCalls.ts`** — dispatch reads from `providerToolCache.current`, eliminating the second `provider.list(ctx)` call per iteration.
- **`src/tool-providers/gatedTools.ts`** — propagates async return through the decorator chain via `result instanceof Promise ? result.then(filter) : filter(result)`. A sync inner stays sync; an async inner stays async.
- **`src/recorders/core/ToolsRecorder.ts`** (new) — EmitBridge for `agentfootprint.tools.*`, parallel to `streamRecorder` / `skillRecorder`. Auto-attached in `Agent.run()`.
- **`src/events/payloads.ts`** + **`src/events/registry.ts`** — `ToolsDiscoveryStartedPayload` / `ToolsDiscoveryCompletedPayload` / `ToolsDiscoveryFailedPayload` + 3 entries in `ALL_EVENT_TYPES` (now 50).

#### Tests (15 new in `test/tool-providers/async-provider.test.ts`)

Sync path / async path / sync throw / async reject / signal abort / mixed sync+async chain / no double-discovery (cache contract) / concurrent agents (reentrancy) / discovery_started→discovery_completed ordering with timing / failed discovery emits started→failed (no completed) / no-provider agents emit zero discovery events.

#### Docs + example

- **`docs-site/src/content/docs/guides/tool-discovery.mdx`** — sync vs async contract, TTL caching pattern, signal propagation, failure semantics, concurrency notes.
- **`examples/features/10-discovery-provider.ts`** — `discoveryProvider({ hub, ttlMs })` over a generic `ToolHub` interface; three scenarios (happy + cache hit, cancellation, failure path).
- **`docs-site/src/content/docs/guides/observability.mdx`** — `tools.discovery_failed` listed in event taxonomy; event count bumped to 58.

#### Backward compatibility

None broken. Sync providers (`staticTools`, `gatedTools`, `skillScopedTools` and any custom sync provider) work unchanged. The widened `list()` return type is a strict superset; the new `ctx.signal` is optional. The cache eliminates a redundant `list()` call that was already correct under the v2.11.5 contract.

## [2.11.5]

### Added — reliability gate wired into Agent

The v2.11.1 reliability foundation (`CircuitBreaker`, `classifyError`, `ReliabilityConfig`, `ReliabilityFailFastError`, `buildReliabilityGateChart`) now has a consumer-facing surface inside `Agent`:

```ts
const agent = Agent.create({ provider, model: 'mock' })
  .system('You triage support tickets.')
  .reliability({
    postDecide: [
      {
        when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
        then: 'retry',
        kind: 'transient-retry',
      },
      { when: (s) => s.error !== undefined, then: 'fail-fast', kind: 'unrecoverable' },
    ],
    circuitBreaker: { failureThreshold: 3 },
  })
  .build();

try {
  await agent.run({ message: 'help' });
} catch (e) {
  if (e instanceof ReliabilityFailFastError) {
    console.log(e.kind, e.reason, e.payload);
  }
}
```

#### Streaming + reliability semantics (first-chunk arbitration)

Streaming and retry don't compose cleanly — a stream that errors after token 5 either replays duplicates or has to buffer the whole stream first (losing progressive UX). LLM providers don't expose resume tokens or per-stream idempotency, so the conflict can't be solved at the boundary today.

agentfootprint adopts **first-chunk arbitration** (the same pattern LangChain uses in `RunnableWithFallbacks`):

- **Pre-first-chunk failures** — full rule set fires (retry, retry-other, fallback, fail-fast).
- **Post-first-chunk failures** — only `ok` and `fail-fast` are honored. Rules wanting retry/retry-other/fallback are escalated to fail-fast with `kind: 'mid-stream-not-retryable'`.

The consumer keeps streaming on or off as their own choice; reliability adapts. See the [reliability gate guide](https://footprintjs.github.io/agentfootprint/guides/reliability-gate/) for the industry-pattern comparison and design rationale.

#### Implementation

- **`src/core/agent/stages/reliabilityExecution.ts`** (new) — JS retry-loop helper invoked by `callLLM` when reliability is configured. Pure function over the LLMCallFn callback; reuses `CircuitBreaker.ts` admit/recordSuccess/recordFailure pure functions; reuses `classifyError` for `errorKind` taxonomy. Closure-local state (attempt, providerIdx, breakerStates, attemptsPerProvider) — closure not scope, because this loop runs WITHIN one footprintjs stage execution.
- **`src/core/agent/stages/callLLM.ts`** — refactored: extracted `singleProviderCall` so the SAME call function feeds both the unconfigured path (single-shot) and the reliability path (retry loop). Streaming chunk emission unchanged; added `onFirstChunk` hook for the arbitration boundary.
- **`src/core/agent/AgentBuilder.ts`** — new `.reliability(config)` method (throws on double-call).
- **`src/core/Agent.ts`** — new constructor parameter + private field; threaded through `buildCallLLMStage`. `finalizeResult` translates fail-fast scope state into typed `ReliabilityFailFastError` at the API boundary.
- **`package.json`** — `./reliability` subpath added to exports map (alongside existing `./security`, `./locales` etc.).

#### Tests + example

- **`test/core/agent-reliability.test.ts`** (new) — 5 integration tests via the public surface: happy path, retry success, post-decide fail-fast, pre-check fail-fast, double-builder rejection.
- **`examples/features/09-reliability-gate.ts`** (new) — three runnable scenarios (happy / retry / fail-fast) with `process.exit(1)` regression guards.
- **`test/core/reliability-gate-example.test.ts`** (new) — integration test wrapping the example so docs-page consumers stay aligned.
- Suite: **1806 / 1806 passing** (was 1805 before this release).

#### Documentation

- **`docs-site/src/content/docs/guides/reliability-gate.mdx`** (new) — design memo covering decision verbs, streaming semantics, industry comparison (Anthropic SDK / OpenAI SDK / LangChain `RunnableRetry` & `RunnableWithFallbacks` / LangGraph Pregel / Strands / LlamaIndex / Llama Stack), and composition with the v2.10.x reliability primitives.

#### Why this design

- **Loop-internal retry** (rather than chart-level loopTo subflow) preserves streaming, cost tracking, and the existing CallLLM event surface unchanged. Retry attempts are one stage execution; richer "every retry as a separate stage" tracing is available today via `buildReliabilityGateChart` for consumers composing raw `LLMCall + gate` patterns directly.
- **Closure state, not scope state** — the retry loop runs inside one footprintjs stage execution. Putting attempt/breakerStates into scope would commit them across iterations of the agent's outer ReAct loop, which is not the intent.
- **Reconstruct cause at the API boundary** — Error instances don't `structuredClone` cleanly through scope; we capture message+name as strings and rebuild the Error in `finalizeResult`. Consumers' `instanceof Error` checks still pass.

## [2.11.4]

### Fixed — actually fix non-null-assertion warnings in src (don't just disable)

v2.11.3 cleaned the CI by turning off `@typescript-eslint/no-non-null-assertion` globally. v2.11.4 walks back the global disable: re-enables the rule for `src/`, fixes each of the 30 source-side warnings either with a proper guard or with a targeted `eslint-disable-next-line` carrying a one-line "why this is safe" reason. Tests stay permissive (`!` is idiomatic in test assertions where the framework guarantees the value).

#### Refactored to proper guards (no `!` retained)

- **`src/recorders/observability/FlowchartRecorder.ts`** — 7 sites: `boundary.onRunStart!(e)` etc. → `boundary.onRunStart?.(e)`. Optional chaining is actually MORE correct because BoundaryRecorder methods are optional on the FlowRecorder interface; the previous `!` would have crashed if a wrapped recorder didn't implement every hook.
- **`src/patterns/SelfConsistency.ts`** — 4 sites in the merge function: `extract(results[id]!)`, `order[0]!`, `tallies.get(best)!`, `tallies.get(vote)!` → guarded by `if (value === undefined) continue`, explicit empty-results throw, and `?? 0` fallbacks.
- **`src/resilience/fallbackProvider.ts`** — 3 sites: `providers[0]!`, `providers[providers.length-1]!`, `providers[i]!` → explicit `head`/`tail` consts with throw-on-unreachable + `if (!cur) continue` loop guard.

#### Suppressed with `eslint-disable-next-line` + intent comment (legitimate post-conditions)

- **`src/adapters/llm/MockProvider.ts`** (2) — cursor bounds-checked above; signal-defined invariant inside onAbort.
- **`src/adapters/observability/otel.ts`** (2) + **`src/adapters/observability/xray.ts`** (2) — `idx >= 0` guard above + 1-element splice result.
- **`src/cache/strategyRegistry.ts`** (1) — `'*'` wildcard set at module load by registerDefaults.
- **`src/core/agent/buildToolRegistry.ts`** (1) — `skills.length > 0` guard left of ternary; assertion only fires on the truthy branch.
- **`src/lib/rag/indexDocuments.ts`** (1) — bounded by `i >= texts.length` early-return.
- **`src/memory/causal/loadSnapshot.ts`** (1) + **`src/memory/embedding/loadRelevant.ts`** (1) — `store.search` required when an embedder is configured (validated upstream by `defineMemory`).
- **`src/recorders/observability/commentary/commentaryTemplates.ts`** (1) — `hasDesc` boolean guarantees `desc` is a non-empty string.
- **`src/resilience/withCircuitBreaker.ts`** (1) — stream method conditionally defined only when `inner.stream` exists.
- **`src/resilience/withRetry.ts`** (1) — guarded by `if (provider.stream)`.
- **`src/strategies/attach.ts`** (1) — caller validates `onHandle` is set when `mode !== 'forget'`.
- **`src/stream.ts`** (1) — `queue.length > 0` guards the shift.

#### `.eslintrc.js`

- `@typescript-eslint/no-non-null-assertion`: `'warn'` (was `'off'` in v2.11.3) for src.
- Test file override now explicitly turns `no-non-null-assertion` off (idiomatic in test assertions).

#### Verification

- `npm run lint` — **0 problems** (was 365 in v2.11.2 → 0 in v2.11.3 via global disable → 0 in v2.11.4 via actual fixes).
- `tsc --noEmit` clean.
- Full suite: **1800 / 1800 passing**, no regressions.
- Release pipeline (8 gates) passes.

## [2.11.3]

### Fixed — CI lint pipeline cleaned to zero warnings

Per-commit CI lint job now passes cleanly (0 warnings) instead of surfacing 365 noisy GitHub Actions annotations on every push. The release script's gate was always tighter (`--max-warnings=99999` tolerated, fixed manually before tagging) — this release brings the per-commit CI in line so PRs and merges stay actionable.

#### Changes

- **`.eslintrc.js`** — turn off `@typescript-eslint/no-non-null-assertion`. 359 of the 365 warnings were this rule firing on idiomatic `!` usage in tests (asserting on values known to exist after a check) and source (post-condition guarantees inside well-typed maps, e.g., `registryByName.get(name)!` after we just put it in). The rule was being routinely ignored — same effective safety from `tsc` + tests; less GitHub annotation noise.
- **`src/events/dispatcher.ts`** — extracted `noopUnsubscribe` const for the already-aborted-signal path; lifts the inline `() => {}` to a named, JSDoc'd intent.
- **`src/memory/define.types.ts`** — `_T` phantom-type-parameter on `ReadonlyMemoryFlowChart<_T>` is intentional (lets consumers write `ReadonlyMemoryFlowChart<MyShape>` for documentation even though the brand erases at runtime); suppressed `no-unused-vars` with explanatory comment.
- **`src/reliability/buildReliabilityGateChart.ts`** — extracted `preContinueNoop` const for the PreCheck `'continue'` branch; lifts the inline `() => {}` to a named, JSDoc'd no-op (matches the rest of the file's pattern of named branch handlers).
- **`src/strategies/attach.ts`** — extracted `noopHostStage` for the detach-executor's host chart; updated `NOOP_UNSUBSCRIBE` to explicit `(): void => undefined`.
- **`src/strategies/compose.ts`** — added intent comment + lint-suppress on the `flush().catch(() => {})` swallow (passive-recorder discipline: flush errors don't propagate to consumer; recorder's own onError is the right channel).

#### Verification

- `npm run lint` — 0 problems (was 365 warnings).
- Full suite: **1800 / 1800 passing**, no regressions.
- `tsc --noEmit` clean.
- Release pipeline (8 gates) passes all gates.

#### What this is NOT

- **No public API changes.** All 7 modified files are either configuration or no-op extractions.
- **No behavior changes.** Lifting an inline `() => {}` to a named const, or swapping `() => {}` for `(): void => undefined`, produces identical runtime behavior.
- **No reliability wiring yet** — that lands in v2.11.4+ (the `buildAgentChart.ts` wiring + agent-builder `.withCircuitBreaker()`/`.withRetry()`/`.withFallback()` methods + `Agent.run()` error translation).

## [2.11.2]

### Refactored — Agent.ts decomposition complete

`core/Agent.ts` reduced from **2249 LOC → 710 LOC (−68%)** by extracting 11 focused files under `src/core/agent/`. **Public API surface is unchanged** — every external import site (28 of them) continues to work via re-exports from `Agent.ts`. Behavior is identical; this is a pure code organization release.

#### Files extracted to `src/core/agent/`

- **`types.ts`** — `AgentOptions`, `AgentInput`, `AgentOutput` (PUBLIC, re-exported from `Agent.ts`) + internal `AgentState`.
- **`validators.ts`** — `validateMemoryIdUniqueness`, `validateToolNameUniqueness`, `clampIterations`, `safeStringify`. Pure helpers, no class state.
- **`AgentBuilder.ts`** — full fluent builder class (547 LOC). Re-exported from `Agent.ts`.
- **`buildToolRegistry.ts`** — pure function composing the 3-source tool registry (static `.tool()` + auto-attached `read_skill` + skill-supplied tools). Handles autoActivate skill scoping + cross-source name uniqueness + same-Tool-reference dedupe across skills.
- **`buildAgentChart.ts`** — the FlowChart composition that wires every stage + slot subflow + memory subflow together. Takes a comprehensive `AgentChartDeps` interface enumerating all dependencies. The reliability gate chart (v2.11.1 foundation) wires into this file in v2.11.3+.
- **`stages/breakFinal.ts`** — terminates the ReAct loop ($break + return finalContent).
- **`stages/iterationStart.ts`** — emits per-iteration marker event.
- **`stages/route.ts`** — decider routing to 'tool-calls' or 'final'.
- **`stages/seed.ts`** — initial scope state. Factory takes `consumePendingResumeHistory` + `getCurrentRunId` accessors so the resume side-channel and current run id remain dynamic.
- **`stages/callLLM.ts`** — the LLM invocation. Factory takes provider/model/cache strategy/pricing. Streaming-first; falls back to `complete()` for the authoritative response.
- **`stages/toolCalls.ts`** — pausable tool-execution handler. Factory takes `registryByName` + optional `externalToolProvider` + optional `permissionChecker`.
- **`stages/prepareFinal.ts`** — captures turn payload for the final-branch subflow.

#### Pattern: factory functions take explicit deps

Every extracted stage that previously closed over `this.X` becomes a `build*(deps)` factory taking explicit dependencies as args. No `this` references in the extracted code; everything is testable in isolation. Per-run mutable accessors (e.g., `consumePendingResumeHistory` for the resumeOnError side-channel) are passed as closure functions so the dynamic behavior survives the move.

#### What's left in `Agent.ts` (710 LOC)

- Agent class declaration + 18 readonly fields (~150 LOC)
- Constructor (validates uniqueness, defaults cache strategy)
- Public methods (toFlowChart, getSpec, run, runOnce, resumeOnError, resume, parseOutputAsync, runTyped, getLastSnapshot, getLastNarrativeEntries)
- Private helpers (createExecutor + recorder attachment, finalizeResult, installCheckpointTracker, detectPause)
- `buildChart()` — now an ~80-line wire-up that captures `this.X` deps as locals, builds 4 slot subflows, builds 6 stage handlers via factories, calls `buildAgentChart()` and returns

#### Why this lands as its own release

1. **Atomic checkpoint.** The decomposition is a clean, behavior-preserving refactor that reviews independently of the v2.11.1 reliability foundation and the upcoming v2.11.3 wiring.
2. **De-risks the next step.** The reliability gate wiring (v2.11.3) touches `buildAgentChart.ts` (250 LOC) instead of a 2249-line monolith. Smaller blast radius, easier review, easier rollback.
3. **Sets the pattern for future subsystems.** Cache layer (v2.6) followed the same shape; reliability (v2.11.x), governance (planned), and any future cross-cutting concern should compose into `buildAgentChart.ts` rather than fight a giant `Agent.ts`.

#### Verification

- Full suite: **1800 / 1800 passing** (no regressions; same count as v2.11.1).
- `tsc --noEmit` clean.
- All 28 external import sites for `Agent`, `AgentBuilder`, `AgentInput`, `AgentOptions`, `AgentOutput` continue to work unchanged via `Agent.ts` re-exports.

#### Coming next (v2.11.3+)

- Wire the v2.11.1 reliability gate chart into `buildAgentChart.ts` via `addSubFlowChartNext('sf-reliability', gateChart)` between `IterationStart` and `CallLLM` when reliability is configured.
- Add agent-builder methods `.withRetry()` / `.withCircuitBreaker()` / `.withFallback()` to `AgentBuilder.ts`; each populates a unified internal `ReliabilityConfig`.
- Wire `Agent.run()` error translation: read `scope.reliabilityFailKind` from snapshot, throw `ReliabilityFailFastError` at the API boundary.
- Integration test exercising all three reliability modes through a real agent run.

## [2.11.1]

### Added — Reliability v2.11 internal foundation + Agent.ts decomposition (step 1)

Internal infrastructure for the rules-based reliability refactor flagged in v2.11.0's "Coming next" section. **Public API surface is unchanged** in this release — the foundation lands first as its own atomic checkpoint; wiring it into the Agent's chart lands in a follow-up patch once the Agent.ts decomposition is complete.

#### Reliability foundation (`src/reliability/`)

- **Multi-stage gate chart** built using footprintjs's native `decide()` DSL via `addDeciderFunction`. Shape: `Init → PreCheck (decider) → CallProvider → PostDecide (decider) → loopTo('pre-check')`. Branches that don't `$break()` fall through to the loopTo target → retry semantics; branches that `$break()` escape the loop with the appropriate scope state (success/failure).
- **`CircuitBreaker` as a pure state machine.** Refactored from a class with instance state to PURE FUNCTIONS (`admitCall`, `recordSuccess`, `recordFailure`, `initialBreakerState`) that take + return a serializable `BreakerState` record. State now lives in scope (round-trippable across gate invocations via inputMapper/outputMapper) instead of closure. Visible in commitLog; ready for v2.12 distributed-state via a future `BreakerStateStore` adapter.
- **`classifyError`** — pure function mapping any thrown error to a coarse `errorKind` taxonomy (`'5xx-transient'`, `'rate-limit'`, `'circuit-open'`, `'schema-fail'`, `'unknown'`) so rules match on a structured field rather than regexing on `error.message`.
- **`ReliabilityRule` / `ReliabilityScope` / `ReliabilityFailFastError` types** with full JSDoc on the three-channel discipline: scope state for runtime data (read by `Agent.run()` at the API boundary), `$emit` for passive observability (CloudWatch/X-Ray/OTel), `$break(reason)` for control flow + human narrative reason.
- **17 7-pattern tests** drive the gate chart end-to-end via real `FlowChartExecutor`, verifying retry, retry-other, fallback, and fail-fast semantics through the decider DSL. Tests pass in isolation; foundation is ready for wiring into the Agent chart in v2.11.2.

#### Agent.ts decomposition (step 1 of N)

Begin breaking up the 2249-LOC `core/Agent.ts`. Step 1 extracts the safe, dependency-free pieces using the **index-file pattern**: extracted modules live under `src/core/agent/`, and `Agent.ts` re-exports them so the 28+ existing import sites stay valid.

- **`src/core/agent/validators.ts`** — 4 pure helpers (`validateMemoryIdUniqueness`, `validateToolNameUniqueness`, `clampIterations`, `safeStringify`).
- **`src/core/agent/types.ts`** — both PUBLIC types (`AgentOptions`, `AgentInput`, `AgentOutput`) and INTERNAL `AgentState`. `Agent.ts` re-exports the public ones for back-compat.
- **`Agent.ts`: 2249 → 2006 LOC** (−243). Behavior unchanged.

Steps 2-N will extract the inline stage functions (seed, iterationStart, callLLM, route, toolCalls, breakFinal, updateSkillHistory, cacheGate) to `src/core/agent/stages/*.ts` and the chart composition to `src/core/agent/buildAgentChart.ts`. Each becomes a `build*(deps)` factory taking explicit dependencies — no `this` references in extracted code. Lands progressively in subsequent v2.11.x patches.

#### Verification

- Full suite: **1800 / 1800 passing** (1783 from v2.11.0 + 17 new reliability foundation tests).
- `tsc --noEmit` clean.
- Three-channel discipline locked into JSDoc as the canonical pattern for downstream subsystems.

#### Coming next (v2.11.2+)

- Complete the Agent.ts decomposition (extract 8 inline stages + chart composition).
- Wire the reliability gate chart into `buildAgentChart.ts` via `addSubFlowChartNext('sf-reliability', gateChart)` + a TranslateFailFast agent-level stage that translates the gate's `$break(reason)` into a typed `ReliabilityFailFastError` at the `Agent.run()` API boundary.
- Update existing builder methods (`.outputFallback()`, plus new `.withRetry()` / `.withCircuitBreaker()` / `.withFallback()` agent-builder methods) to populate the unified internal `ReliabilityConfig`. The existing standalone `withCircuitBreaker(provider, opts)` etc. functions in `agentfootprint/resilience` continue to work unchanged.

## [2.11.0]

### Added — Reliability subsystem documentation

Closes the docs/example gap noted during the v2.10.0 retrospective. v2.10.0 → v2.10.2 shipped the 3 reliability primitives; this minor release ships the unified docs + runnable example + integration test that the patch releases skipped.

- **`examples/features/08-reliability.ts`** — single runnable example covering all 3 reliability primitives end-to-end: `withCircuitBreaker` (vendor outage detection), `outputFallback` (3-tier degradation on schema failure), `resumeOnError` (mid-run failure recovery from JSON-serializable checkpoint). Three demo functions, isolated and copy-pasteable. With regression guards (`process.exit(1)` on any invariant violation).
- **`examples/features/08-reliability.md`** — companion explainer with the consumer-facing "what to copy" table.
- **`test/core/reliability-example.test.ts`** — integration test that imports `run()` from the example, asserts each of the 3 primitives engaged correctly, and pins the checkpoint shape via snapshot bounds. Catches silent example breakage so the docs page never lies.
- **`docs-site/src/content/docs/guides/reliability.mdx`** — new docs site page under Production Concerns sidebar group. Live-imports the example file via `<CodeFile path="..." />` so the docs snippet stays in sync with the runnable file. Covers all 3 primitives with state-machine diagrams, the per-instance vs distributed tradeoff for CircuitBreaker, the fail-open vs fail-closed tradeoff for outputFallback, and the tools-re-execute caveat for resumeOnError.
- **`docs-site/src/content/docs/index.mdx` updates** — "What ships today" list now mentions the Reliability subsystem with link to guide. "Roadmap" table updated through v2.11.0 with checkmarks for completed releases.
- **Sidebar entry** — "Reliability subsystem (v2.10)" added under Production Concerns.

Total project tests: **1783 / 1783 passing** (1781 from v2.10.2 + 2 new integration tests). Docs site builds clean (51 pages).

### Coming next

- **v2.11.1+** — Rules-based reliability refactor. Today's `withCircuitBreaker.shouldCount`, `withRetry.shouldRetry`, `withFallback.shouldFallback`, `outputFallback.fallback` are opaque predicate functions — invisible to the trace. v2.11.1 may refactor these to use footprintjs's `decide()` evidence-capture mechanism so every reliability decision lands in the narrative + commit log automatically (same pattern as the v2.6 cache layer's `CacheDecisionSubflow`). Design memo to follow.

## [2.10.2]

### Added — Reliability subsystem (part 3 of 3 — COMPLETE)

The Reliability subsystem ships its third and final piece. v2.10.0 was CircuitBreaker; v2.10.1 was outputFallback; v2.10.2 closes the trio with **fault-tolerant resume on error**.

- **`agent.resumeOnError(checkpoint)` + `RunCheckpointError` + auto-checkpoint at iteration boundaries.** Today's `agent.run()` throws on mid-run errors (LLM 500, vendor outage, tool throw, container restart) and the consumer must restart from scratch — losing every prior iteration's work. With this release, recoverable errors come wrapped in `RunCheckpointError` carrying a JSON-serializable checkpoint of the conversation history at the last completed iteration:

  ```ts
  import { Agent, RunCheckpointError } from 'agentfootprint';

  try {
    const result = await agent.run({ message: 'long task' });
  } catch (err) {
    if (err instanceof RunCheckpointError) {
      // Persist anywhere — Redis, Postgres, S3, queue, file.
      await checkpointStore.put(sessionId, err.checkpoint);

      // hours / restart / new process / next deploy later:
      const checkpoint = await checkpointStore.get(sessionId);
      const result = await agent.resumeOnError(checkpoint);
    } else {
      throw err; // non-recoverable — propagate
    }
  }
  ```

  **Three new exports** from the main barrel: `RunCheckpointError`, `AgentRunCheckpoint`, and `agent.resumeOnError(checkpoint, options?)`.

  **Auto-checkpoint at iteration boundaries** — the agent listens to its own `agentfootprint.agent.iteration_end` events and snapshots the conversation history into a per-run tracker. On error, the tracker's last snapshot is wrapped in `RunCheckpointError`.

  **Failure-phase classifier** — `RunCheckpointError.checkpoint.failurePoint.phase` is one of `'llm' | 'tool' | 'iteration' | 'unknown'`. Recognizes `CircuitOpenError` from v2.10.0, `AnthropicError` / `OpenAIError` / `BedrockError`. Goes straight into oncall postmortem queries.

  **Conversation-history checkpoint shape** — JSON-serializable, tiny payload, survives process restart. Tradeoff: tools inside the failed iteration **re-execute on resume**. For idempotent tools (read-only DB queries) this is fine; **for non-idempotent tools (charge card, send email) consumers MUST add their own idempotency keys**. Documented prominently. v2.10.3+ may add `toolCallId`-based dedup.

  **`AgentIterationEndPayload.history` field added** (optional, for back-compat).

  13 7-pattern tests covering happy path, error → checkpoint, end-to-end resume cycle, JSON round-trip, forward-compat version guard, missing-field validation, and failure-phase classifier. Total suite: **1781 / 1781 passing, 0 regressions.**

### Reliability subsystem complete

| Piece                    | Release | What it solves                                 |
| ------------------------ | ------- | ---------------------------------------------- |
| **`withCircuitBreaker`** | v2.10.0 | Vendor outage detection; fail-fast in <5µs     |
| **`outputFallback`**     | v2.10.1 | Schema-validation failure; 3-tier degradation  |
| **`resumeOnError`**      | v2.10.2 | Mid-run failure recovery; checkpoint + restart |

### Coming next

- **v2.11.0** — Reliability guide on docs site + runnable example covering all 3 primitives end-to-end + integration test with snapshots. Closes the docs/example gap noted in the v2.10.0 retrospective.

## [2.10.1]

### Added — Reliability subsystem (part 2 of 3)

- **`.outputFallback({ fallback, canned })` — 3-tier degradation for output-schema validation failures.** Pairs with `.outputSchema(parser)`. When the LLM's final answer fails schema validation, instead of throwing `OutputSchemaError` to the caller, the agent falls through:

  1. **Primary** — LLM emitted schema-valid JSON. Caller gets the parsed value.
  2. **Fallback** — async `fallback(error, raw)` runs; its return value is re-validated against the schema.
  3. **Canned** — static safety-net value (validated against the schema at builder time so it's _guaranteed_ to satisfy). When `canned` is set, the agent **NEVER throws** on output-schema failure — fail-open by construction.

  ```ts
  import { z } from 'zod';
  const Refund = z.object({ amount: z.number().nonnegative(), reason: z.string().min(1) });

  const agent = Agent.create({...})
    .system('You decide refund amounts.')
    .outputSchema(Refund)
    .outputFallback({
      fallback: async (err, raw) => ({
        amount: 0,
        reason: `manual review (LLM output: ${raw.slice(0, 200)})`,
      }),
      canned: { amount: 0, reason: 'unable to process — please retry' },
    })
    .build();

  // Caller never sees OutputSchemaError; gets a typed Refund either way.
  const refund = await agent.runTyped({ message: '...' });
  ```

  **Two typed events** fire on tier transitions for observability:

  - `agentfootprint.resilience.output_fallback_triggered` (tier 2 fired)
  - `agentfootprint.resilience.output_canned_used` (tier 3 fired — fallback also failed)

  **Builder-time `canned` validation** — the canned value is parsed against the schema at `.outputFallback({...})` time. Throws `TypeError` immediately if it doesn't satisfy. Misconfig surfaces in CI / dev, not at 3am when the fallback engages.

  **New method: `agent.parseOutputAsync<T>(raw)`** — async sister of `parseOutput`. Engages the fallback chain. The sync `parseOutput` stays back-compat — always throws on validation failure regardless of fallback config.

  **Fail-open vs fail-closed** is consumer choice:

  - With `canned` → agent NEVER throws on output failure (fail-open)
  - Without `canned` → if `fallback` throws or returns invalid value, the error propagates (fail-closed)

  13 7-pattern tests in `test/core/outputFallback.test.ts` covering all 3 tiers, builder-time validation, double-set guard, and event emission. Total suite: 1768 / 1768 passing, 0 regressions.

### Changed — `withCircuitBreaker` documentation

- **JSDoc note: per-instance scope, NOT distributed.** Each `withCircuitBreaker(...)` call holds its own breaker state in process memory. If you run 100 server replicas, each has its own independent breaker (matches Hystrix default). For cluster-wide coordination, layer your own Redis-backed counter via the `onStateChange` hook + `shouldCount` predicate. Surfaced after the 7-panel review on v2.10.0 — pure docs change, no API change.

### Coming next

- **v2.10.2** — `agent.resumeOnError(checkpoint)` + auto-checkpoint at iteration boundaries + `RunCheckpointError`. Reliability subsystem complete.
- **v2.11.0** — unified Reliability guide page on the docs site + runnable example covering all 3 reliability primitives + integration test.

## [2.10.0]

### Added — Reliability subsystem (part 1 of 3)

The Reliability subsystem was deferred from v2.5 → v2.6 → v2.7 → v2.8 → v2.9. It ships in three pieces — this release is the first.

- **`withCircuitBreaker(provider, options)` — Nygard-style circuit breaker decorator** under `agentfootprint/resilience`. Wraps any `LLMProvider`, tracks consecutive failures, and OPENS after `failureThreshold` failures. Once OPEN, calls fail-fast with `CircuitOpenError` (no network round-trip) until `cooldownMs` elapses. Then enters HALF-OPEN: probe calls run; `halfOpenSuccessThreshold` successes close the breaker; one failure re-opens it.

  ```ts
  import { anthropic, openai } from 'agentfootprint/llm-providers';
  import { withCircuitBreaker, withFallback } from 'agentfootprint/resilience';

  const provider = withFallback(
    withCircuitBreaker(anthropic({ apiKey }), {
      failureThreshold: 5, // open after 5 consecutive failures
      cooldownMs: 30_000, // stay open for 30s before probing
      halfOpenSuccessThreshold: 2, // need 2 probe successes to close
    }),
    withCircuitBreaker(openai({ apiKey })),
  );
  ```

  **Why this matters more than `withRetry`** — `withRetry` keeps hammering one provider with backoff during a multi-minute vendor outage. Each request burns 3 retries + backoff = ~3 sec of wasted latency before giving up to the fallback. Multiplied by your QPS, that's a lot of wasted time + tokens. The circuit breaker says "we just saw 5 failures in a row; stop calling for 30 seconds." Subsequent requests fail in <5µs, `withFallback` routes to OpenAI immediately.

  **Three states with explicit transitions:**

  ```
  CLOSED ──[ N consecutive failures ]──► OPEN
     ▲                                    │
     │                                    │ [cooldownMs elapsed]
     │                                    ▼
     └──[ M probe successes ]──── HALF-OPEN
  ```

  - **`shouldCount` predicate** — by default everything except `AbortError` counts toward the threshold. Override to ignore client errors (e.g., 4xx) so a malformed request doesn't trip the breaker for everyone.
  - **`onStateChange(state, reason)` hook** — fires on every transition. Wire to your observability stack (e.g., emit `agentfootprint.resilience.circuit_state_changed`).
  - **Streaming-aware** — `stream()` is decorated identically. A mid-stream error doesn't count toward the threshold (could be a content-filter trip on a single request); only stream failures BEFORE any chunk yields count.
  - **Composable** — wrap inside `withRetry` (per-attempt circuit check) or compose under `fallbackProvider` (which we recommend).

  **Performance:** OPEN-state rejection is sub-µs (10k rejections under 200ms in CI; <5µs/op on a hot core). The wrapped provider isn't called at all when OPEN — that's the whole point.

  12 7-pattern tests in `test/resilience/unit/withCircuitBreaker.test.ts` covering all state transitions (CLOSED → OPEN → HALF-OPEN → CLOSED, HALF-OPEN → OPEN), the `shouldCount` predicate, and composition with `withFallback`. Total suite: 1755 / 1755 passing, 0 regressions.

### Coming next — completing the Reliability subsystem

- **v2.10.1** — 3-tier `outputFallback(primary, fallback, canned)` for structured-output validation: when validation fails after maxIterations, fall through to a fallback output, then to a canned response. Different from provider fallback — this is about the SHAPE of the agent's final answer, not which LLM gets called.
- **v2.10.2** — `agent.resumeOnError(checkpoint)` + auto-checkpoint at iteration boundaries + `RunCheckpointError`. Today's pause/resume only handles intentional pauses (`askHuman`). With this, an LLM 500 mid-iteration throws `RunCheckpointError` carrying the last-known-good checkpoint, which the consumer can persist to Redis/queue/DB and resume hours/days later from a different process. Reliability subsystem complete.

## [2.9.0]

### Added

- **`otelObservability(opts)`** — OpenTelemetry distributed-tracing adapter under `agentfootprint/observability-providers`. The strategically biggest unlock since OTel-compat backends include the entire industry: **Honeycomb**, **Grafana Cloud / Tempo / Mimir**, **AWS Distro for OTel** (alternative to `xrayObservability`), **Datadog APM** via OTLP, **Splunk Observability Cloud**, **New Relic**, **Lightstep / ServiceNow Cloud Observability**, and any custom OTel collector pipeline.

  ```ts
  import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
  import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
  import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
  import { otelObservability } from 'agentfootprint/observability-providers';
  import { microtaskBatchDriver } from 'footprintjs/detach';

  // Set up OTel ONCE at app startup (BYO SDK + exporter).
  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: 'https://api.honeycomb.io/v1/traces',
        headers: { 'x-honeycomb-team': process.env.HONEYCOMB_KEY },
      }),
    ),
  );
  provider.register();

  agent.enable.observability({
    strategy: otelObservability({ serviceName: 'my-agent' }),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });
  ```

  **BYO SDK contract** — this adapter only takes `@opentelemetry/api` (the small typed API surface) as an OPTIONAL peer dep. The consumer brings the OTel SDK + exporter package(s) for their backend. That's what makes the adapter portable across every OTel-compat destination — we never lock in a particular exporter.

  - **Hierarchical span mapping** — same shape as `xrayObservability`: `agent.turn_start` → root span; `iteration_start` → child; `llm_start` / `tool_start` → leaf children. OTel parent-context propagation via `trace.setSpan(context.active(), parent)`.
  - **OTel GenAI + Tool semantic conventions** — `gen_ai.request.model`, `tool.name`, `iteration.number`, `cost.cumulative_usd` attributes follow OTel semconv where applicable.
  - **Sampling** — `sampleRate` option for per-strategy span dropping (separate from OTel SDK Samplers).
  - **`tool_end` with error sets ERROR span status** (per OTel `SpanStatusCode.ERROR` convention).
  - **`stop()` is leak-safe** — defensively ends any in-flight spans on teardown.
  - **`flush()` is a no-op by design** — OTel SDKs handle their own flushing via `provider.forceFlush()`. Documented in JSDoc; consumer's responsibility on shutdown.

  15 7-pattern tests in `test/observability-providers/otel.test.ts` against a mock tracer. Total suite: 1743 / 1743 passing, 0 regressions.

### Changed

- **Datadog adapter deferred** — `datadogObservability` was on the v2.9 roadmap. Datadog APM accepts OTLP, so consumers can point their OTel SDK at Datadog's OTLP endpoint and `otelObservability` covers the Datadog use case end-to-end. We'll ship a dedicated `dd-trace`-based adapter only if real-world feedback demands the native Datadog APM client.

### Coming next

- **v2.10.0** — first `cost-providers` adapter (`stripeCost`).
- **v2.11.x** — Reliability subsystem (CircuitBreaker / 3-tier fallback / `resumeOnError`) — deferred since v2.5.
- **v2.12.x** — `lens-browser` / `lens-cli` (visual debugger backends).

## [2.8.3]

### Added

- **`xrayObservability(opts)`** — AWS X-Ray distributed-tracing observability adapter under `agentfootprint/observability-providers`. Maps agentfootprint's event taxonomy onto hierarchical X-Ray segment trees:

  ```
  agent.turn_start          ↦  root segment (one trace per turn)
  agent.iteration_start     ↦  push subsegment under root
  stream.llm_start          ↦  push leaf subsegment (model call)
  stream.tool_start         ↦  push leaf subsegment (tool call)
  ```

  Result in the X-Ray Trace Map: a hierarchical timeline of every agent run — turn → iteration → llm-call/tool-call — queryable in X-Ray Insights, joinable with the rest of your AWS distributed trace via `AWSTraceHeader` propagation.

  ```ts
  import { xrayObservability } from 'agentfootprint/observability-providers';
  import { microtaskBatchDriver } from 'footprintjs/detach';

  agent.enable.observability({
    strategy: xrayObservability({
      region: 'us-east-1',
      serviceName: 'my-agent-prod',
      sampleRate: 0.1, // 10% sampling — decisions made at turn_start
    }),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });
  ```

  - **Hierarchical segment management**: per-turn stack tracks active segments by `runId` (events for multiple in-flight turns interleave correctly). Defensive `popSegment` matches by name to survive out-of-order `_end` events (e.g., pause/resume mid-turn).
  - **Sampling**: decisions made at `turn_start` and persist for the whole turn — partial traces never reach X-Ray.
  - **Standard X-Ray segment shape**: `name`, `id` (16 hex), `trace_id` (`1-{8hex}-{24hex}` per spec), `parent_id`, `start_time` / `end_time` (unix seconds), `annotations` (queryable in X-Ray Insights), `metadata` (visible but not queryable).
  - **Annotations on segments**: `model` on llm segments, `toolName` on tool segments, `cumulativeCostUsd` from `cost.tick` events lands on the topmost active segment.
  - **Batching**: up to 25 segments per `PutTraceSegments` call (X-Ray hard caps at 50). Default 1s flush window for low-traffic agents.
  - **`flush()` is shutdown-safe**: force-closes any in-flight turn segments so partial traces ship on graceful shutdown.

  Peer dep `@aws-sdk/client-xray` declared as **optional** in `peerDependenciesMeta` — consumers who never call `xrayObservability(...)` don't need the AWS SDK in their lockfile. Lazy-required via `lib/lazyRequire.ts`.

  Unlike `cloudwatchObservability` and `agentcoreObservability` (both share the `_buildCloudWatchObservability` base), X-Ray is a fundamentally different shape (spans + parent/child + sampling) so it doesn't share that base.

  12 7-pattern tests in `test/observability-providers/xray.test.ts`. Total suite: 1728 / 1728 passing, 0 regressions.

### Coming next

- **v2.9.0** — `otelObservability` (industry-standard OpenTelemetry) + `datadogObservability` (most-requested commercial vendor).
- **v2.10.0** — first `cost-providers` adapter (`stripeCost`).

## [2.8.2]

### Added

- **`cloudwatchObservability(opts)`** — generic AWS CloudWatch Logs observability adapter under `agentfootprint/observability-providers`. Same SDK as `agentcoreObservability` but **without** AgentCore-specific defaults. Use when you're shipping agent telemetry to CloudWatch and not running inside Bedrock AgentCore (most common case).

  ```ts
  import { cloudwatchObservability } from 'agentfootprint/observability-providers';
  import { microtaskBatchDriver } from 'footprintjs/detach';

  agent.enable.observability({
    strategy: cloudwatchObservability({
      region: 'us-east-1',
      logGroupName: '/myapp/agent-prod',
      logStreamName: `${process.env.HOSTNAME}/${Date.now()}`,
    }),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });
  ```

  Same peer dep + lazy-require contract as `agentcoreObservability`: `@aws-sdk/client-cloudwatch-logs` is declared **optional** in `peerDependenciesMeta`. Consumers who never call this factory don't need the AWS SDK in their lockfile. Bundlers don't pull the SDK into builds that never use the adapter.

  9 7-pattern tests in `test/observability-providers/cloudwatch.test.ts`. Total suite: 1716 / 1716 passing, 0 regressions.

### Changed

- **`agentcoreObservability` refactored to thin-wrap `cloudwatchObservability`'s shared base.** Both adapters now share one CloudWatch Logs hot-path — improvements (retry, sequence-token handling, metric emission) flow to every CloudWatch-shaped adapter automatically. Behavior-preserving: all 11 existing `agentcoreObservability` tests pass unchanged. The only observable difference between the two adapters is `strategy.name` (`'agentcore'` vs `'cloudwatch'`) — used for registry-lookup and diagnostics.

  Public API for `agentcoreObservability` is unchanged. `AgentcoreObservabilityOptions` is now a type alias for `CloudwatchObservabilityOptions` — kept as a separate type so future AgentCore-specific options (e.g., `agentcoreSessionId` propagation) can be added without a breaking change.

### Coming next

- **v2.8.3** — `xrayObservability` (AWS distributed tracing). Different SDK (`@aws-sdk/client-xray`), different shape (spans not log events), so won't share the CloudWatch base.
- **v2.9.x** — `otelObservability` + `datadogObservability`.

## [2.8.1]

### Added

- **`agentfootprint/observability-providers` — new grouped subpath for vendor observability strategies.** Follows the parallel-providers pattern v2.5 established for `llm-providers` / `tool-providers` / `memory-providers`. Future vendor adapters add an export here, NOT a new subpath — keeps `package.json#exports` from sprawling.

  Ships with one adapter:

  - **`agentcoreObservability(opts)`** — AWS Bedrock AgentCore observability adapter. Ships every `AgentfootprintEvent` to **CloudWatch Logs** in a structured-JSON shape AgentCore's hosted-agent telemetry layer understands. Buffers in `exportEvent` (sync + non-throwing); drains in `flush()` (async batch). Default flush window: 1s OR 10 KB, whichever first.

  ```ts
  import { agentcoreObservability } from 'agentfootprint/observability-providers';
  import { microtaskBatchDriver } from 'footprintjs/detach';

  agent.enable.observability({
    strategy: agentcoreObservability({
      region: 'us-east-1',
      logGroupName: '/agentfootprint/my-agent',
      logStreamName: `${process.env.HOSTNAME}/${Date.now()}`,
    }),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });
  ```

  Peer dep: `@aws-sdk/client-cloudwatch-logs` (declared as **optional** via `peerDependenciesMeta.{name}.optional = true` — only consumers who actually call `agentcoreObservability(...)` need to install it). Lazy-required via `lib/lazyRequire.ts` so bundlers don't pull the AWS SDK into builds that never use the adapter.

  `_client` test injection escape hatch lets tests skip the SDK require entirely. 11 7-pattern tests in `test/observability-providers/agentcore.test.ts`.

### Fixed

- **Roadmap JSDoc in `src/strategies/index.ts` corrected.** v2.8.0 ship notes mistakenly listed the per-vendor subpath naming (`agentfootprint/observability-agentcore`, `observability-cloudwatch`, etc.) — same anti-pattern v2.5 fixed for memory adapters when collapsing 6+ per-vendor subpaths into `memory-providers`. Now lists the correct grouped subpaths: `observability-providers`, `cost-providers`, `lens-providers`. Pure docs change; no code surface affected.

### Coming next

- **v2.8.2** — `cloudwatchObservability` (the same SDK without AgentCore-specific log-group conventions).
- **v2.8.3** — `xrayObservability` (AWS distributed tracing).
- **v2.9.x** — `otelObservability` + `datadogObservability` (industry-standard backends).

All future vendor adapters land under the existing `agentfootprint/observability-providers` subpath — no new subpaths.

## [2.8.0]

### Added

- **Detached observability via `footprintjs/detach` — `enable.observability(...)` and `enable.cost(...)` now accept an opt-in `detach` option** that schedules the strategy's hot-path call (`exportEvent` / `recordCost`) onto a [footprintjs detach driver](https://footprintjs.github.io/footPrint/guides/patterns/detach/) instead of running it inline. The agent loop returns immediately; exports flush on the driver's schedule. Sync inline behavior is unchanged when the option is omitted — full back-compat for every existing consumer.

  Three semantics:

  - `detach: { driver, mode: 'forget' }` — discard the handle. Pure fire-and-forget telemetry. (Default when `mode` omitted.)
  - `detach: { driver, mode: 'join-later', onHandle: (h) => ... }` — driver returns a `DetachHandle`; we deliver it to your callback so you can `await` later (graceful shutdown, tests, backpressure).
  - omitted (default) — sync inline, same as v2.7.x and earlier.

  ```ts
  import { microtaskBatchDriver, flushAllDetached } from 'footprintjs/detach';

  agent.enable.observability({
    strategy: datadogExporter(...),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });

  // Graceful shutdown:
  process.on('SIGTERM', async () => {
    const stats = await flushAllDetached({ timeoutMs: 10_000 });
    process.exit(stats.pending === 0 ? 0 : 1);
  });
  ```

  Pick a driver by environment: `microtaskBatchDriver` (default cross-runtime), `setImmediateDriver` (Node), `setTimeoutDriver` (cross-runtime, configurable delay), `sendBeaconDriver` (browser, survives page-unload), `workerThreadDriver` (CPU-isolated). All from `footprintjs/detach`.

  `enable.thinking` and `enable.lens` deliberately **stay sync** — UI/debugger render must feel responsive and can't be deferred to next microtask.

  9 new 7-pattern tests in `test/strategies/detach-integration.test.ts` (Unit / Boundary / Scenario / Property / Security / ROI). Total suite now 1696 passing, 0 regressions. New runnable example: `examples/features/06-detached-observability.ts`.

### Changed

- **footprintjs peer-dep bumped to `>=4.17.1`** (was `>=4.14.0`). The `detach` option requires the `footprintjs/detach` subpath shipped in 4.17.0 and the publish-pipeline fix shipped in 4.17.1.

## [2.7.3]

**Design memo: `strategy-everywhere.md` — AWS-first vendor adapter
roadmap for v2.8+.**

The v2.6 cache layer proved out a pattern: one DSL, N vendor
strategies, side-effect-import auto-registration, wildcard fallback.
Sonnet Dynamic ReAct dropped 36,322 → 6,535 input tokens (−82%) end
to end. v2.8+ generalizes this as the universal architectural pattern.

This release adds the design memo only — no code changes, no API
surface changes. Implementation lands in v2.8.0+ across separate
minors per vendor adapter.

### What the memo covers

- **Pattern lineage**: Strategy Pattern (GoF) + Bridge + Hexagonal +
  Provider model (.NET) + Algebraic effects (Plotkin/Pretnar). Same
  architectural shape, 5 names.
- **4 groups in scope for v2.8**: `enable.observability`, `enable.cost`,
  `enable.liveStatus`, `enable.lens` — each gets a strategy slot.
- **AWS-first adapter priority**: builds on the existing
  `memory-agentcore` peer-dep precedent. v2.8.1 ships
  `observability-agentcore` (AWS Bedrock AgentCore Observability —
  same SDK consumers already imported for memory). v2.8.2 ships
  `observability-cloudwatch`. v2.8.3 ships `observability-xray`.
  Non-AWS adapters (OTel, Datadog, Pino) follow in v2.9.x.
- **Locked-in design decisions** from a 7-expert panel review (AWS
  IAM, Datadog, OTel, Stripe, Vercel, React, Anthropic): discriminated
  union options, idempotent stop, tier knob with cost-of-on docs,
  sample-rate, dry-run mode for audit, zero-arg defaults, dev/prod
  auto-detect, `compose([...])` combinator.
- **Migration plan**: v2.8.0 additive; v3.0 removes deprecated flat
  `enable.thinking` / `enable.logging` / `enable.flowchart`.
- **Approval gates** before v2.8.0 implementation: strategy interface
  signatures locked, 1 vendor adapter prototyped end-to-end (suggest
  AgentCore as the first), mock-strategy contract test,
  performance baseline (`compose([...])` of 5 children must add ≤ 5%
  overhead).

### Files

- `docs/inspiration/strategy-everywhere.md` (canonical)
- `docs-site/src/content/docs/inspiration/strategy-everywhere.mdx` (mirrored)
- `docs-site/astro.config.mjs` (sidebar entry)
- `docs/inspiration/README.md` (index updated — third pillar after
  Palantir/Liskov: "the scaling spine")

No code change. 1630/1630 tests pass.

## [2.7.2]

**Docs + example for the `agentfootprint/status` subpath.**

The v2.7.0 subpath shipped without a runnable example. v2.7.2 adds:

- **`examples/features/06-status-subpath.ts`** — runnable end-to-end
  example. Subscribes to `'*'` (the global wildcard), feeds events to
  `selectThinkingState`, renders via `renderThinkingLine` with
  per-tool template overrides. Same path Neo's chat-bubble feed uses.
  Now part of the CI sweep — future regressions in the subpath get
  caught before release.
- **`examples/features/06-status-subpath.md`** — companion guide.
  Explains the state machine, the renderer, built-in template vars
  (`{{appName}}` / `{{toolName}}` / `{{toolCallId}}` / `{{partial}}` /
  `{{question}}`), and where consumers need to walk events directly
  for arg-aware templates.
- **README — "Chat-bubble status surface" bullet** in "What ships
  today", linking the high-level `enable.thinking` and low-level
  `agentfootprint/status` paths so consumers see both.

No code change. Tests still 1630/1630.

## [2.7.1]

**Docs fix: `'agentfootprint.*'` is NOT a valid wildcard pattern.**

Four docs incorrectly told consumers to subscribe via
`agent.on('agentfootprint.*', listener)`:

- `CLAUDE.md` line 429
- `AGENTS.md` line 429
- `docs-site/.../debug.mdx` line 12
- `ai-instructions/claude-code/SKILL.md` line 371

The `EventDispatcher` only accepts:

| Pattern                       | Match                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `'*'`                         | every event                                                                                                                       |
| `'agentfootprint.<domain>.*'` | every event in one domain (15 domains: `agent`, `stream`, `context`, `tools`, `memory`, `cost`, `error`, `pause`, `embedding`, …) |
| Specific type                 | one event                                                                                                                         |

`'agentfootprint.*'` (just the namespace, no domain) silently matches
nothing — the dispatcher's wildcard table doesn't include it. TypeScript
catches it via `WildcardSubscription`, but consumers using `as never`
casts (or following these docs verbatim) hit silent zero-match: agent
runs, no events fire on the listener, chat UIs stay frozen on initial
state.

This bit a real consumer (Neo's chat-feed status bubble) — the
listener subscribed via the broken pattern, no events arrived, the
bubble stayed stuck on "Getting started…" through the entire run even
though the agent completed successfully and Lens received its events
through a different (correct) path.

### Fix

All 4 docs updated to:

- Recommend `'*'` for global subscription
- Document `'agentfootprint.<domain>.*'` for per-domain
- Explicitly call out that `'agentfootprint.*'` is invalid

No code change. No behavior change. Tests still 1630/1630.

## [2.7.0]

**New `agentfootprint/status` subpath** — chat-bubble status surface.

Tiny addition (one re-export file + one `package.json` exports entry)
that brings the thinking-state primitives in line with the rest of the
library's subpath organization:

| Subpath                           | What's in it                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `agentfootprint/observe`          | BoundaryRecorder, StepGraph, FlowchartRecorder                           |
| `agentfootprint/locales`          | composeMessages, validateMessages, defaultThinkingMessages               |
| `agentfootprint/status` ← **new** | selectThinkingState, renderThinkingLine, defaultThinkingTemplates, types |
| `agentfootprint/tool-providers`   | staticTools, gatedTools, …                                               |

### Why

Consumers building chat UIs / status indicators / Lens-style live
panels can now opt-in explicitly:

```typescript
// Before (still works — back-compat preserved)
import { selectThinkingState, renderThinkingLine } from 'agentfootprint';

// After (preferred for new code)
import { selectThinkingState, renderThinkingLine } from 'agentfootprint/status';
```

The import line is self-documenting (matches `agentfootprint/observe`
and `agentfootprint/locales` naming). Bundler tree-shaking is more
explicit. Future extended-thinking primitives (Anthropic
`thinking_delta` / `redacted_thinking`) will land here too without
inflating the main entry.

### What's exported

- `selectThinkingState(events)` — derive current state (idle / tool /
  streaming / paused / null) from the typed event log
- `renderThinkingLine(state, templates, ctx)` — resolve template +
  substitute vars to a final string
- `defaultThinkingTemplates` — bundled English defaults
- `type ThinkingTemplates` / `ThinkingState` / `ThinkingStateKind` /
  `ThinkingContext`

### Migration

Zero breaking changes. Main `agentfootprint` exports unchanged. New
code uses the subpath; old code keeps working indefinitely.

## [2.6.4]

**Fix: v2.6 cache-layer subflows leaked as fake user-visible steps in
the StepGraph.** When v2.6 introduced `CacheDecisionSubflow` (with
local id `sf-cache-decision`) and the `CacheGate` decider (stage id
`cache-gate`), neither was registered in `BoundaryRecorder`'s
`AGENT_INTERNAL_LOCAL_IDS` set. Result: every iteration of an agent
emitted `subflow.entry` / `subflow.exit` / `decision.branch` events
that weren't tagged `isAgentInternal: true`, so `FlowchartRecorder`
projected them as user-facing `StepNode`s. A 5-iteration run showed
~30 nodes instead of ~14 — every iter contributed 3 fake steps the
user had to scrub past. Same issue (pre-existing) for
`SUBFLOW_IDS.INJECTION_ENGINE`.

### Fix

Three ids added to `AGENT_INTERNAL_LOCAL_IDS` in
`src/recorders/observability/BoundaryRecorder.ts`:

```ts
SUBFLOW_IDS.INJECTION_ENGINE,   // pre-existing oversight
SUBFLOW_IDS.CACHE_DECISION,     // v2.6
STAGE_IDS.CACHE_GATE,           // v2.6 (decider stage id)
```

Plus a comment block warning future contributors: when adding a new
subflow to the Agent's internal flowchart, decide whether it's a
context-engineering moment (leave OUT — it should be a user-visible
step) or pure plumbing (add HERE — it's wiring, not a step).

### Regression guard

New test `test/recorders/observability/internal-ids-coverage.test.ts`
enumerates `SUBFLOW_IDS` and asserts every entry is categorized as
either a slot subflow OR an agent-internal id. The next time someone
adds a new entry to `SUBFLOW_IDS` without categorizing it, the test
fails by NAME so the bug is caught before it leaks into Lens.

### Verified

In the Neo MDS triage browser app (1630/1630 tests passing, lens dist
unchanged):

- 5-iteration run, before fix: 30+ visible step-graph nodes
- 5-iteration run, after fix: 14 nodes (1 Run + per-iter LLM/tool steps + final llm→user)

## [2.6.3]

**README rewrite + new `Inspiration` section in docs/site.** Three docs
moves bundled together:

1. **README rewrite** — leads with the abstraction-lineage framing
   (PyTorch autograd / Express / Prisma / Kubernetes / React → agentfootprint
   for context engineering). Same kind-of-move applied to a new domain.
   The hand-rolled vs declarative code comparison is now the visual hook;
   the differentiator section ("the trace is a cache of the agent's
   thinking") names the unique IP claim.

2. **New "Why it's shaped this way — two pillars" section** in the README.

   - **THE WHY (user-visible win):** Palantir's 2003 thesis applied to
     agent runtime — connect the four classes of agent data (state,
     decisions, execution, memory) so the next token compounds the
     connection instead of paying for it again.
   - **THE HOW (engineering discipline):** Liskov's ADT + LSP work, applied
     to flowcharts. Every framework boundary is LSP-substitutable.
     Subflows are CLU clusters. Locality of reasoning enforced as a
     runtime invariant.

3. **New `docs/inspiration/` section + matching `docs-site/inspiration/`**:
   - `README.md` (index) explaining the two-pillar structure
   - `connected-data-palantir.md` — full Palantir thesis → agentfootprint
     mapping; the four classes of agent data; where we go beyond Palantir
     (emergent vs pre-built ontology)
   - `modularity-liskov.md` — CLU clusters → subflows; LSP examples
     (CacheStrategy / LLMProvider / ToolProvider); locality of reasoning
     → operationalized; where we extend beyond classical Liskov
   - New "💡 Inspiration" sidebar section in the docs site between
     Architecture and Reference

Plus accuracy fixes uncovered during README verification:

- Provider count: 6 → **7** (Anthropic, OpenAI, Bedrock, Ollama,
  Browser-Anthropic, Browser-OpenAI, Mock)
- "47 typed events" → **48+ typed events** (recounted via grep)
- Strengthened the "frameworks that compose state per-node can't recompute
  cache markers in lockstep" claim about other frameworks (less
  combative phrasing, same defensible point)

No code change. 1627/1627 tests pass.

## [2.6.2]

**Docs: tool-dependency framing for Dynamic ReAct + remove application-specific
references.** Two unrelated docs cleanups bundled together:

1. **README — sharper rule for when to use Dynamic ReAct.** The previous
   benchmark-heavy section (4 sub-sections, multi-model token tables,
   parallelization caveats) led with the wrong heuristic ("30+ tools across
   8+ skills"). Replaced with the clearer rule: **use Dynamic ReAct when
   your tools have dependencies — when one tool's output implies which tool
   to call next.** Skills encode that workflow. If tools are independent
   and order doesn't matter, Classic is fine. The side-by-side example +
   "what Dynamic gives you that Classic doesn't" list is preserved; the
   noisy benchmark tables are gone.

2. **Removed all application-specific references.** Earlier docs referred
   to "Neo" (a Cisco MDS Fibre Channel triage agent used internally for
   benchmarking) by name. Generic phrasing now: "production-shaped Skills
   agent (10 skills, 18 tools after dedup)." Affected: README.md,
   CHANGELOG.md (2.6.0 + 2.5.0 entries), docs/guides/caching.md,
   examples/dynamic-react/README.md.

No code change. 1627/1627 tests still pass.

## [2.6.1]

**Lint cleanup + release-pipeline hardening.** v2.6.0 shipped with three
trivial eslint errors (`prefer-const`, `no-inferrable-types`) in cache
files and pre-existing test files. The release script's 8 gates didn't
include lint — only docs / format / build / tests / examples — so the
errors slipped through. Two-part fix:

1. **Source fix** — auto-applied via `eslint --fix`. Three lines changed
   across `src/core/Agent.ts`, `test/core/agent-toolprovider.test.ts`,
   and `test/recorders/contextEngineering.test.ts`. No behavior change.
2. **Process fix** — added Gate 2.85 to `scripts/release.sh`:
   `npm run lint --max-warnings=99999`. Errors fail the gate; warnings
   tolerated for now (334 pre-existing non-null-assertion warnings need
   a separate cleanup pass).

Net: all 1627 tests still pass; CI is green; future releases can't
ship with eslint errors.

## [2.6.0]

**Provider-agnostic prompt caching.** Dynamic ReAct repeats the same
stable prefix (system prompt + tool schemas + active skill body) on
every iteration. Without caching, every iter pays full price for that
duplicated context. v2.6 introduces a unified DSL — `cache:` policy on
each injection flavor — over per-provider strategies, so the right
cache hints land on the wire automatically.

### What's new

- **CacheDecision subflow** walks `activeInjections` each iteration,
  evaluates each injection's `cache:` directive, and emits a
  provider-agnostic `CacheMarker[]`.
- **CacheGate decider** uses footprintjs `decide()` with three rules —
  kill switch (`cachingDisabled`), hit-rate floor (skip when recent
  hit-rate < 0.3), and skill-churn (skip when ≥3 unique skills in the
  last 5 iters). Decision evidence captured for free.
- **5 cache strategies** (auto-registered via side-effect imports):
  - `AnthropicCacheStrategy` — manual `cache_control` on system blocks
    (4-marker clamp; surfaces `cache_creation_input_tokens` +
    `cache_read_input_tokens`)
  - `OpenAICacheStrategy` — pass-through (auto-cache); extracts
    `prompt_tokens_details.cached_tokens` for metrics
  - `BedrockCacheStrategy` — model-aware: Anthropic-style hints when
    modelId matches `^anthropic\.claude`, pass-through otherwise
  - `NoOpCacheStrategy` — wildcard fallback for unknown providers
  - Future: `GeminiCacheStrategy`
- **Per-flavor defaults** (overridable on each `defineX(...)`):
  - `defineSteering` → `'always'`
  - `defineFact` → `'always'`
  - `defineSkill` → `'while-active'`
  - `defineInstruction` → `'never'`
  - `defineMemory` → `'while-active'`
- **`cacheRecorder()`** — high-level observability; dump after a run
  for gate decisions + total markers emitted.
- **`Agent.create({ caching: 'on' | 'off' })`** — top-level kill switch
  (defaults to `'on'`).

### Validated on a production-shaped Skills agent

Same task, same scenario, against the live Anthropic API on a
10-skill / 18-tool agent:

| Mode (Sonnet 4.5)                    | cache=off  | cache=on   | Δ        |
| ------------------------------------ | ---------- | ---------- | -------- |
| Classic (no skill markdown)          | 40,563     | (untested) | —        |
| Static (all skill markdowns stuffed) | ~140,000   | 7,640      | **−95%** |
| **Dynamic (smart gating)**           | **28,404** | **6,535**  | **−77%** |

Cross-model Dynamic cache=on results:

| Model      | cache=off | cache=on   | Δ    |
| ---------- | --------- | ---------- | ---- |
| Sonnet 4.5 | 36,322    | **6,535**  | −82% |
| Haiku 4.5  | 36,309    | **13,637** | −62% |
| Opus 4.5   | 28,477    | **10,745** | −62% |

### Strategic implication

Pre-v2.6 the only economically sane Dynamic ReAct shape was smart
gating — bind tools and skill markdowns conditionally per iter.
Post-v2.6 you have a real second option: **stuff-and-cache** (put every
skill markdown into the system prompt always, let the cache layer carry
the cost). Both patterns are now first-class. Pick based on your team's
preferences, not on token cost alone.

### Migration

Zero breaking changes. Existing agents get caching for free if they use
Anthropic, Bedrock-Claude, or OpenAI providers. Disable explicitly with
`Agent.create({ caching: 'off' })`.

### Tests / Docs

- +66 tests in `test/cache/` (1627/1627 pass)
- New guide: [docs/guides/caching.md](docs/guides/caching.md) — Caching
  in 60 seconds + per-strategy reference + custom-strategy authoring
  template

## [2.5.1]

**Bug fix release.** v2.5.0 shipped with a single-line bug in the
`Agent.buildChart` InjectionEngine subflow mount: the `outputMapper`
was missing `arrayMerge: ArrayMergeMode.Replace`. Default footprintjs
behavior CONCATENATES arrays from child to parent, so each iteration's
`activeInjections` accumulated instead of replacing. Effect:
8 → 16 → 24 → 32 → 40 → 48 cumulative injections per turn instead
of the intended ~8-per-iter. The 8 always-on injection bodies were
duplicated 5× into the system prompt at iter 5, ballooning Dynamic
ReAct's input-token cost.

### The fix

One line added to the InjectionEngine subflow mount in `Agent.ts`:

```ts
arrayMerge: ArrayMergeMode.Replace,
```

Same fix that was already present on the SystemPrompt / Messages /
Tools subflow mounts. The InjectionEngine mount was missed in v2.5.0.

### Empirical impact (real Anthropic benchmark, 3 models × 2 modes)

| Model      | Dynamic in (v2.5.0) | Dynamic in (v2.5.1) |        Δ |
| ---------- | ------------------: | ------------------: | -------: |
| Haiku 4.5  |              62,571 |              36,341 | **−42%** |
| Sonnet 4.5 |              44,621 |              28,486 | **−36%** |
| Opus 4.5   |              44,590 |              28,401 | **−36%** |

Same scenario, same scripted answers, same iteration count. The
~36–42% drop is purely the system prompt no longer being duplicated.

### Regression tests

Three new tests in `test/core/dynamic-react-loop.test.ts` assert
bounded per-iteration injection counts:

- `activeInjections` ≤ 4 across 5 iterations
- `systemPromptInjections` ≤ 5 across 5 iterations
- `messagesInjections` ≤ 1.5× history length

These would have caught the v2.5.0 bug. Suite: 1490 → 1493.

### v1 marketing claim correction

v2.5.0's README claimed "Dynamic ReAct cuts input tokens 30–70%."
The real-world benchmark above shows this is **not universal** at sub-30-tool
scale. The corrected README now shows the real 3-model comparison
and explains:

- Dynamic provides **predictable cost** (varies <5% across models)
- Classic provides **lowest absolute cost** when the model parallelizes
- Dynamic wins clearly above ~30 tools across 8+ skills
- Dynamic ALWAYS wins on per-call payload size + deterministic routing

### Suite

1490 → 1493 (+3 regression tests).

## [2.5.0]

**Dynamic ReAct primacy + skill-driven tool gating.** This release
makes the Dynamic ReAct loop the load-bearing story: tools and
system-prompt content recompose every iteration, so an agent with
N skills × M tools no longer pays the full tool-list token cost on
every LLM call. Plus eight new builder/runtime features for
production agent surfaces.

### Block A — eight runtime + builder additions

- **A1 `.toolProvider()`** — first-class builder method for dynamic
  tool sources (registry-backed, MCP-mediated, runtime-decided).
- **A2 `PermissionPolicy`** — declarative role/capability allowlists
  on `agent.run({ identity })`. Tool-call recorder consults the
  policy; deny → tool throws `PermissionDeniedError`.
- **A3 `SkillRegistry.toTools()`** — explicit conversion API so
  consumers can opt skill-supplied tools into the static registry
  (gated by autoActivate mode).
- **A4 Builder ergonomics** — `.maxIterations()`, `.recorder()`,
  `.instructions()` on AgentBuilder.
- **A5 `autoActivate: 'currentSkill'`** — runtime tool gating: a
  skill's tools become visible to the LLM only when that skill is
  the most-recently-activated one. Cuts tool-list bloat for agents
  with N skills × M tools.
- **A6 `outputSchema(parser)`** — terminal-contract validation via
  `agent.runTyped()`. Uses footprintjs's schema abstraction
  (Zod-optional, duck-typed). On parse/validation failure throws
  `OutputSchemaError` with `.rawOutput` preserved.
- **A7 `flowchartAsTool(chart)`** — wraps a footprintjs FlowChart
  as an LLM-callable Tool. Inner pause throws with
  `error.checkpoint` attached (full nested-pause integration is on
  the v2.6 backlog).
- **A8 Richer `Skill`** — first-class `metadata`, `inject` shape,
  per-skill activation hooks. Subsumes v2.4 ad-hoc skill factories.

### Block B — `agentfootprint/{llm,tool,memory}-providers` + `/security`

Subpath restructure so consumers don't pay tree-shake costs for
adapters they don't use. v2.4's main barrel pulled every provider;
v2.5 splits them. The genuinely-clean per-adapter subpath
(Drizzle/Lucia pattern) is on the v2.6 backlog.

### Block C — Skills runtime per-mode routing

Closes the v2.4 Phase 4 commitment: `autoActivate` now actually
narrows the tool slot at runtime (was previously a static-only
hint). The Tools slot subflow consults `activatedInjectionIds`
each iteration.

### Block D — Message Catalog Pattern (`agentfootprint/locales`)

i18n-ready prose templates for Lens commentary and chat-bubble
thinking messages. `defaultThinkingMessages`, `composeMessages`,
`validateMessages` exports.

### Block E — examples README auto-generator

`scripts/generate-examples-readme.mjs` walks `examples/`, extracts
title + summary from each file's leading JSDoc, emits a
table-of-contents README. Runs as a release gate.

### Post-run trace accessors

`agent.getLastSnapshot()`, `agent.getLastNarrativeEntries()`,
`agent.getSpec()` — three accessors for post-run UIs (Lens Trace
tab, ExplainableShell, custom dashboards) to pull execution state
without intercepting the run() call site. `enableNarrative()` is
called inside `createExecutor()` so the entries array is populated
for any consumer that asks.

### BrowserAnthropicProvider — streaming-spec fixes

The v1→v2 rewrite regressed the SSE parser. v2.5 restores both:
**tool args via `input_json_delta`** (per-block accumulation, parsed
on `content_block_stop` — was always landing as `{}`) and
**cumulative usage tracking** from `message_start.usage` +
`message_delta.usage` (was always 0).

### Tool dedupe in Tools slot

Three sources can register the same tool name (static registry +
toolProvider + skill injection); LLMs reject duplicates. Tools
slot now dedupes by name + uses `ArrayMergeMode.Replace` on the
subflow output mapping (the documented fix to the documented
anti-pattern).

### Suite

1408 → 1490 (+82).

## [2.4.0]

**We made it impossible for our docs to lie.**

The headline of this release is structural: every code block on the
docs site is now imported from a real, runnable file in `examples/`.
A docs build fails if a referenced example doesn't exist or if a
named region marker is missing. Drift between docs and code becomes
impossible by construction — you can't ship a docs page that
documents an API that isn't there.

Suite: 1229 → 1253 (+24 from new Skills features). Pages: 67% drift
→ ~0%.

### The structural drift fix

- New `<CodeFile path="..." region="..." />` Astro component imports
  code from any file in the repo at docs-build time. Region markers
  in source files (`// #region NAME` / `// #endregion NAME`) let you
  show only the relevant slice.
- New CI job `docs` (`.github/workflows/ci.yml`) runs the docs-site
  build. A missing file → ENOENT. A missing region →
  `RegionNotFoundError`. Either kills CI.
- 35 of 42 docs pages converted to `<CodeFile>` imports. ~25 region
  markers added across `examples/`. Inline code blocks in the docs
  surface now exist only for illustrative anti-examples (the
  "without agentfootprint" 80-line block in the README).

### Skills features — the essay becomes truth

The `skills-explained.mdx` essay was the strongest piece of writing
in the docs and the most aspirational. Three features it described
now ship:

- `defineSkill({ surfaceMode })` — typed `'auto' | 'system-prompt' |
'tool-only' | 'both'`. Default `'auto'` resolves per provider via
  `resolveSurfaceMode`.
- `defineSkill({ refreshPolicy })` — typed
  `{ afterTokens, via: 'tool-result' }` for re-injecting skill bodies
  past a token threshold. API surface ships today; runtime hook lands
  in v2.5 (long-context attention work) — non-breaking.
- `resolveSurfaceMode(provider, model)` — pure function, exported.
  Per-provider attention-profile defaults match the essay:
  Claude ≥ 3.5 → `'both'`; everywhere else → `'tool-only'`.
- `SkillRegistry` class — centralized governance for shared skill
  catalogs across multiple agents. Methods: `register / replace /
unregister / get / has / list / size / clear`. Throws on duplicate
  register. Throws on non-Skill flavor inputs.
- `agent.skills(registry)` builder method — bulk-register every skill
  in a registry on an agent. Companion to existing `.skill(t)`.

Today's runtime treats every `surfaceMode` the same (the cross-
provider-correct activation + next-iteration injection pattern the
essay calls right). Full per-mode runtime routing diversity lands in
v2.5 — non-breaking; consumer code written today continues to work.

24 new tests cover the new API surface end-to-end.

### New navigation + 4 new pages

The docs site sidebar restructured around how readers actually
navigate (persona-aware grouping, max 7 items per group):

Get Started → Mental model → Primitives & compositions →
Context engineering → Memory → Observability → Production →
Providers → Memory stores → Architecture → Reference → Resources

Four new pages address the gaps the multi-persona review surfaced:

- `manifesto.mdx` — "How agentfootprint thinks". First-person
  opinionated essay naming what we are, what we're not, what we
  believe, what we ask of you. The framework's perspective made
  tangible. Storyteller's voice.
- `causal-deep-dive.mdx` — researcher-grade snapshot deep-dive.
  Annotated JSON shape of a `RunSnapshot` byte-for-byte. Four
  projection modes documented. Worked Monday→Friday replay with
  cheap-model triage economic argument (Sonnet→Haiku follow-up
  at ~10× lower cost).
- `research/citations.mdx` — bibliography for every shipped pattern
  (ReAct, Reflexion, ToT, Self-Consistency, Debate, Map-Reduce,
  Swarm, Skills) with proper paper references + how the recipe in
  `examples/patterns/` relates to + deviates from each paper. Plus
  the augmented-LM survey as the conceptual root of our Injection
  primitive. Plus a BibTeX entry for citing agentfootprint.
- `architecture/dependency-graph.mdx` — 8-layer DAG diagram for
  senior engineers. Substrate (footprintjs) → events → adapters →
  memory → context engineering → primitives → compositions → public
  barrel. Documents the Hexagonal isolation property + per-layer
  subpath exports + anti-cycle CI enforcement.

### API reference — auto-generated via TypeDoc

- New devDeps: `typedoc` + `typedoc-plugin-markdown`.
- New script: `npm run docs:api`. Reads `src/index.ts`, follows the
  public exports, emits markdown to `docs/api-reference/`.
- Generated tree committed so consumers browsing GitHub can follow
  links to it directly. Five sections: classes/ + functions/ +
  interfaces/ + type-aliases/ + variables/.
- The 7 hand-written API ref pages (which were drifted) consolidated
  to a single `api/agent.mdx` placeholder that points at the
  generated tree.

### Coverage badge

- New devDep: `@vitest/coverage-v8`.
- New script: `npm run test:coverage`.
- New CI job `coverage` (`.github/workflows/ci.yml`) uploads
  `coverage/lcov.info` to Codecov via `codecov-action@v5`. No
  threshold enforcement — badge surfaces the number; consumers
  ratchet up over time.
- README badge added. Initial baseline: 85.75% lines, 83.77%
  statements, 90.30% functions, 73.20% branches across 3962
  statements.

### README rewrite

- Tagline changed: "Context engineering, abstracted."
- New autograd / Express / Prisma / Kubernetes / React framing places
  agentfootprint in the category of credible abstractions — not
  "another agent framework."
- Side-by-side "without (~80 LOC, drifts) vs with agentfootprint
  (~8 LOC, stable)" code blocks.
- "The trace is a cache of the agent's thinking" reframing of
  causal memory with three downstream consumers: audit, cheap-
  model triage, training data.
- "Why exactly four triggers? Because _who decides activation_ is
  a closed axis: nobody / dev / system / LLM" — defensibly stable
  surface argument.
- Evergreen sections — no version-specific facts in the README. The
  npm version badge auto-updates from the registry; CHANGELOG carries
  per-release truth. **From now on the README never needs touching
  for a release.**

### Process

- Six 6-persona reviews (one per phase: 1, 2, 3, 4, 6 + Phase 7 final).
  Every review's adjustments folded into the next phase.
- Design memo signed off BEFORE code, per the v2.3 process change.
  No internal panel verdicts in JSDoc — design lives in
  `memory/agentfootprint_v24_design.md`.

### What's next (v2.5)

- Reliability subsystem — `CircuitBreaker`, 3-tier output fallback,
  `agent.resumeOnError(checkpoint, input)`. Deferred from v2.4.
- Skills runtime per-mode routing diversity — suppressing system-
  prompt slot for `'tool-only'`, synthesizing fresh tool-result for
  `refreshPolicy`. The API surface is shipped today; the runtime
  tightening lands in v2.5 non-breaking.

## [2.3.0]

Mock-first development is now a first-class workflow with two new
public surfaces, the first two production memory-store adapters
arrive as peer-deps via subpath imports, and `package.json` declares
every optional SDK in `peerDependenciesMeta`. Suite: 1229 / 1229.

### Added — `mock({ replies })` for scripted multi-turn agents

```typescript
import { Agent, mock, defineTool } from 'agentfootprint';

const provider = mock({
  replies: [
    // Iteration 1: LLM decides to call a tool
    { toolCalls: [{ id: '1', name: 'lookup', args: { topic: 'refunds' } }] },
    // Iteration 2: LLM produces final answer
    { content: 'Refunds take 3 business days.' },
  ],
});
```

Each `complete()` / `stream()` consumes one reply in order. Exhaustion
throws a clear error so a misnumbered script fails the test instead
of silently looping. `provider.resetReplies()` rewinds the cursor for
cross-scenario reuse.

### Added — `mockMcpClient({ tools })` (in-memory MCP server)

Drop-in replacement for `mcpClient(opts)` — same `McpClient` shape,
zero subprocess / network / SDK install. Build the entire MCP
integration offline, swap to real `mcpClient` when ready.

```typescript
import { Agent, mock, mockMcpClient } from 'agentfootprint';

const slack = mockMcpClient({
  name: 'slack',
  tools: [
    {
      name: 'send_message',
      description: 'Post a message to a channel',
      inputSchema: { type: 'object' },
      handler: async ({ text }) => `Posted: ${text}`,
    },
  ],
});

const agent = Agent.create({ provider: mock({ reply: 'ok' }) })
  .tools(await slack.tools())
  .build();
```

The `_client` injection on `mcpClient` is `@internal` because the SDK
shape isn't a stable public surface. `mockMcpClient` is the public,
documented mock entry point.

### Added — `RedisStore` (subpath: `agentfootprint/memory-redis`)

Persistent `MemoryStore` implementation backed by Redis. Lazy-requires
`ioredis`; no runtime cost when another adapter is in use.

```typescript
import { RedisStore } from 'agentfootprint/memory-redis';

const store = new RedisStore({ url: 'redis://localhost:6379' });
const memory = defineMemory({
  id: 'redis-window',
  type: MEMORY_TYPES.EPISODIC,
  strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
  store,
});
```

Implements every `MemoryStore` method except `search()`. `putIfVersion`
is atomic via a small Lua script (real CAS, not emulated). RedisSearch
(vector retrieval) lands as a separate adapter in a future release.

### Added — `AgentCoreStore` (subpath: `agentfootprint/memory-agentcore`)

AWS Bedrock AgentCore Memory adapter. Lazy-requires
`@aws-sdk/client-bedrock-agent-runtime`.

```typescript
import { AgentCoreStore } from 'agentfootprint/memory-agentcore';

const store = new AgentCoreStore({
  memoryId: 'arn:aws:bedrock:us-east-1:...:memory/my-mem',
  region: 'us-east-1',
});
```

Maps the `MemoryStore` interface onto AgentCore's session/event model.
Caveats called out in the JSDoc:

- `putIfVersion` is emulated client-side (read+write) — fine for
  single-writer-per-session deployments.
- `seen` / `feedback` use in-process shadow state (don't survive
  process restart). Use `RedisStore` for durable recognition.
- `search()` is NOT exposed in v2.3 — AgentCore's native retrieve API
  will land as a separate `agentcoreRetrieve()` helper in a future release.

### Changed — `package.json` peer-dep declarations

Every lazy-required SDK is now declared in `peerDependenciesMeta` with
`optional: true` so npm advertises the relationship without auto-installing
or warning:

- `@anthropic-ai/sdk` (was undeclared — silent peer-dep)
- `openai` (was undeclared)
- `@aws-sdk/client-bedrock-runtime` (was undeclared)
- `@aws-sdk/client-bedrock-agent-runtime` (new — AgentCore)
- `@modelcontextprotocol/sdk` (was undeclared)
- `ioredis` (new — Redis)
- `zod` (already declared)

Friendly install hints fire at first call when an SDK is missing — same
pattern as `AnthropicProvider` since v1.

### Examples

- `examples/features/07-mock-multi-turn-replies.ts` — scripted ReAct loop
- `examples/memory/08-redis-store.ts` — RedisStore with mock-injected client
- `examples/memory/09-agentcore-store.ts` — AgentCoreStore with mock-injected client

All run end-to-end via `npm run example <path>`.

### Tests

+66 new tests (1163 → 1229):

- +6 MockProvider replies (consumption order, toolCalls partial, exhaustion, reset, precedence, stream)
- +15 mockMcpClient (lifecycle, handler dispatch, arg coercion, error context, Agent integration, schema fidelity)
- +23 RedisStore (CAS Lua, TTL, multi-tenant isolation, GDPR forget, signatures, feedback)
- +22 AgentCoreStore (emulated CAS, session-keyed isolation, shadow state, GDPR forget)

### Process change — design memo BEFORE release

v2.3 ships with a 9-panel design memo signed off ahead of code, per the
process-change committed in v2.2.x: panel verdicts live in
`memory/agentfootprint_v23_design.md`, not in JSDoc.

## [2.2.0]

Adds MCP (Model Context Protocol) client integration. Connect to any
MCP server, pull its tools as agentfootprint `Tool[]`, register them
on your agent in one builder call. Validates the v2.0 thesis again:
new tool sources slot in via the existing `Tool` interface — no
engine code, no new event types.

### Added — `mcpClient` (Model Context Protocol client)

```typescript
import { Agent, mcpClient } from 'agentfootprint';

const slack = await mcpClient({
  name: 'slack',
  transport: { transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'] },
});

const agent = Agent.create({ provider })
  .tools(await slack.tools()) // bulk-register every tool the server exposes
  .build();

await agent.run({ message: 'Send "deploy succeeded" to #alerts' });
await slack.close();
```

- Transports: `stdio` (local subprocess) and `http` (Streamable HTTP)
- Lazy-required `@modelcontextprotocol/sdk` peer-dep — zero runtime
  cost when MCP isn't used; friendly install hint if missing
- `_client` injection point for testing without the SDK
- Each MCP tool wraps as one agentfootprint `Tool` — `inputSchema`
  preserved verbatim; `callTool()` becomes the wrapped `execute()`
- MCP error responses (`isError: true`) throw with the server's
  message; non-text content blocks (image / resource) summarized as
  `[type]` placeholders (full multi-modal mapping is a future release)

### Added — `Agent.tools(toolArray)` builder method

Bulk-register companion to `.tool(t)`. Pair with
`await mcpClient(...).tools()` for the canonical MCP flow:

```typescript
agent
  .tools(await slack.tools())
  .tools(await github.tools())
  .tools(await db.tools())
  .build();
```

Tool-name uniqueness still validated per-entry across all sources
(MCP servers + manual `.tool()` calls). Duplicates throw at build
time.

### Added — `examples/context-engineering/08-mcp.ts` + `.md`

End-to-end runnable example using an injected mock MCP client. Same
code path as production; only the SDK construction is mocked. Pairs
with the existing 7 context-engineering examples.

### Internal

- 1157 tests (was 1141 — 16 new MCP tests across 7 patterns)
- 35 examples (was 34 — added 08-mcp.ts)
- AI tooling instructions (CLAUDE.md, AGENTS.md, all `ai-instructions/`)
  updated to cover MCP

## [2.1.0]

The first new context-engineering flavor since the v2.0 InjectionEngine
shipped. Validates the v2.0 thesis: "adding the next flavor is one new
factory file." defineRAG is exactly that — composes over the existing
memory subsystem (semantic + top-K + strict threshold), zero engine
changes, zero new event types.

### Added — RAG (`defineRAG` + `indexDocuments`)

Two-function public surface:

- `defineRAG({ id, store, embedder, topK?, threshold?, asRole? })` —
  the read-side factory. Returns a `MemoryDefinition` with RAG-friendly
  defaults (asRole='user', topK=3, threshold=0.7).
- `indexDocuments(store, embedder, documents, options?)` — the seeding
  helper. Embeds each doc, batches into `store.putMany()`. Used at
  application startup to populate the corpus before the first agent run.

Plus `Agent.rag(definition)` builder method — alias for `.memory()` so
consumer intent reads clearly:

```typescript
import { defineRAG, indexDocuments, InMemoryStore, mockEmbedder } from 'agentfootprint';

const embedder = mockEmbedder();
const store = new InMemoryStore();

await indexDocuments(store, embedder, [
  { id: 'doc1', content: 'Refunds processed in 3 business days.' },
  { id: 'doc2', content: 'Pro plan: $20/month.' },
]);

const docs = defineRAG({ id: 'product-docs', store, embedder, topK: 3, threshold: 0.7 });

agent.rag(docs); // alias for .memory(docs); same plumbing
```

Strict threshold semantics: when no chunk meets the threshold, no
injection happens (no fallback to top-K-anyway). Same panel-decision
rule as defineMemory({strategy: TOP_K}).

Multi-tenant corpora supported via `IndexDocumentsOptions.identity`.

### Added — `examples/context-engineering/07-rag.ts` + `.md`

End-to-end runnable example demonstrating the full RAG flow (seed →
define → query → retrieved-context-injected). Pairs with the existing
6 context-engineering examples.

### Added — AI tooling instructions cover RAG

`CLAUDE.md`, `AGENTS.md`, and every file under `ai-instructions/`
updated to include the RAG section so AI coding tools generate v2.1
code by default.

### Internal

- 1141 tests (was 1121 — 20 new RAG tests)
- 34 examples (was 33 — added 07-rag.ts)
- Public exports: `defineRAG`, `DefineRAGOptions`, `indexDocuments`,
  `IndexDocumentsOptions`, `RagDocument` from top-level barrel

## [2.0.1]

The first npm-published v2 build. v2.0.0 was tagged on GitHub but the
publish workflow failed before reaching `npm publish` because of a
case-sensitive Linux CI failure (`mapReduce.ts` vs `MapReduce.ts`).
2.0.1 carries every v2.0 feature plus the post-tag fixes:

### Fixed

- `src/patterns/mapReduce.ts` → `MapReduce.ts` so case-sensitive Linux
  CI resolves `import '../../../src/patterns/MapReduce.js'`. macOS dev
  hid the issue.
- ESLint `require-yield` violation in
  `test/resilience/unit/withFallback.test.ts` (intentionally-empty
  generator that throws before yielding — suppression added locally).

### Changed

- Release script Gate 5: now runs the in-repo `examples/` sweep
  (`npm run test:examples` → typecheck + tsx end-to-end run) instead
  of the external `../agent-samples` repo. Examples are now the source
  of truth for the consumer surface.
- Root README: tagline reframed to "Building Generative AI applications
  is mostly context engineering" (was "Building agents..."). Quick Start
  leads with `anthropic({...})` not `mock({reply})`. Roadmap split
  into "What v2.0 ships (today)" + "What's next" so v2.0 reads as a
  complete release. "Why a context-engineering framework" comparison
  table moved up — right after the patterns recipes — where the
  contrast lands hardest.
- Root README: 3-line code teaser between install + the pedagogy
  sections so fluent readers see the builder API in 5 seconds.

### AI tooling overhaul

- `CLAUDE.md`, `AGENTS.md`, and every file under `ai-instructions/`
  rewritten for the v2.0 surface. The old contents were stale (copy
  of footprintjs's instructions or v1 agentfootprint patterns), so
  AI coding tools using bundled instructions would generate code
  against APIs that no longer exist. New surface covers:
  - 6-layer mental model
  - All four `define*` factories (Skill / Steering / Instruction / Fact)
  - `defineMemory({ type, strategy, store })` with 4 types × 7 strategies
  - Multi-agent via control flow (no `MultiAgentSystem` class)
  - Anti-patterns naming the v1 vocabulary so tools don't regress
    consumers to old APIs

## [2.0.0]

The release that lands the **6-layer mental model** end-to-end:
2 primitives + 3 compositions + N patterns + Context Engineering +
**Memory** + Production Features. Every layer is pure composition over
the layers below — no hidden primitives.

### Added — InjectionEngine (unified context-engineering primitive)

One `Injection` primitive evaluated by one engine subflow each
iteration, with N typed sugar factories that all reduce to the same
shape:

- `defineSkill(...)` — LLM-activated body + tools (auto-attaches `read_skill`)
- `defineSteering(...)` — always-on system-prompt rule
- `defineInstruction(...)` — predicate-gated, supports `on-tool-return` for Dynamic ReAct
- `defineFact(...)` — developer-supplied data injection

Consumer wires them via `Agent.create(...).skill(...)`, `.steering(...)`,
`.instruction(...)`, `.fact(...)`, or the generic `.injection(...)`. Every
flavor emits `agentfootprint.context.injected` with `source` discriminating
the flavor — Lens / observability surfaces show one chip per active
injection without per-feature special casing.

### Added — Memory subsystem (`defineMemory` factory)

Single factory dispatches `type × strategy.kind` onto the right
pipeline. The 2D mental model:

```
                MEMORY = TYPE × STRATEGY × STORE

  TYPE                       STRATEGY                    STORE
  ──────────────────         ──────────────────          ─────────
  EPISODIC   messages        WINDOW    last N            InMemoryStore
  SEMANTIC   facts        ×  BUDGET    fit-to-tokens  ×  Redis · Dynamo
  NARRATIVE  beats           SUMMARIZE LLM compress      Postgres · …
  CAUSAL ⭐  snapshots       TOP_K     score-threshold   (peer-deps in v2.1+)
                              EXTRACT   distill on write
                              DECAY     recency × access
                              HYBRID    composed
```

- `Agent.memory(definition)` builder method — multiple memories layer
  cleanly via per-id scope keys (`memoryInjection_${id}`)
- `agent.run({ message, identity })` — multi-tenant scope through the
  full `MemoryIdentity` tuple (tenant / principal / conversationId)
- READ subflow runs at `MEMORY_TIMING.TURN_START` (default; `EVERY_ITERATION`
  opt-in for tool-result-sensitive memory)
- WRITE subflow mounts in the Final route branch with `propagateBreak`
  so writes happen reliably before the loop terminates
- Strict TopK threshold semantics — no fallback when nothing matches
  (garbage past context worse than no context)

**Causal memory ⭐ — the differentiator no other library has.**
footprintjs's `decide()` / `select()` capture decision evidence as
first-class events during traversal. Causal memory persists those
snapshots tagged with the original user query; new questions match
against past queries via cosine similarity, injecting decision evidence
into the next turn's context. Cross-run "why did you reject X?"
follow-ups answer from EXACT past facts — zero hallucination. Same data
shape supports SFT/DPO/process-RL training-data export in v2.1+.

### Added — examples folder (33 examples, all runnable end-to-end)

- `examples/core/` — 2 primitives (LLMCall, Agent + tools)
- `examples/core-flow/` — 4 compositions (Sequence, Parallel, Conditional, Loop)
- `examples/patterns/` — 6 canonical patterns (ReAct, Reflexion, ToT, MapReduce, Debate, Swarm)
- `examples/context-engineering/` — 6 InjectionEngine flavors
  (Instruction / Skill / Steering / Fact / Dynamic-ReAct / mixed)
- `examples/memory/` — 7 strategy-organized memory examples
- `examples/features/` — pause-resume, cost, permissions, observability, events

Every example is a runnable end-to-end test (CI runs `npm run test:examples`
which now does both typecheck + sweep). New `npm run example <path>`
wraps tsx with the right runtime tsconfig so consumers don't need
`TSX_TSCONFIG_PATH` env-var gymnastics.

### Added — top-level public exports

```ts
import {
  // Memory
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  MEMORY_TIMING,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
  identityNamespace,
  // InjectionEngine
  defineSkill,
  defineSteering,
  defineInstruction,
  defineFact,
  evaluateInjections,
  buildInjectionEngineSubflow,
  // … (existing core surface unchanged)
} from 'agentfootprint';
```

### Changed — Agent flowchart shape (internal — no consumer impact)

The Agent's main flowchart now has memory READ subflows mounted
between Seed and InjectionEngine, and the `Route → 'final'` branch is
now a sub-chart (`PrepareFinal → memory-write subflows → BreakFinal`)
so memory writes happen reliably before the loop terminates. This is
visible in narrative + Lens but doesn't change the consumer API.

### Changed — top-level scrub

- All `v2` marketing prefixes scrubbed from `src/` JSDoc / READMEs.
  The library is now just "agentfootprint", not "agentfootprint v2".
- Removed redundant `Execution stopped... due to break condition`
  console.info from footprintjs (3 sites — break is already recorded
  via `narrativeGenerator.onBreak`).

### Fixed — example runtime

- `examples/core/02-agent-with-tools.ts` — custom respond extracts
  city from user message instead of returning empty args
- All 33 examples now run end-to-end in CI; previously only typecheck
  was verified

### Internal — test counts

- agentfootprint: **1121 tests** (was 1044 in 1.23.0; +77 new memory tests)
- footprintjs (peer dep): 2436 tests pass after the leaked-log fix

### Roadmap (next minor releases)

| Release | Focus                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------- |
| v2.1    | Reliability subsystem (3-tier fallback, CircuitBreaker, auto-retry, fault-tolerant resume) + Redis store adapter |
| v2.2    | Governance subsystem (Policy, BudgetTracker, access levels) + DynamoDB adapter                                   |
| v2.3    | Causal training-data exports (`exportForTraining({format})`) + RLPolicyRecorder                                  |
| v2.4+   | MCP integration, Deep Agents, A2A                                                                                |

## [1.23.0]

### BREAKING — but no users yet, shipped as minor

`AgentTimelineRecorder` redesigned around an event stream + selectors + pluggable humanizer. `getTimeline()` method + the `AgentTimeline` bundle interface are removed. Consumers compose typed selectors directly (or use a thin helper like Lens's `timelineFromRecorder`). Three-layer architecture:

```
EVENT STREAM              (structured, canonical — single source of truth)
    ↓
SELECTORS                 (typed, memoized, lazy, composable — THE API)
    ↓
VIEWS                     (renderer plugs in: React / Vue / Angular / CLI / Grafana)
```

### Added — new selector API on `AgentTimelineRecorder`

- `getEvents(): readonly AgentEvent[]` — raw structured event stream
- `selectAgent()`, `selectTurns()`, `selectMessages()`, `selectTools()`, `selectSubAgents()`, `selectFinalDecision()` — classic slices
- `selectTopology()` — composition graph for flowchart renderers (engineer view)
- `selectCommentary(cursor?)` — humanized narrative, one line per event (analyst view)
- `selectActivities(cursor?)` + `selectStatus(cursor?)` — breadcrumb + typing-bubble (end-user view)
- `selectRunSummary()` — tokens, tool counts, duration, skills activated
- `selectIterationRanges()` — iter ↔ event-index map for scrubbers
- `selectContextBySource(cursor?)` — per-slot injection ledger grouped by source (rag / skill / memory / instructions / ...) — powers slot-row badges in Lens and the "teach context engineering" pedagogical surface
- `setHumanizer(Humanizer)` — pluggable domain phrasings. Library defaults ("Thinking", "Running ${toolName}", "Got result") override per-tool for domain-friendly text ("Checking port status on switch-3"). Translation, localization, UX tone = humanizer swap, NOT data change.

### Added — new exported types

`AgentEvent` (discriminated union — the canonical contract), `Activity`, `StatusLine`, `CommentaryLine`, `RunSummary`, `IterationRange`, `IterationRangeIndex`, `ContextBySource`, `ContextSlotSummary`, `ContextSourceSummary`, `Humanizer`.

### Changed — `selectSubAgents()` heuristic

A topology subflow classifies as a sub-agent only if its descendants include one of the API-slot subflows (`sf-system-prompt` / `sf-messages` / `sf-tools`). This correctly distinguishes:

- **Single-agent runs** — the API-slot subflows are top-level, nothing wraps them → no sub-agents
- **Multi-agent runs** (Pipeline/Parallel/Swarm/Conditional) — each Agent wraps its own slots → each qualifies

Robust against future internal-agent subflow additions (auto-classifies as "internal").

### Composed primitive

`AgentTimelineRecorder` now composes footprintjs's `TopologyRecorder` (new in footprintjs 4.15.0) internally. Runner-side `setComposition()` handshake — DELETED. Composition shape discovered at runtime from the executor's traversal (subflow / fork / decision / loop events).

### Memoized selectors

Every selector is memoized by `(name, version, cursor)`. `version` increments on every `emit()` / `setHumanizer()` / `clear()` — long runs don't recompute unchanged views. Same selector call returns the same reference until new events arrive (referential equality for React).

### 10+ new pattern tests

selectActivities state machine + cursor, selectStatus idle/at-cursor, selectCommentary, selectRunSummary totals, humanizer override + fall-through + swap invalidation, selectIterationRanges, memoization reference equality, clear() invalidation, selectContextBySource grouping + cursor.

### Migration

```diff
- const t = agentTimeline();
- const timeline = t.getTimeline();
- timeline.turns;
- timeline.messages;
- timeline.subAgents;
+ const t = agentTimeline();
+ const turns = t.selectTurns();
+ const messages = t.selectMessages();
+ const subAgents = t.selectSubAgents();
```

UI libraries that want a bundled shape define their own helper (Lens ships `timelineFromRecorder(recorder)`).

## [1.22.0]

### attachRecorder() on every runner — multi-agent flows end-to-end

- **FlowChartRunner / ConditionalRunner / ParallelRunner / SwarmRunner**
  all gain `attachRecorder(recorder)` matching the AgentRunner contract.
  Returns detach function; idempotent on recorder id.
- Without this, `<Lens for={runner} />` for these multi-agent
  composition runners fell back to `runner.observe()` + flat
  AgentStreamEvent translation — losing `subflowPath`, which
  broke multi-agent grouping in Lens (subAgents always empty).
- New shared helper `attachRecorderToList()` so the four
  composition runners + AgentRunner stay in sync; future \*Runner
  classes get the same behavior with one line of glue.
- 1960 / 1960 tests pass.

End-to-end multi-agent now works in `<Lens for={runner} />`:

- FlowChart pipeline (classify → analyze → respond) renders 3
  stacked sub-agent boxes
- Conditional / Parallel / Swarm samples render the right number
  of sub-agent boxes for their composition pattern

## [1.21.0]

### Multi-agent foundations

- **`runner.attachRecorder(rec)`** — new method on AgentRunner. Attach
  a recorder POST-BUILD; it participates in every subsequent `.run()`
  with the standard recorder lifecycle (clear() + emit-channel hookup
  via forwardEmitRecorders). Returns a detach function; idempotent on
  recorder id (matching the rest of the recorder-attachment contract).
  Lets `<Lens for={runner} />` consume EmitEvents directly (real
  runtimeStageId + subflowPath), unblocking multi-agent grouping.
- **`AgentTimeline.subAgents`** — new field on the timeline shape.
  Per-sub-agent slices for multi-agent runs (Pipeline / Swarm /
  Routing). Empty array for single-agent runs. Each entry is its own
  SubAgentTimeline with `id`, `name`, own `turns`, own `tools` —
  derived by grouping TimelineEntries by `subflowPath[0]`.
- **`SubAgentTimeline`** — new exported type. Self-contained sub-
  agent timeline shape that UIs iterate over for multi-agent
  rendering.
- **TimelineEntry now carries `subflowPath`** internally — preserved
  verbatim from the EmitEvent so the folder can derive sub-agents
  without re-reading source events.
- 7th pattern test added covering multi-agent grouping (Pipeline-style
  classify→analyze→respond) + single-agent's empty subAgents.

The data shape is the contract every UI library reads. `agentfootprint-
lens` 0.11+ uses it to render N agent containers (one per sub-agent)
for Pipeline / Swarm / Routing samples.

## [1.20.0]

### Agent identity surfaces on `AgentTimeline`

- **`agentTimeline({ name })`** — new option on the recorder factory.
  Set the display name once at recorder construction; surfaces on
  `timeline.agent.name`. Match this to `Agent.create({ name })` for
  end-to-end identity consistency.
- **`AgentTimeline.agent`** — new required field of shape
  `{ id, name }`. UI libraries read this directly instead of fishing
  the agent name out of `runtimeSnapshot.agentName / .name` or asking
  the consumer to thread a separate prop. Single source of truth.
- **New exported type `AgentInfo`** —
  `{ id: string; name: string }`. Shape of the new field.
- **Defaults**: `id` falls back to `agentfootprint-agent-timeline`,
  `name` falls back to `Agent`. UIs that get the fallback render
  "Agent · Agent" rather than crashing on undefined.
- **Multi-agent foundation**: each sub-agent recorder
  (`agentTimeline({ id: 'classify', name: 'Classify Bot' })`) carries
  its own identity → multi-agent shells render N labeled containers
  pulling each name from `timeline.agent.name` directly.
- 6th pattern test added, full suite green (1959 tests).

This is the data-layer counterpart to lens 0.9.0's "Agent container +
LLM rename" UI work. Lens reads `timeline.agent.name` to label the
dotted Agent boundary that wraps the LLM / Tool / Skill / satellites.

## [1.19.0]

### New recorder — `agentTimeline()` (the canonical agent narrative)

Parallels footprintjs's `CombinedNarrativeRecorder`. One place every UI
/ observability consumer translates the agentfootprint emit stream into
the agent-shaped narrative they render against — turns → iterations →
tool calls + per-iteration context injections + folded ledger. UI
libraries (`agentfootprint-lens`, `agentfootprint-grafana`, custom
dashboards) consume the same shape instead of each re-implementing
their own translation.

- **`agentTimeline(options?)`** factory, exported from both
  `agentfootprint` and `agentfootprint/observe`. Returns an
  `AgentTimelineRecorder` that extends footprintjs
  `SequenceRecorder<TimelineEntry>` and implements `EmitRecorder`.
  Gets storage, keyed index, range index, progressive `accumulate()`,
  and the `clear()` lifecycle hook for free — no reinvented
  bookkeeping.
- Attach via the standard `.recorder(t)` on AgentBuilder;
  `forwardEmitRecorders` routes to `executor.attachEmitRecorder(t)`.
- **Public types**: `AgentTimeline`, `AgentTurn`, `AgentIteration`,
  `AgentToolInvocation`, `AgentToolCallStub`, `AgentMessage`,
  `AgentContextInjection`, `AgentContextLedger`. These are the data
  contract every UI library consumes.
- **Context-injection routing** preserves semantics: events during the
  LLM phase shape THIS iter's prompt; events between phases shape the
  NEXT iter (skill activation post-`read_skill`).
- **Multi-agent**: `agentTimeline({ id: 'classify' })` — each sub-agent
  in a Pipeline/Swarm gets its own named recorder, its own snapshot
  slot.
- 5 pattern tests (`test/unit/agent-timeline-recorder.test.ts`):
  basic shape, ReAct loop ordering (tool_start after llm_end),
  context-injection routing, multi-turn, clear() lifecycle.
- Docs update in `src/recorders/README.md`.

## [1.18.0]

### Context engineering — first-class teaching surface

- **New `contextEngineering()` recorder** (`src/recorders/ContextEngineeringRecorder.ts`).
  Public consumer-facing recorder that subscribes to the emit channel and
  exposes a structured query API: `injections()`, `ledger()`,
  `ledgerByIteration()`, `bySource()`, `bySlot()`, `clear()`. Lets any
  UI layer (Lens, Datadog, custom panels) observe **who** injected
  **what** into **which** Agent slot, on every iteration. Mirrors
  `agentObservability()` in shape — same factory, same emit-channel
  substrate, different domain focus.

- **Context-injection emits land at the source of truth.**

  - `agentfootprint.context.rag.chunks` fires from
    `src/stages/augmentPrompt.ts` with role + targetIndex + chunkCount +
    topScore (was previously emitted before role/index were known).
  - `agentfootprint.context.skill.activated` fires from
    `src/lib/call/toolExecutionSubflow.ts` whenever
    `decision.currentSkill` flips post-`read_skill`. Carries `skillId`,
    `previousSkillId`, `deltaCount: { systemPromptChars, toolsFromSkill }`.
  - `agentfootprint.context.instructions.fired` fires when
    AgentInstructions fire on a turn — counted, with delta info.
  - `agentfootprint.context.memory.injected` fires from memory subsystem
    when prior-turn memory writes flow back into the prompt.

- **`forwardEmitRecorders()` helper**
  (`src/recorders/forwardEmitRecorders.ts`). Detects whether a
  user-supplied recorder implements `onEmit` and routes it to
  `executor.attachEmitRecorder()`. Wired into all 7 runners (Agent,
  LLMCall, RAG, FlowChart, Parallel, Swarm, Conditional) so
  `.recorder(contextEngineering())` Just Works without consumers having
  to know about footprintjs's three-channel observer architecture.

- **`StreamEventRecorder` forwards `agentfootprint.context.*`** events to
  the `AgentStreamEventHandler`, so consumers using `<Lens for={runner} />`
  see context events alongside stream events without a separate
  subscription.

### Multi-agent + EventDispatcher

- **`EventDispatcher`** — per-runner observer list pattern in
  `src/streaming/EventDispatcher.ts`. Foundation for the
  `runner.observe()` contract Lens consumes.
- Multi-agent type updates in `src/types/multiAgent.ts` + tests.

### Examples + tests

- Snapshot tests updated for the new emit events in execution traces.
- New test scaffolding for context-engineering recorder e2e
  (`test/integration/ce-recorder-e2e.test.ts`,
  `test/unit/context-engineering-recorder.test.ts`,
  `test/unit/context-injection-emits.test.ts`,
  `test/unit/runner-observe-contract.test.ts`).

### Docs

- New / updated guides: `dynamic-react.mdx`, `rag.mdx`, `swarm.mdx`,
  `key-concepts.mdx`, `quick-start.mdx`, `why.mdx`, `vs.mdx`,
  `debug.mdx`.
- README + index.mdx refreshed for the new context-engineering surface.

## [1.17.6]

### Examples — full footprintjs-style parity

- **Wrote 19 missing `.md` explainer files** so every `.ts` example now has
  a paired `.md` (31 / 31 — full 1:1 coverage matching the
  footprintjs/examples/ pattern). New explainers cover: `providers/` (3),
  `runtime-features/{streaming,instructions,parallel-tools,custom-route,memory}/`
  (6), `observability/` (4), `security/` (1), `resilience/` (2),
  `advanced/` (1), `integrations/` (2). Same frontmatter format
  (`name`, `group`, `guide`, `defaultInput`) and same section structure
  (When to use / What you'll see in the trace / Key API / Failure modes /
  Related) as the `concepts/` and `patterns/` explainers shipped in
  v1.17.5.

### Tests — snapshot regression detection

- **`test/examples-smoke.test.ts` now asserts `toMatchSnapshot()`** on
  every example's `run()` output. The previous version only verified
  "does it run without throwing?" — too weak to catch silent behavior
  drift. Now if a library change alters tool counts, iteration counts,
  branch selection, content shape, or any other observable result, the
  snapshot diff fails loudly and forces the author to either fix the
  example or update the golden with `npm test -- -u`.
- 31 baseline snapshots committed to `test/__snapshots__/`. Stable across
  re-runs (verified) — non-determinism (timestamps, latencies, generated
  trace IDs, JSON byte sizes) is scrubbed by a small `sanitize()` helper
  before comparison.
- Brings the in-repo gate to parity with footprintjs's
  `footprint-samples/test/integration` snapshot suite — but inside the
  main repo, no external sibling required.

## [1.17.5]

### Examples

- **Restructured `examples/` from feature-buckets into a lifecycle-based
  ladder** that mirrors the footprintjs/examples/ pattern. New folders:
  `concepts/` (the 7-concept ladder, in order), `patterns/` (Regular vs
  Dynamic + the 4 composition patterns each in their own file),
  `providers/`, `runtime-features/{streaming,instructions,memory,parallel-tools,custom-route}`,
  `observability/`, `security/`, `resilience/`, `advanced/`,
  `integrations/`. The old folders (`basics/`, `orchestration/`,
  `memory/`, `integration/`) are gone — files renumbered sequentially
  within their new home so `01,02,03,...` reflects learning order.
- **Added `examples/DESIGN.md`** explaining the categorization rationale,
  the file contract, and the playground-injection pattern. Added
  `examples/README.md` as the reader's entry point.
- **Every example now follows a single contract**: exports
  `run(input, provider?)` (factory pattern) + `meta: ExampleMeta`
  (catalog metadata for the playground) + a CLI fallback so
  `npx tsx examples/...` still works. The optional `provider` parameter
  lets the playground inject any LLMProvider at runtime — the example
  source stays clean and copy-pastable. Multi-provider examples
  (`planExecute`, `reflexion`, `treeOfThoughts`, `mapReduce`) accept an
  object with named slots declared in `meta.providerSlots`.
- **Split `orchestration/28-patterns.ts`** into four separate files
  under `patterns/` — one per pattern — so each is independently
  citable and runnable.
- **Added `concepts/05-parallel.ts`** — the Parallel concept previously
  had no standalone example.
- **Added paired `.md` files** for `concepts/` (7) and `patterns/` (5)
  with frontmatter (`name`, `group`, `guide`, `defaultInput`),
  "When to use", "What you'll see in the trace", "Key API",
  "Failure modes", and "Related concepts" sections — same shape as
  footprintjs/examples/building-blocks/\*.md. Other folders' .md files
  will be added in follow-up patches.
- **New `examples/helpers/cli.ts`** centralizes the
  `isCliEntry(import.meta.url)` guard, the `printResult()` formatter,
  and the `ExampleMeta` type.

### Tests

- **New `test/examples-smoke.test.ts`** auto-discovers every example
  under `examples/`, verifies the file contract (`run` + `meta`
  exports with the right shape), and invokes each `run()` with the
  example's own scripted mock provider. 32 examples covered. This
  replaces the previous gate-5 dependency on
  `agent-samples/npm-run-all` — examples are now self-validating
  inside the agentfootprint repo.

### `agent-samples` (separate repo)

- **Updated `agent-samples/package.json`** to point at the new example
  paths so the cross-repo `npm run all` keeps working through the
  transition. Marked the package as DEPRECATED in its description —
  the in-repo smoke test supersedes it; the directory will be removed
  once the playground migration is complete.

## [1.17.4]

### Documentation

- **New `docs/guides/patterns.md`** covering both loop patterns
  (`AgentPattern.Regular` vs `Dynamic`) and the four composition pattern
  factories (`planExecute`, `reflexion`, `treeOfThoughts`, `mapReduce`)
  that ship from `agentfootprint/patterns` but were previously
  undocumented. Each pattern section includes an everyday analogy, the
  canonical research citation (Yao et al. 2023, Shinn et al. 2023, Wang
  et al. 2023, Madaan et al. 2023, Dean & Ghemawat 2004), an
  "honesty box" naming the simplification (e.g. shipped `reflexion`
  factory is closer to Self-Refine than full Reflexion), per-pattern
  observability + failure-mode notes, and a
  "Picking a quality pattern" decision table.
- **`docs/guides/concepts.md` updated to reflect the seven shipped
  concepts** (was documenting five — `Parallel` and `Conditional` were
  missing). Added builder + runner sections for both, plus
  per-concept analogies, ReAct/RAG/Swarm citations, and failure-mode
  notes for every concept.
- **`docs/guides/recorders.md` adds the missing `ExplainRecorder`
  section** — the per-iteration grounding evidence recorder that the
  README pitches as the differentiator. Also adds the LLM-as-judge
  caveat (Zheng et al. 2023) on `QualityRecorder`, the recorder-id
  idempotency rule, and updates the summary table with `ExplainRecorder`,
  `PermissionRecorder`, and `agentObservability()`.
- **All other guides (`quick-start`, `providers`, `adapters`,
  `orchestration`, `security`, `instructions`, `streaming`) reviewed
  through a four-persona lens** (student / professor / senior engineer
  / researcher) and updated with: opening analogies, prior-art
  citations where applicable, "Failure modes" / "Cost note" /
  "What's novel" subsections at production-relevant spots, and honest
  positioning language separating shipped behavior from prior art.
- Quick-start example tool replaced (deterministic `add` instead of a
  fake `web_search` returning a hallucinated answer); a new
  "Before You Ship" production checklist links the security /
  orchestration / observability primitives readers should add before
  deploying with a real provider.
- No source code changes — documentation-only release.

## [1.17.3]

### Fixed

- **`agentfootprint.stream.llm_end` now forwards token usage and stop
  reason.** The typed `AgentStreamEvent` schema carried
  `{iteration, toolCallCount, content, model, latencyMs}` but omitted
  `usage` and `stopReason` — so stream consumers (Lens, cost meters,
  any dashboard subscribing to the stream) got `0→0` tokens and no
  finish reason, even though the same data was already present on the
  sibling `agentfootprint.llm.response` event. Three emit sites
  (`callLLMStage.ts` + both paths in `streamingCallLLMStage.ts`) now
  include `usage: response.usage` and
  `stopReason: response.finishReason`. Schema additions are optional
  fields → backwards-compatible for consumers that ignore them.

## [1.17.2]

### Fixed

- **InstructionsToLLM subflow was concatenating arrays across Dynamic
  ReAct iterations.** `buildAgentLoop` mounted `sf-instructions-to-llm`
  without `arrayMerge: ArrayMergeMode.Replace`, so each loop iteration
  appended its `promptInjections` / `toolInjections` to the parent
  scope — the effective system prompt grew 7→14→21→28 lines, and the
  tool list doubled on every turn, triggering Anthropic's
  `"tools: Tool names must be unique"` rejection on iter 4+. Matches the
  existing Replace flag on `sf-messages` / `sf-tools`.
- **`.skills(registry)` did not register per-skill tools for dispatch.**
  Skill tools were declared to the LLM via `AgentInstruction.tools`
  injections, but the dispatch registry only had `list_skills` +
  `read_skill`. When an LLM called a skill-gated tool,
  `staticTools.execute()` returned `{error: true, content: "Unknown
tool: ..."}` and the turn wedged. `.skills()` now iterates each
  skill's `tools: []` and registers them into the agent's `ToolRegistry`
  so dispatch is always reachable.
- **ToolProvider dispatch now falls back to the registry on "Unknown
  tool" errors.** Callers who use a narrow resolve-time provider
  (`staticTools([listSkills, readSkill])` + injection-based visibility)
  need dispatch to reach the registered skill tools. Both the
  sequential and parallel dispatch paths in `lib/call/helpers.ts` now
  check: if the primary provider reports the tool as unknown AND the
  registry has it, fall through to the registry handler.
- **Decision scope now persists across `.run()` calls.** Previously
  `scope.decision = { ...initialDecision }` reset the decision on every
  turn, so follow-up messages would silently lose the `currentSkill`
  written by the prior turn's `read_skill` — causing `autoActivate` to
  stop surfacing the skill's tools on iter 1 of turn 2+. The runner now
  captures `state.decision` after each run and re-seeds from it next
  time. Cleared by `resetConversation()` for clean new dialogues.
  Unblocks multi-turn chat where the skill context should feel
  continuous.
- **`buildToolsSubflow` now defensively dedupes on three axes.** Base
  tools vs. base tools (in case the provider returned duplicates),
  base vs. injections (pre-existing check), and within injections
  themselves. First-wins on every axis. Belt-and-braces safety net
  against the Anthropic "tool names must be unique" rejection even if
  a future bug reintroduces an injection collision.
- Added 2 new tests to `test/lib/slots/tools.test.ts` pinning the dedup
  behaviors — 15/15 slot tests pass, 1874/1874 full suite still green.

## [1.17.1]

### Fixed

- `SkillRegistry.toTools()` aliased `this` via `const registry = this` which
  tripped the `@typescript-eslint/no-this-alias` rule post-release CI.
  Replaced with explicit `.bind(this)` method captures + a direct reference
  to `this.options.autoActivate` — cleaner closure pattern, no behavioral
  change, 1872/1872 tests still pass.

## [1.17.0]

### Added

- **`SkillRegistry.autoActivate`** — one-line skill-gated tool visibility
  (`agentfootprint/skills`). Unlocks the 25+-tool regime without
  customers hand-wiring a ~30-LOC bridge for every adopter.

  When configured, the auto-generated `read_skill(id)` tool writes the
  loaded skill's id into agent decision scope. Downstream
  `AgentInstruction.activeWhen: (d) => d[stateField] === 'my-skill'`
  predicates fire naturally — so each skill's `tools: [...]` only reach
  the LLM when that skill is active. Smaller tool menus per turn, no
  token-budget drift on long tool lists.

  ```ts
  const registry = new SkillRegistry<TriageDecision>({
    surfaceMode: 'auto',
    autoActivate: { stateField: 'currentSkill' },
  });
  ```

  - `SkillRegistryOptions.autoActivate?: AutoActivateOptions` — new
    config shape: `{ stateField: string, onUnknownSkill?: 'leave'|'clear' }`
  - `read_skill` now returns `{ content, decisionUpdate: { [stateField]: id } }`
    when configured; decisionUpdate is merged into agent decision scope
    by the tool-execution stage.
  - `toInstructions()` auto-fills `activeWhen: (d) => d[stateField] === skill.id`
    on any skill that doesn't declare its own — so consumers set
    `autoActivate` once and every skill gates its own tools by id.
  - `AgentBuilder.skills(registry)` auto-switches agent pattern to
    `Dynamic` when registry has autoActivate, because Regular pattern
    assembles instructions once per turn and wouldn't re-materialize
    tools on the next iteration. Explicit `.pattern(AgentPattern.Regular)`
    after `.skills()` overrides.
  - `SkillRegistry.hasAutoActivate` / `.autoActivate` getters for
    consumers writing custom builders.

- **`ToolResult.decisionUpdate` + `ToolExecutionResult.decisionUpdate`**
  — new optional field any tool (not just auto-generated skill tools)
  can use to write a partial update into the agent's decision scope.
  The tool-execution stage applies shallow `Object.assign(decision, update)`
  after the tool runs. Built-in ToolProviders (`staticTools`,
  `gatedTools`, `compositeTools`, `agentAsTool`) pass it through from
  the inner handler.

### Changed

- Tool-execution subflow: `decisionRef` is now always allocated as `{}`
  when the inbound decision scope is undefined (previously tri-state).
  Simpler invariant + fixes a latent bug where the first turn's
  decision writes from any tool (decide() or decisionUpdate) could be
  dropped if no initial decision scope was configured.

### Tests

- 13 new 5-pattern tests for `autoActivate` (unit / boundary / scenario
  / property / security). Library total: **1872 tests passing**
  (was 1859).

## [1.16.0]

### Added

- **Skills** (`agentfootprint/skills`) — typed, versioned agent skills
  with cross-provider correct delivery. The Claude Agent SDK pattern,
  packaged at `agentfootprint`'s framework layer.
  - `defineSkill<TDecision>(skill)` factory — typed, inference-friendly.
  - `SkillRegistry<TDecision>` — compile skills into `AgentInstruction[]`
    - auto-generated `list_skills` / `read_skill` tools + optional
      system-prompt fragment.
  - `Skill extends AgentInstruction` — every `activeWhen` / `prompt` /
    `tools` / `onToolResult` field inherited, skills add `id`,
    `version`, `title`, `description`, optional `scope[]`, `steps[]`,
    and `body` (string or async loader for disk/blob/Notion).
  - Four surface modes: `'tool-only'` (portable default, works on every
    provider), `'system-prompt'`, `'both'`, `'auto'` (library picks per
    provider — Claude ≥ 3.5 → `'both'`, everyone else → `'tool-only'`).
  - `AgentBuilder.skills(registry)` — one-line wiring. Idempotent
    replace (call twice, latest wins).
  - Tag-escape defense in rendered skill bodies: `</memory>`,
    `</tool_use>`, `</skill>` escaped in author-controlled fields.
  - Error paths (unknown id, lazy-loader throws, path-traversal
    attempts) return `isError: true` in the tool result — agent
    recovers, no crash.
  - Full documentation: `/guides/skills`.
  - `ToolRegistry.unregister(id)` — small focused API for builder-layer
    idempotent replace flows.

### Tests

- 41 new tests across 2 files (32 unit + 9 acceptance).
- Library total: 1859 tests passing.

## [1.15.0]

### Added

- **`autoPipeline()`** — the opinionated default memory preset
  (`agentfootprint/memory`). Composes facts (dedup-on-key) + beats
  (append-only narrative) on a single store, emitting ONE combined
  system message on read.
  - Zero-LLM-cost defaults (`patternFactExtractor` + `heuristicExtractor`).
  - Single `provider` config knob upgrades BOTH extractors to
    LLM-backed in one line.
  - Explicit `factExtractor` / `beatExtractor` escape hatches for
    mixed-quality configurations.
  - READ subflow: `LoadAll` (one `store.list`, split by payload shape
    via `isFactId` + `isNarrativeBeat`) → `FormatAuto` (facts block +
    narrative paragraph in one system msg).
  - WRITE subflow: `LoadFacts` (update-awareness) → `ExtractFacts` →
    `WriteFacts` → `ExtractBeats` → `WriteBeats`.
  - `AutoPipelineState` extends both `FactPipelineState` +
    `ExtractBeatsState` for typed scope.
  - Full documentation: `/guides/auto-memory`.

### Tests

- 16 new tests across 2 files (5-pattern coverage + acceptance).
- Library total: 1818 tests passing.

## [1.14.0]

### Added

- **Fact extraction** (`agentfootprint/memory`). Stable key/value
  fact memory with dedup-on-write — "what's currently true" as a
  complement to beats ("what happened").
  - `Fact<V>` type with `key` / `value` / optional `confidence` /
    `category` / `refs[]` (source-message provenance, like beats).
  - `factId(key)` helper → stable `fact:${key}` MemoryStore ids.
    Last-write-wins: the same key written twice REPLACES the prior
    entry (unlike beats/messages which are append-only).
  - `FactExtractor` interface + two implementations:
    - `patternFactExtractor()` — zero-dep regex heuristics for
      identity / contact / location / preference. Free.
    - `llmFactExtractor({ provider })` — LLM-backed extraction with
      `existing`-facts prompt injection so the model can update
      rather than duplicate. One call per turn. Malformed JSON falls
      back to `[]` with `onParseError` callback.
  - Stages: `extractFacts`, `writeFacts`, `loadFacts`, `formatFacts`.
    `formatFacts` renders a compact `Known facts:` key/value block
    (not `<memory>` tags, not a paragraph) — the shape LLMs parse
    most efficiently.
  - `factPipeline({ store, extractor? })` preset. Read subflow:
    LoadFacts → FormatFacts. Write subflow: LoadFacts → ExtractFacts
    → WriteFacts (LoadFacts-on-write surfaces existing facts to the
    extractor for update-awareness).
  - Full documentation: `/guides/fact-extraction`.

### Tests

- 104 new tests across 6 files (5-pattern coverage per layer).
- Library total: 1802 tests passing.

## [1.13.0]

### Added

- **Semantic retrieval** (`agentfootprint/memory`). Vector-based
  recall via cosine similarity over entry embeddings.
  - `Embedder` interface with `embed()` / optional `embedBatch()` —
    pluggable (OpenAI / Voyage / Cohere / custom). Ships
    `mockEmbedder()` (deterministic character-frequency hash) for tests.
  - `MemoryEntry.embedding?` + `embeddingModel?` fields for indexing.
  - `MemoryStore.search?(identity, query, options)` optional method;
    `InMemoryStore` implements O(n) cosine scan. Options: `k`,
    `minScore`, `tiers`, `embedderId` (cross-model safety).
  - `cosineSimilarity(a, b)` helper; length-mismatch throws,
    zero-magnitude returns 0 (never NaN).
  - Stages: `embedMessages` (write-side) + `loadRelevant` (read-side,
    pulls query from last user message by default).
  - `semanticPipeline({ store, embedder, embedderId? })` preset —
    drop-in replacement for `defaultPipeline` with vector recall.
  - Write-side: `writeMessages` attaches per-message embeddings
    from `scope.newMessageEmbeddings` when present.
  - Read-side: `mountMemoryRead` passes `scope.messages` into the
    subflow so `loadRelevant` derives the query from the user turn.
  - 85 new 5-pattern tests + 4-scenario acceptance test.
  - `/guides/semantic-retrieval` docs.

### Changed

- `test/lib/concepts/Agent.parallelTools.test.ts` — perf threshold
  relaxed from 2× to 2.5×DELAY to tolerate dev-machine jitter while
  still discriminating parallel (≤2.5×) from sequential (3×).

## [1.12.0] — BREAKING

### Added

- **Narrative memory** (`agentfootprint/memory`). A new memory strategy
  that compresses each turn into `NarrativeBeat`s on write and recalls
  them as a single cohesive paragraph on read — instead of storing
  raw messages.
  - `NarrativeBeat` type: `{ summary, importance, refs, category? }`
    — every beat carries `refs[]` traceable back to source messages
    for explainability / audit.
  - `BeatExtractor` interface with two built-in implementations:
    - `heuristicExtractor()` — zero-dep, zero-cost baseline.
    - `llmExtractor({ provider, systemPrompt?, onParseError? })` —
      one LLM call per turn, produces semantically rich beats. Robust
      JSON parsing; malformed responses skipped without crashing turns.
  - `extractBeats(config)` + `writeBeats(config)` write-side stages.
  - `formatAsNarrative(config)` read-side stage — composes selected
    beats into a single paragraph (vs `formatDefault`'s per-entry blocks).
  - `narrativePipeline({ store, extractor?, ... })` preset — drop-in
    replacement for `defaultPipeline` with beat-based memory.
  - **Differentiator**: no other open-source agent framework provides
    beat-level traceability for recalled memory.
  - 77 new 5-pattern tests + 4-scenario acceptance test.
  - `/guides/narrative-memory` docs.

### Removed (hard break — pre-GA, no deprecation cycle)

- **`Agent.memory(config: MemoryConfig)`** builder method.
  Superseded by `.memoryPipeline(pipeline)` which landed in 1.11.0.
- **`MemoryConfig` / `ConversationStore`** interfaces and the legacy
  `InMemoryStore` adapter from `src/adapters/memory/`. The canonical
  store interface is now `MemoryStore` in `agentfootprint/memory`.
- **`createCommitMemoryStage` / `CommitMemoryConfig`** —
  `CommitMemory` stage retired; the memory pipeline's write subflow
  lives inside the `final` branch subflow and is composed via
  `mountMemoryWrite`.
- **`createPrepareMemorySubflow` / `PrepareMemoryConfig`** —
  absorbed into the memory pipeline's read subflow.
- **`persistentHistory()` message strategy + its bundled `InMemoryStore`** —
  message strategies now focus on in-context reshaping (sliding
  window, char budget, summary). Durable persistence lives in the
  memory pipeline.
- **`MessagesSlotConfig.store` / `.conversationId`** fields — the
  Messages slot is now strategy-only. Durable persistence is owned by
  the memory pipeline.
- **`AgentLoopConfig.commitMemory` / `.useCommitFlag` / `.onStreamEvent`**.
  Memory wiring flows via `memoryPipeline`. Stream events route
  through the emit channel — attach an onEvent callback via
  `agent.run(msg, { onEvent })`.
- **`memory_storedHistory` scope field + `MEMORY_PATHS.STORED_HISTORY`** —
  dead after `CommitMemory` removal.
- **Legacy store adapters** `redisStore`, `dynamoStore`, `postgresStore`
  — real backends land in Phase 3 against the new `MemoryStore` interface.

### Changed

- **Conditional concept** (`Agent.route()` extensions) now mounts
  branches as subflows when the runner exposes `toFlowChart()`,
  matching the `FlowChart.ts` / `Swarm` patterns. UI consumers get
  drill-down into routed-to agents for free.
- **Stream events now flow through the emit channel.**
  `agentfootprint.stream.llm_start` / `llm_end` / `token` / `thinking`
  / `tool_start` / `tool_end` events are emitted with the full
  `AgentStreamEvent` as the payload. `AgentRunner` attaches a
  `StreamEventRecorder` (public API in `agentfootprint/stream`) that
  forwards emits to the consumer's `{ onEvent }` callback — zero
  closure capture of handlers inside stage code.
- **Agent chart is now CACHED** — built once per agent, reused across
  all `.run()` and `.toFlowChart()` calls. Per-run data (stream handler,
  memory identity, seed messages) flows via args / attached recorders.
- **`pickByBudget`** restructured as a proper decider stage with three
  branches (`skip-empty`, `skip-no-budget`, `pick`) — decision evidence
  now lands on `FlowRecorder.onDecision` with structured `rules[]`.
- **`MemoryStore.putMany`** added for batched writes. `writeMessages`
  now persists a turn's messages in one round-trip instead of N.
- **`RouteResponse` decider** uses the filter-form `decide()` DSL with
  structured evidence (`{ key: 'hasToolCalls', op: 'eq', threshold: true, … }`).
  `ParseResponse` lifts `parsedResponse.hasToolCalls` to the flat
  `scope.hasToolCalls` so the filter form can reach it.
- **`buildSwarmRouting` + `Conditional`** deciders return full
  `DecisionResult` objects so `FlowRecorder.onDecision` captures
  evidence (no more silent `.branch`-only returns).

### Migration

Replace:

```ts
const store = new InMemoryStore();
const agent = Agent.create({ provider }).memory({ store, conversationId: 'user-123' }).build();
```

With:

```ts
import { defaultPipeline, InMemoryStore } from 'agentfootprint/memory';

const pipeline = defaultPipeline({ store: new InMemoryStore() });
const agent = Agent.create({ provider }).memoryPipeline(pipeline).build();

await agent.run(message, {
  identity: { conversationId: 'user-123' },
});
```

## [1.11.0]

### Added

- **`agentfootprint/memory` subpath — full memory pipeline system.** Built bottom-up in 9 reviewed layers, 190 tests, composing into a flowchart-first architecture consistent with the rest of the library.
  - **Identity + entries** — `MemoryIdentity { tenant?, principal?, conversationId }`, `MemoryEntry<T>` with decay/tier/source/version, pure `computeDecayFactor()` with exponential time decay + access boost.
  - **`MemoryStore` interface** — 9-method CRUD boundary with pagination cursor, `putIfVersion` optimistic concurrency, `seen()` recognition, `feedback()` usefulness aggregation, `forget()` GDPR delete. `InMemoryStore` reference implementation (zero deps, TTL-aware, tenant-isolated).
  - **Reusable stages** — `loadRecent`, `writeMessages`, `pickByBudget` (decider — budget-aware selection with `decide()` evidence), `formatDefault` (source-cited `<memory>` blocks + prompt-injection escape), `summarize` (deterministic contract for prompt caching).
  - **Pipeline presets** — `defaultPipeline()` (load → pick → format for read; persist for write), `ephemeralPipeline()` (read-only, compliance-grade no-write guarantee).
  - **Wire helpers** — `mountMemoryRead`, `mountMemoryWrite`, `mountMemoryPipeline` for composing pipelines into custom flowcharts.
- **`Agent.memoryPipeline(pipeline)` builder method** — first-class integration wiring the pipeline's read subflow before `AssemblePrompt` and write subflow after `Finalize`. Prior-turn memory is injected as citation-tagged `system` messages that AssemblePrompt prepends to the LLM prompt.
- **Per-run identity via `agent.run(msg, { identity, turnNumber?, contextTokensRemaining? })`** — same agent instance can serve many tenants / sessions with hardware-enforced isolation. Identity defaults to `{ conversationId: 'default' }` when omitted.
- **Example** `examples/memory/30-remember-across-turns.ts` — Alice/Bob session isolation demo using `mock` adapter.
- **5 integration tests** in `test/integration/memoryPipeline.test.ts` covering turn-1 persistence, turn-2 retrieval, per-run identity scoping, tenant isolation, and `.memory()` vs `.memoryPipeline()` mutual exclusivity.

### Process

- Every one of the 9 layers cleared an 8-person review gate (performance, DS/algorithms, security, research/RAG, platform, Anthropic, abstract/modular, 5-pattern tests) — iterating until no actionable findings remained. All 7 industry + 3 research reviewer asks from the design phase landed (hierarchical identity, pagination, `putIfVersion`, source-tagged recall, budget-aware picker, `seen()` + `feedback()`, decay math, ephemeral mode, deterministic summarizer, prompt-injection escape in formatter).

### Compatibility

- Existing `Agent.memory(MemoryConfig)` legacy API is unchanged. New consumers should prefer `.memoryPipeline()`. The two cannot be combined on the same builder — builder throws if both are set.
- Internals: `AgentLoopConfig` gains optional `memoryPipeline?: MemoryPipeline` alongside the existing `commitMemory?`. Legacy `commitMemory` path takes precedence when both somehow reach the loop (guards exist at the builder level).

## [1.10.0]

### Added

- **`exportTrace(runner, { redact?: boolean })`** — capture an agent run's full state as a portable JSON trace for external sharing. Bundles `snapshot`, `narrativeEntries`, `narrative`, and `spec` into a `AgentfootprintTrace` shape with `schemaVersion: 1`. Default `redact: true` requests `getSnapshot({ redact: true })` from the runner so footprintjs's [4.14.0 redacted-mirror](https://github.com/footprintjs/footPrint/blob/main/docs/internals/adr-002-redacted-mirror.md) feature scrubs `sharedState`. Use this to ship traces to a viewer, support engineer, or audit log without leaking PII.
- **`AgentfootprintTrace` + `ExportTraceOptions` types** exported from the main entry. Pin consumers to `schemaVersion: 1`; future shape changes will bump the version.
- **Example** `examples/observability/29-export-trace.ts` — captures and prints a trace using the `mock` adapter.
- **10 new tests** (5 patterns) covering schema version, snapshot pass-through, missing-method graceful degradation, JSON round-trip, and the safe-by-default `redact: true` choice.

### Changed

- **`footprintjs` peer dep + devDep bumped to `^4.14.0`** — required for the redacted-mirror `getSnapshot({ redact })` API. `exportTrace` falls back to a 0-arg `getSnapshot()` if the runner predates 4.14, so older deployments still produce a (raw) trace.

## [1.9.0]

### Added

- **`agentfootprint/patterns` — canonical composition patterns as thin factories.** Each pattern composes existing concepts (FlowChart / Parallel / Conditional / Agent / LLMCall) and returns a standard Runner — no new primitives, no new classes. Source files are short and teach the composition pattern.
  - `planExecute({ planner, executor })` — sequential planning → execution (FlowChart of 2).
  - `mapReduce({ provider, mappers, reduce })` — N pre-bound mappers fanned out, then reduced via LLM or pure fn (Parallel with named merge).
  - `treeOfThoughts({ provider, branches, thinker, judge })` — N parallel thinkers, judge picks the best (FlowChart of Parallel → judge).
  - `reflexion({ solver, critic, improver })` — single-pass Solve → Critique → Improve (FlowChart of 3). Multi-iteration variants compose with `Conditional`.
- **Example**: `examples/orchestration/28-patterns.ts` — all four patterns + a composed `Conditional` routing between them, all using the `mock` adapter.
- **10 new tests** covering wiring, input propagation, argument validation, and patterns-inside-patterns composition.

## [1.8.0]

### Added

- **`Conditional` concept — the DAG branch primitive.** Thin wrapper over footprintjs `addDeciderFunction` + `addFunctionBranch` that routes between runners based on synchronous predicates. First-match-wins; failing predicate fail-opens to the next branch; `.otherwise(runner)` is required. Exposes the same Runner surface as other concepts (`run`, `getNarrative`, `getSnapshot`, `getSpec`, `toFlowChart`) and composes inside `FlowChart` / `Parallel` / `Agent.route()` / another `Conditional`.

  ```ts
  const triage = Conditional.create({ name: 'triage' })
    .when((input) => /refund/i.test(input), refundAgent, { id: 'refund' })
    .when((input) => input.length > 500, ragRunner)
    .otherwise(generalAgent)
    .build();

  await triage.run('I want a refund');
  // narrative: "[triage] Chose refund — predicate 0 matched"
  ```

  Completes the DAG primitive set: **leaf** (LLMCall/RAG), **cycle** (Agent), **sequence** (FlowChart), **fan-out** (Parallel), **branch** (Conditional), **dispatch** (Swarm). Users can now build any composition from existing concepts without dropping to raw footprintjs.

- **Guards on `Conditional.when()`** — rejects non-function predicates, non-runner values, reserved `'default'` id, branch IDs with `/` or whitespace (would break `runtimeStageId`), and duplicate IDs. Fail-open on throwing predicates (never blocks a valid branch). Frozen state snapshot passed to predicate — mutation attempts silently no-op.
- **Example**: `examples/orchestration/27-conditional-triage.ts` — deterministic triage demo using the `mock` adapter.
- **25 new tests** across 5 patterns (unit/boundary/scenario/property/security), including real Agent composition and nested Conditionals.

## [1.7.1]

### Fixed

- **CI + npm publish** — `devDependencies.footprintjs` was pinned to `file:../footPrint`, which doesn't resolve in CI. Switched to `^4.13.0` so CI installs from the registry. `footprintjs` is also now declared as a `peerDependency` (`>=4.13.0`) to make the install-time contract explicit. This is why v1.7.0 failed to publish.

## [1.7.0]

### Added

- **Emit-channel LLM diagnostics.** `CallLLM` stage (both streaming and non-streaming) now fires `scope.$emit('agentfootprint.llm.request', {...})` before the provider call and `scope.$emit('agentfootprint.llm.response', {...})` after, surfacing the exact shape being sent/received. Payloads include iteration, message roles, tool names + required fields, usage, stop reason, and tool-call signatures.
- **`agentRenderer.renderEmit`** — custom narrative rendering for `agentfootprint.llm.request`/`response` events. Output like `LLM request (iter 2): 5 msgs [system,user,assistant,tool,tool], 4 tools — calculator required:[expression]` appears inline under each `CallLLM` stage in combined narratives.
- **`AgentBuilder.maxIdenticalFailures(n)`** — threshold for repeated-identical-failure escalation. When a tool call with the exact same `(name, args)` has failed `n` times in a row, a one-shot `escalation` field is injected into that tool result content urging the LLM to change arguments, switch tools, or finalize. Fires exactly once per `(name, args)` key per conversation. Defaults to `3`. Pass `0` to disable. Uses strict JSON parsing (not substring sniffing) so legitimate prose containing `"error":true` is not misclassified; stable key-sorted stringify so equivalent arg objects match regardless of insertion order.
- **`scope.maxIterationsReached` signal** — when the agent loop hits `maxIterations`, the structural guard now sets this flag AND force-routes to the default branch. Any terminal stage (default `Finalize`, `Swarm.RouteSpecialist` fallback, user-supplied terminals) can detect forced termination and synthesize an appropriate final message. Finalize now emits a user-facing fallback when the flag is set.
- **Tool-call signatures in narrative.** `ParseResponse` now renders `responseType` as `tool_calls: [calculator({"expression":"4+5"}), web_search({"query":"weather"})]` — names plus JSON-stringified args (tight cap) so debuggers see at a glance whether the LLM passed required fields. Names alone hid the common failure mode of retrying with empty / wrong args.

### Fixed

- **Anthropic streaming adapters dropped tool arguments.** `BrowserAnthropicAdapter.chatStream()` and `AnthropicAdapter.chatStream()` yielded `tool_call` chunks with `arguments: {}` at `content_block_start`, then accumulated `input_json_delta` chunks into a buffer that was never consumed. The streaming stage pushed the empty-args version, causing LLMs to re-attempt calls with `{}` until `maxIterations` exhausted. Fixed by deferring the `tool_call` yield until args are complete — emit at `content_block_stop` with parsed JSON (browser) / after `stream.finalMessage()` (Node SDK). Combined with the new emit-channel diagnostics, this bug was diagnosable for the first time.

### Changed

- **Requires `footprintjs` >= 4.13.0** for emit-channel features. Install explicitly: `npm install footprintjs@^4.13.0 agentfootprint@^1.7.0`.

## [1.6.1]

### Fixed

- **CI + publish workflows** — `npm install` instead of `npm ci`, no npm cache (lockfile not committed due to platform-specific native deps). This is why v1.5.0 and v1.6.0 failed to publish to npm.
- **footprintjs devDep** bumped to `^4.12.2` (resume continuation fix).

## [1.6.0]

### Added

- **`examples/` directory** — 22 type-checked examples as single source of truth (was in separate agent-samples repo). 8 categories: basics, providers, orchestration, observability, security, resilience, memory, integration.
- **`test:examples` npm script** — type-checks all examples against library source.
- **Barrel exports** — `agentLoop`, `AgentLoopConfig`, `defineInstruction`, `AgentPattern`, `quickBind`, `AgentInstruction`, `InstructedToolDefinition`, `TokenRecorder`, `ToolUsageRecorder`, `TurnRecorder`, `CostRecorder` from main entry. `staticTools`, `noTools` from `/providers`. `ExplainRecorder` from `/observe`.
- **3 new examples** — agent-loop (low-level engine), instructions (conditional context injection), explain-recorder (grounding evidence).

### Changed

- **`ToolHandler` type** — `(input: any)` instead of `(input: Record<string, unknown>)`. Allows typed destructured params in tool handlers: `({ query }: { query: string }) =>`. Non-breaking.
- **`footprintjs` peer dep** — bumped to `>=4.12.0` (backtracking, quality trace, staged optimization).

### Fixed

- **4 pre-existing type errors** in examples (API drift from agent-samples): resilience callbacks, ToolDefinition.name→id, message strategy args, instruction type casts.

## [1.5.0] - 2026-04-09

### Added

- **`runtimeStageId`** — mandatory on `LLMCallEvent` and `ToolCallEvent`. The universal key linking recorder data to execution tree nodes and commit log entries. Format: `[subflowPath/]stageId#executionIndex`.
- **Map-based recorders** — `TokenRecorder`, `ToolUsageRecorder`, `CostRecorder` extend `KeyedRecorder<T>` from `footprintjs/trace`. O(1) lookup via `getByKey(runtimeStageId)`, `getMap()`. Zero fallback keys.
- **`EvalIteration.runtimeStageId`** — each iteration links to its execution step
- **`createLLMCaptureRecorder()`** — shared factory for run() and resume() LLM capture. Both paths now track `runtimeStageId` for stream bridge tool events.
- **`RecorderBridge.setToolRuntimeStageId()`** — encapsulated state tracking (was public mutable field)
- 5 new tests for runtimeStageId on all recorder types

### Changed

- **footprintjs >=4.7.0 required** — added to `dependencies` (was only in devDependencies)
- **`agentLoop.ts`** — uses `buildRuntimeStageId` + `createExecutionCounter` from `footprintjs/trace`
- **`LLMCallRunner` + `RAGRunner`** — use `findCommit` from `footprintjs/trace` (zero `(b: any)` casts)
- CLAUDE.md + AGENTS.md — documented `runtimeStageId`, `KeyedRecorder`, `getByKey()` pattern

### Removed

- All `__auto_` fallback keys — runtimeStageId is always provided
- Duplicate LLM capture code in resume() path — replaced by shared factory

## [1.4.2] - 2026-04-07

### Fixed

- **README rewrite** — Architecture moved to 3rd section, headers renamed to relatable terms (Conditional Behavior, Observability, Human-in-the-Loop), 4 broken import paths fixed, redundant sections folded, 380→280 lines
- **5 folder READMEs** — concepts, adapters, providers, memory, tools with relatable naming and code examples
- **recorders/README.md** — 5 categories, event→recorder mapping, design principles
- **What's Different section** — 10 unique features grouped by concern (Quality/Safety/UX/Debugging)

## [1.4.1] - 2026-04-07

### Fixed

- **`RecorderBridge.loopIteration`** — now increments after each `dispatchLLMCall` (was always 0)
- **Per-iteration context** — each LLM call gets its own context snapshot (was sharing last state for all)
- **`resume()` path** — captures context same as `run()` (was empty)
- **`ExplainRecorder`** — guards `iteration: -1` when `onTurnComplete` fires without `onLLMCall`
- **Format gate** — release script fails on unformatted files instead of silently fixing

### Added

- **5 folder READMEs** — concepts, adapters, providers, memory, tools — with relatable naming (Single LLM / Multi-Agent), code examples, and cross-references
- **Main README** — 5-layer architecture diagram (Build → Compose → Evaluate → Monitor → Infrastructure), updated Recorders section with 5 categories
- **recorders/README.md** — event → recorder mapping, design principles
- **5 tests** for `EvalIteration`, per-iteration context, flat/iteration consistency
- **Flattened `recorders/v2/`** → `recorders/` — removed unnecessary indirection

### Changed

- `CLAUDE.md` + `AGENTS.md` — updated directory tree descriptions

## [1.4.0] - 2026-04-07

### Added

- **`explain().iterations`** — per-iteration evaluation units with connected data. Each iteration captures context (what the LLM had), decisions (tools chosen), sources (results), and claim (LLM output). Evaluators walk iterations to check faithfulness, relevance, and hallucination.
- **`EvalIteration` type** — self-contained evaluation unit for each loop iteration

## [1.3.0] - 2026-04-07

### Added

- **`explain().context`** — ExplainRecorder captures evaluation context during traversal: input, systemPrompt, availableTools, messages, model
- **`LLMContext` type** — what the LLM had when making decisions
- **`LLMCallEvent.systemPrompt`/`toolDescriptions`/`messages`** — context fields on events (optional, backward-compatible)

## [1.2.0] - 2026-04-07

### Added

- **`obs.explain()`** — ExplainRecorder bundled into `agentObservability()` preset. Grounding analysis (sources vs claims) out of the box — the differentiator.
- **8-gate release script** — mirrors footprintjs: doc check, dup type check, build, tests, sample projects, CHANGELOG validation
- **`scripts/check-docs.sh`** — blocks release if docs reference removed APIs
- **`scripts/check-dup-types.mjs`** — blocks release if duplicate type definitions found across src/

### Fixed

- **ModelPricing duplicate** — CostRecorder now imports from `models/types` instead of redefining

## [1.1.0] - 2026-04-07

### Added

- **Message strategies in providers barrel** — `slidingWindow`, `charBudget`, `fullHistory`, `withToolPairSafety`, `summaryStrategy`, `compositeMessages`, `persistentHistory` now exported from `agentfootprint/providers`
- **Error utilities in resilience barrel** — `classifyStatusCode`, `wrapSDKError` now exported from `agentfootprint/resilience`

### Removed

- **`getGroundingSources`, `getLLMClaims`, `getFullLLMContext`** from `agentfootprint/explain` — post-processed narrative entries (anti-pattern). Use `ExplainRecorder` instead, which collects during traversal.
- **`slidingWindow`, `truncateToCharBudget`** from internal `memory/conversationHelpers` — dead code duplicating the public `MessageStrategy` API in `providers/messages/`

## [1.0.0] - 2026-04-06

### Added

- **Capability-based subpath exports** — 7 focused import paths, tree-shakeable:
  - `agentfootprint/providers` — LLM providers, adapters, prompt/tool strategies
  - `agentfootprint/instructions` — defineInstruction, AgentPattern, InstructionRecorder
  - `agentfootprint/observe` — all 9 recorders + agentObservability preset
  - `agentfootprint/resilience` — withRetry, withFallback, resilientProvider
  - `agentfootprint/security` — gatedTools, PermissionPolicy
  - `agentfootprint/explain` — grounding helpers, narrative renderer
  - `agentfootprint/stream` — AgentStreamEvent, SSEFormatter
- **Full backward compatibility** — `import { everything } from 'agentfootprint'` still works
- **`typesVersions`** in package.json for older TypeScript resolution

### Changed

- `index.ts` reorganized with comments pointing to capability subpaths
- PermissionRecorder canonical home is `agentfootprint/observe` (removed from security barrel)

## [0.6.2] - 2026-04-05

### Added

- **Instructions guide** — `docs/guides/instructions.md` (Decision Scope, 3-position injection, decide())
- **Streaming guide** — `docs/guides/streaming.md` (AgentStreamEvent, onEvent, SSE, event timeline)
- **Sample 17** — Instructions (defineInstruction, decide, conditional activation, tool injection)
- **Sample 18** — Streaming events (lifecycle, tool events, ordering, backward compat, SSE)
- **Module READMEs** — `src/lib/instructions/`, `src/streaming/`, `src/lib/narrative/`
- **CLAUDE.md + AGENTS.md** — Instructions, Streaming, Grounding sections + anti-patterns
- **README.md** — Instructions, Streaming, Grounding Analysis sections
- **JSDoc** — `@example` on `getGroundingSources()`, `getLLMClaims()`

## [0.6.1] - 2026-04-05

### Added

- **AgentStreamEvent** — 9-event discriminated union for real-time agent lifecycle
  - `turn_start`, `llm_start`, `thinking`, `token`, `llm_end`, `tool_start`, `tool_end`, `turn_end`, `error`
  - `onEvent` callback on `agent.run()` — full lifecycle visibility for CLI/web/mobile consumers
  - Works in both streaming and non-streaming mode (only `token` requires `.streaming(true)`)
  - `turn_end` emits `paused: true` on ask_human pause
- **Backward compat** — `onToken` still works (deprecated, sugar for `onEvent` token filter)
- **Collision guard** — `onEvent` + `onToken` together: `onToken` ignored + dev-mode warn
- **Error isolation** — `onEvent` handler errors swallowed (never crash agent pipeline)

### Fixed

- `streamingCallLLMStage` fallback path now passes `signal` for cancellation
- `tool_end.latencyMs` excludes instruction processing overhead

## [0.6.0] - 2026-04-05

### Added

- **Instruction Architecture** — `AgentInstruction`, `defineInstruction()`, `InstructionsToLLM` subflow
  - 3-position injection: system prompt, tools, tool-result recency window
  - `activeWhen(decision)` — state-driven conditional instruction activation
  - `decide()` field on `LLMInstruction` — tool results update Decision Scope
  - `AgentScopeKey` enum — type-safe scope key references
- **Agent builder API** — `.instruction()`, `.instructions()`, `.decision()`, `.verbose()`
- **Grounding helpers** — `getGroundingSources()`, `getLLMClaims()`, `getFullLLMContext()`
- **Verbose narrative** — `createAgentRenderer({ verbose: true })` shows full values
- **Dynamic ReAct + Instructions** — `AgentPattern.Dynamic` loops back to `InstructionsToLLM`

### Fixed

- Tool names duplication in Dynamic mode (uses `ArrayMergeMode.Replace`)
- `toolProvider` wired through `buildConfig` for execution
- AssemblePrompt replaces system message in Dynamic mode
- Browser compat (`process.env` guarded)
- Registry mutation moved to constructor (runs once)
- Pausable root stage (no post-build graph mutation)
- Streaming stage typed as `TypedScope<AgentLoopState>`

### Changed

- Peer dependency: `footprintjs >= 4.4.1` (was `>= 4.0.0`)
- Eliminated `ApplyPreparedMessages` and `ApplyResolvedTools` copy stages

## [0.3.0] - 2026-03-29

### Fixed

- `setEnableNarrative()` removed from FlowChartBuilder chain — call `executor.enableNarrative()` instead (footprintjs v3.x API)
- Stage functions in LLMCall, Agent, RAG, FlowChart now receive a plain `ScopeFacade` via `agentScopeFactory`, bypassing TypedScope proxy (required for `getValue`/`setValue` access)

### Changed

- Peer dependency: `footprintjs >= 3.0.0` (was `>= 0.10.0`)

## [0.2.0] - 2026-03-17

### Added

- **Browser LLM adapters**: `BrowserAnthropicAdapter` and `BrowserOpenAIAdapter` — fetch-based, zero peer dependencies
  - Direct browser-to-API calls using user's own API key
  - Full chat() + chatStream() with SSE streaming via ReadableStream
  - Tool call support, AbortSignal, custom baseURL for compatible APIs
  - Anthropic CORS via `anthropic-dangerous-direct-browser-access` header
  - OpenAI `stream_options.include_usage` for streaming token counts
- 18 browser adapter tests

### Removed

- Legacy v1 recorders: LLMRecorder, CostRecorder, RAGRecorder, MultiAgentRecorder (no users yet, replaced by v2 AgentRecorder interface)

## [0.1.0] - 2026-03-15

### Added

- **Concept ladder**: LLMCall, Agent, RAG, FlowChart, Swarm — each builds on the previous
- **LLM Adapters**: AnthropicAdapter, OpenAIAdapter, BedrockAdapter with full chat + streaming
- **Provider bridge**: `createProvider()` connects config factories (`anthropic()`, `openai()`, `ollama()`, `bedrock()`) to adapter instances
- **Mock adapter**: `mock()` for $0 deterministic testing — same code path as production
- **Multi-modal content**: Base64 and URL image support across all adapters
- **Error normalization**: `LLMError` with 9 error codes, `retryable` flag, `wrapSDKError()` auto-classifier
- **Compositions**: `withRetry()`, `withFallback()`, `CircuitBreaker` for resilient agent execution
- **V2 Recorders**: TokenRecorder, TurnRecorder, ToolUsageRecorder, QualityRecorder, GuardrailRecorder, CostRecorderV2, CompositeRecorder
- **V1 Recorders**: LLMRecorder, CostRecorder, RAGRecorder, MultiAgentRecorder _(removed in 0.2.0)_
- **Protocol adapters**: `mcpToolProvider()` for MCP, `a2aRunner()` for A2A
- **Prompt providers**: staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt
- **Tool providers**: agentAsTool, compositeTools, ToolRegistry, defineTool
- **Memory management**: slidingWindow, truncateToCharBudget, appendMessage
- **Streaming**: StreamEmitter, SSEFormatter
- **Agent loop**: Low-level `agentLoop()` for custom control flow
- **16 sample tests** covering every feature
- **608 tests** across 63 test files
