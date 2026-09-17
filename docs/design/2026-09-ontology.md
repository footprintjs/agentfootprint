# The ontology — a declared map of what exists and where, never a way to fetch it

Status: SHIPPED in 9.106.0 (2026-09-17). Door `agentfootprint/ontology`;
`src/ontology/`; builder `.ontology(map)`.

## The ruling (2026-09-17)

The owner: "An ontology is like a map: it does NOT provide a way to get
data; it just tells and reasons about each node and how to reach a node.
The model can understand that if there is no data it can tell: if you get
data for this node, or this other node, it can help further."

So: declared, read-only, no execution through it, no inference by the
library, served as data.

## What it closes

The field report this library exists for records a model concluding it
could not help while the data it needed sat one source over. The context
contract (`src/lib/context-contract`) already gives the outer JSON a
vocabulary — `domainDefinitions`, `limitations`, `evidenceRefs`,
`nextSteps` — and `resolveEvidenceNeed` already answers "where could THIS
named need be resolved" for one need at a time, opt-in, in code. What was
missing is the standing map the model can reason over on every call: what
each term IS, how terms RELATE, which SOURCE holds a term and how much of
it, which registered TOOL reads it from there. Without it the model has
nothing to say about where a need would be met; with it, the "next step"
grammar of the contract is filled from data the application declared, not
from a guess.

## The laws

- **Declared at build.** `defineOntology(spec)` validates (ids
  identifier-safe; every edge end a node; every `source` a declared source;
  texts non-empty and bounded; no repeated alias, `via`, holding or edge;
  counts under `ONTOLOGY_LIMITS`), detaches, deep-freezes and fingerprints
  (`ontologyHash`: SHA-256 over the receipt's `stableJson` of the five
  declared fields — key-order independent; edge order is part of the
  identity). The `via` tool names are checked at `Agent` build against
  `registryByName` — the static registry, the framework's doors, every
  skill's tools — and a name no registry carries is refused, naming the
  ontology, the tool, the node and the source. Provider-served tools are
  only met at dispatch and cannot be named.
- **On the record as ONE committed key.** `seed` writes
  `AgentState.ontology = { id, version, hash, spec }` once per run (the
  `findingsServe` run-constant precedent). No stage writes it again. There
  is no runtime `$ontology()` — a value would ride it past every redaction
  point.
- **Served as ONE request-only system piece by a pure function.**
  `ontologyPiece(spec)`: a constant header quoting the contract's
  `domainDefinitions`, `limitations` and `evidenceRefs` meanings (one
  owner), then `nodes:`, `sources:`, `held by:`, `relations:`, `known, not
  held here:` — every line the declaration's, nodes and sources sorted by
  id, edges in declaration order, 64 lines per section with the overflow
  stated, an empty section omitted. No call number, no clock: an unchanged
  map serves unchanged bytes and reuses the cached system prefix. Joined by
  `callLLM` AFTER the recovery piece and BEFORE the findings piece
  (injections → recovery → ontology → findings, FIXED), never pushed into
  `systemPromptInjections` (the evidence-gate law). Loaded through
  `import()` under the arm (the `judgeLanded` precedent).
- **Hashed per receipt, rebuilt byte-equal.** `servedView.viewOf` reads the
  run constant with `readRunConstant` and composes the same piece in the
  same slot, so the conformance law holds at every epoch in both chart
  shapes (the grouped chart crosses the key into `sf-llm-call` under
  `hasOntology`, value-conditionally).
- **The library never decides that a node "has no data".** A node with no
  declared source is served as `known, not held here` — what the
  declaration says. Absence is the model's or the tool's to report; the map
  only lets the model SAY where a need would be met (the source, the tool,
  the neighbouring node).
- **The ask is an always-on instruction.** `ONTOLOGY_INSTRUCTION`
  (registered under `ONTOLOGY_INSTRUCTION_ID`, the `outputSchema()` /
  `.findings()` twin), ≤ 6 lines, judged by `unprovable`: name the source,
  tool or neighbouring node the map names for an unmet need — as a
  proposal, never a claim that data exists there; never invent a value from
  the map; report a node nobody holds as declared.
- **Byte-identical without it.** No key, no piece, no instruction, no
  event, no bridge; every read gated on the arm. The 19 byte-identity
  references are untouched; ONE new reference `agent-ontology` was
  generated alone.

## What it is not

Not a tool, not a fetch path, not an inference engine, not an answer
validator. It does not check that a source exists, is connected or holds
what its coverage sentence says. Register a map only from trusted
configuration; source prose and model output must not install one.

## The event

`agentfootprint.ontology.served { iteration, id, version, hash, nodes,
sources, edges }` — once per call that served the piece; identities and
numbers only, never a meaning, a coverage sentence or a node name. A new
domain (`ontology`, 26 → 27; 118 → 119 events), with its wildcard.

## What the bench measures — on the first host, after the release

Not here: this packet ships the mechanism and its byte-level proofs (the
record, the wire, the rebuild, the receipt, the twins). The measurement is
a real-model run on the first host, over questions whose data is NOT
collected by any registered tool:

| measure | read off | what a good number looks like |
|---|---|---|
| tool calls before the honest answer | `llm_start` count per question, armed vs unarmed twin | fewer under the map (the model stops probing sources the map says do not hold the term) |
| the answer names the source | the final answer text against the map's `held by:` / `known, not held here:` lines | the named source or neighbouring node is one the declaration holds, never one it does not |
| invented values | `unsupported-argument` / `unsupported-claim` findings per question | zero from the map (a meaning or coverage sentence is never quoted as an observation) |
| bytes | `receipt.requestMeasurement` system size, armed vs unarmed | the piece's size, once per call, cached after the first |

The bench's harness is `bench/` on the host's own chatbot; the conditions
are the unarmed twin, the map, and the map with `.findings()`. What the
mechanism cannot decide — whether a model READS the map rather than probing
anyway — is exactly what that run is for.

## Open

- A `configured: false` source is served as declared; nothing withholds the
  tools that read it. The map states, the tools answer.
- Aliases are served, not resolved: a question using an alias is the
  model's to map to the node. The library matches nothing.
- The Lens: the record carries the whole spec, so a `Served` tab can draw
  the map from `AgentState.ontology` with no library call; not this packet.
