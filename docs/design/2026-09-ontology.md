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

## Measured — the first host, 2026-09-17 (agentfootprint 9.106.0 · lens 0.64.0)

The host's chatbot (Sonnet 5 through the host's own `/invoke` door, one fresh
session per question, the host's own skills and seed stores) declared a map
read out of its sidecar's coverage sentences: 44 terms · 20 sources · 47
relations · 60 holdings; the served piece is 20,582 characters, joined after
the app's system prompt on every model call. Eight questions whose data no
registered tool collects, or whose answer turns on a declared gap. Two arms:
the map declared (`on`) and the same build with the `.ontology(...)` line
removed (`off`). Numbers read off each turn's record (`history` tool calls,
`totalInputTokens`, `totalOutputTokens`) and the door's wall clock.

| question | arm | tool calls | input tokens | output tokens | ms | the answer names the source or the declared gap |
|---|---|---|---|---|---|---|
| vmkernel log for an ESXi host | off | 1 | 41,564 | 858 | 26,023 | yes ("not collected", a list of what is) |
| | on | 0 | 14,867 | 440 | 13,386 | yes ("known but not held here") |
| change record for a switch port | off | 0 | 8,368 | 753 | 21,258 | yes |
| | on | 0 | 14,880 | 503 | 15,332 | yes |
| network path VM → array | off | 5 | 152,467 | 1,322 | 31,621 | traced the FC path (5 tools) |
| | on | 0 | 14,862 | 677 | 16,606 | read the map's `network_path` (the Ethernet path) as the question, said it is not collected, offered the FC trace — **a regression, see below** |
| AIX HBA tuning attributes | off | 0 | 17,382 | 1,518 | 36,819 | no — "OS-level parameters", no source named |
| | on | 0 | 30,407 | 1,281 | 32,578 | yes — the AIX ODM, the HMC API does not expose it |
| UCS blade under Intersight | off | 0 | 8,372 | 389 | 11,761 | **wrong** — "no access to UCS or Intersight data" (UCS Manager IS collected) |
| | on | 0 | 14,884 | 729 | 17,281 | yes — Intersight `configured: no`, UCS Manager read, what a blade's absence would mean |
| last restore of a VM | off | 2 | 53,228 | 603 | 16,660 | answered about backups, not restores |
| | on | 1 | 43,426 | 659 | 19,659 | yes — `restore_result` known, not held; offered the backup copies |
| Cohesity protection, uncollected cluster | off | 2 | 53,456 | 589 | 17,502 | yes (the tool's own coverage sentence) |
| | on | 2 | 72,908 | 626 | 18,598 | yes (the same sentence, quoted from the map) |
| IO profile of an idle port | off | 3 | 46,661 | 734 | 19,311 | same answer both arms |
| | on | 3 | 66,113 | 654 | 18,879 | same answer both arms |
| **total** | off | 13 | 381,498 | 6,766 | 180,955 | 6 / 8 |
| | on | 6 | 272,347 | 5,569 | 152,319 | 8 / 8 named (one of them the regression) |

What the run says:

- **The map is read.** Seven of eight `on` answers quote a meaning, a coverage
  sentence or the `known, not held here` line; two of the eight `off` answers
  could not name the source at all, and one was wrong about what IS collected.
- **Fewer probes on questions with no data.** Tool calls 13 → 6; input tokens
  −29 % over the eight, although the piece costs ~6,500 input tokens on every
  call (a single-call turn is 8.4k tokens unarmed, 14.9k armed). The saving is
  the tool calls the model no longer spends on sources the map says do not
  hold the term; on a question that DOES need tools the map is pure cost
  (the Cohesity and IO-profile rows: same calls, +20k tokens).
- **The regression is the declaration's, not the mechanism's.** The host's
  `network_path` node means the Ethernet path between an SMB client and a NAS
  server (the sidecar's own sentence); the model matched the question's words
  to the node id and answered about that term instead of tracing the FC path
  the unarmed twin traced. A node id that reads like a common phrase captures
  questions it was not meant for — the fix is in the map (a narrower id such
  as `smb_network_path`, or aliases that name what the term is NOT), pinned
  by the host's own test, not in the library.
- **The model names the map.** Five of eight `on` answers say "the ontology"
  or "the domain model" to the person. The instruction asks the model to use
  the map, not to cite it. → 9.107.0 ships `ONTOLOGY_INSTRUCTION` v2 (below).

## 9.107.0 — the ask is a named value; the wording is the map's whole use

The owner's question (2026-09-17 eve): is the "no data" behaviour a skill
that is on only when a map is declared, or should the application enable it
itself — and, thinking as the library, a map is a reference the model can
use in many ways, not only when data is missing. The ruling, for the
library:

- The map is data and is served whenever declared (a declared map with no
  reader is nothing; omit-never-deny says nothing is withheld from a model
  that has it). There is no separate skill and no skill-graph routing: the
  gap shows up inside any skill, so the map has to be in front of the model
  in all of them.
- What the model is asked to DO with the map is a separate, named thing —
  `OntologyAsk`, `'use-the-map' | 'none'`, the findings ledger's `answerAsk`
  grammar. `'use-the-map'` is the default and the measured condition;
  `'none'` serves the same piece and registers no ask of the library's, for
  an application that writes its own through `.instruction()`. The record
  shows which ran.
- `ONTOLOGY_INSTRUCTION` v2 describes the map's whole use, not the "no data"
  moment: read the question in the map's terms and aliases; where a term is
  held, the tool named beside it is where to look; a relation is the way from
  a term already held to the term needed; an unmet need is answered with the
  source, tool or neighbouring term the map declares, as a proposal; never a
  value off a definition; and — the line the measured run asked for — speak
  to the person of sources, tools and terms, never of the map.

Measured after the release on the same host, the same eight questions,
one fresh session each, map on, `ask: 'use-the-map'` (v2), 2026-09-17 late:

| question | tool calls | input tokens | output tokens | ms | names the source or gap | says "the ontology" to the person |
|---|---|---|---|---|---|---|
| vmkernel log | 0 | 15,001 | 465 | 12,936 | yes | yes |
| change record | 0 | 15,014 | 442 | 13,154 | yes | no |
| network path VM → array (after the `smb_client_network_path` rename) | traced the FC path | no record returned (see below) | | 134,130 | — | no |
| AIX HBA tuning | 0 | 30,684 | 1,396 | 37,605 | yes (the ODM, the HMC) | no |
| UCS blade under Intersight | 0 | 15,018 | 768 | 23,302 | yes | yes |
| last restore | 2 | 73,701 | 758 | 26,136 | yes | yes |
| Cohesity, uncollected cluster | 2 | 73,817 | 639 | 18,667 | yes | no |
| IO profile, idle port | 3 | 91,977 | 782 | 27,846 | same as unarmed | no |

- **The map-citing fell from 5 of 8 to 3 of 8, not to zero.** The three
  that remain all open with "The ontology declares …" and then say the
  right thing (the term is known and held nowhere here; the source is not
  configured). The word is in the piece's own header, so the model has it
  in front of it on every call; the last line of v2 asks it not to repeat
  it and Sonnet 5 follows that five times in eight. A further iteration
  would move the "speak of sources" line to the front of the instruction,
  or reword the served header — each is one more bench run, the owner's
  call.
- **Source naming held at 7 of 7 recorded answers**, the same answers as
  v1 in substance; the network-path question now traces the FC path (four
  tools, 144,220 input tokens, 32 s when re-asked once for the record).
- **One turn returned an answer and no recording ticket.** The first ask
  of the network-path question ran 134 s, answered with a traced path, and
  the reply carried no `reasoning.ref`; the host's log for that turn holds
  the library's own warning that the answer stated five identifiers no tool
  result of the run carried (`shcsanplvsw901/fc1/6`, `stor-array05`,
  `ct0-fc2` …) and the host's system-prompt slot over its 24k budget
  (25,430 chars, twelve fragments — the app's prompt, not the map, which
  is joined after the slot). Re-asked, the same question completed in 32 s
  with a record and no such warning. The recordings dial mints on a
  COMPLETED run; whether a run that ends through the answer-validation
  path counts as completed is the open question this turn raises — not
  chased tonight, recorded here.

Raw v2 records: the host's `docs/measurements/2026-09-17-ontology-nodata-v2-on.json`.

## 9.108.0 — the map meets the skills

The owner's question (2026-09-17 late): when there is no data, does the
model look into the topology to find the relation — the skill graph, the
skills and the tools are mapped; is the map linked to them, and how? Read
against the record: the map named the TOOL that reads a term
(`via vm_backup_status`), but on an agent with skills that tool is on the
wire only once its skill is read, and nothing the model was served said
which skill that is — the `read_skill` catalog lists ids and descriptions,
not tools, and a call to a tool not yet on the wire is answered with the
roster of names, not with the skill. So the model guessed the skill from
its description (usually right), or stopped and asked the person (the
replayed restore turn: zero calls, "would you like me to check the backup
run?").

The join, from declared facts only: at build the agent reads the
registry's `toolDeclaringSkills` for every `via` name and writes
`AgentState.ontology.tools` (tool → skill ids); the piece prints
`via vm_backup_status [skill: backup-check]`; the instruction (v3) says
that skill id is what `read_skill` takes. Under a role policy the same
hidden-skill law as every other sentence applies at compose time (never to
the record), and the served view rebuilds the same bytes from the record's
join and the epoch's hidden ids. Not built: any inference of relation
from tool names, any change to routing, any tool-call made by the library.

Measured on the host after the release: the table below — scored by
`scoreAbsence` (9.109.0), not by a regex: named the gap · named where ·
tool calls · unsupported values · map words, each off the record.

## Where this sits in the literature (read 2026-09-17, for the paper)

The owner asked how ontologies have been used with LLM agents in research,
so the design can be placed rather than claimed novel by omission. Read
against the ruling ("a map that does not provide a way to get data") the
2025–2026 work falls into four uses, and this packet is a fifth.

| use of the ontology | representative work | what the ontology holds | how it reaches the model | what it is for |
|---|---|---|---|---|
| constrain tool ARGUMENTS | *The Semantic Training Gap: Ontology-Grounded Tool Architectures for Industrial AI Agent Systems* (arXiv 2605.11234, 2026) — "unconstrained tool parameters produced a 43% hallucination rate for domain identifiers; ontology-grounded parameters reduced this to 0%" (Qwen3-32B, 72 invocations, 6 configurations) | definitions and relations (equipment ids, process parameters, failure codes), "a typed relational configuration" | a `resolve · contextualize · annotate` contract in the tool layer, at runtime | an identifier the model passes must be one the domain defines |
| constrain INPUTS and tool VISIBILITY | *Ontology-Constrained Neural Reasoning in Enterprise Agentic Systems* (arXiv 2604.00555, 2026) — role, domain and interaction ontologies; "ontology-coupled agents significantly outperform ungrounded agents on Metric Accuracy (p<.001)"; the gain grows where pretraining is thin ("inversely proportional to LLM training data coverage of the domain") | schema, metric ranges, role patterns, handoff edges — no instances | a prompt injector turns the symbols into prose under a token budget; domain hierarchies filter which tools the agent sees | the agent reasons and picks tools inside the declared domain; the paper's own note: "ontologies constrain inputs but not outputs" |
| make the ontology EXECUTABLE | *Ontology-to-tools compilation for executable semantic constraint enforcement in LLM agents* (arXiv 2602.03439, 2026) — "ontological specifications are compiled into executable tool interfaces that LLM-based agents must use to create and modify knowledge graph instances" | a schema that becomes the tools | the compiled tools ARE the door | invalid instances cannot be written; proof of principle, no numbers |
| GROUND answers in a graph that holds the data | ontology-grounded GraphRAG (clinical QA: "98% accuracy … hallucination rate falling from 63% and 48% down to 1.7%", J. Biomedical Informatics 2026); OG-RAG (+55% fact recall); the operational-ontology platforms, where the ontology "models every noun, relationship, rule, action, and permission, and then lets the agent operate on that governed layer, not on the raw data beneath it" | instances: objects, links, properties — the data itself | retrieval over the graph, typed queries, typed actions | the answer is read off a store the ontology types |

What none of them do — a research brief that catalogues 32 of these
papers (designpattern.fyi, "Research Brief: Ontologies for Agentic AI
(2025–2026)") reaches the same reading: "**No paper explicitly addresses**
declaring what the model cannot do or prompting abstention from
out-of-ontology questions"; the nearest is a 2026 ESWC workshop call for
"calibrated abstention for uncertain graph links", and a historical note
that KQML's message envelope carried an `:ontology` field that modern
agent protocols dropped.

Where this packet stands, in those terms:

- **The map holds no data and is not a door.** It is the fourth row's
  opposite: no instances, no retrieval over it, no action through it, and
  — unlike the third row — it compiles into nothing. The tools stay the
  application's own; the map only says which one reads which term from
  which source, and (9.108.0) which skill declares the tool.
- **What it constrains is the ANSWER's account of absence, not the
  inputs.** The first two rows constrain arguments and visibility; this
  packet leaves both alone (the `via` check at build is a lie-detector on
  the declaration, not a runtime constraint on the model) and instead puts
  a declared boundary in front of the model: the source's own coverage
  sentence, `configured: no`, and `known, not held here`. That is the
  fifth use — the one the brief found no paper for — and the measured run
  is its first number: the source or the declared gap named in 8 of 8
  armed answers against 6 of 8 unarmed, one of the unarmed answers wrong
  about what IS collected.
- **Every served line is the author's.** The grounding papers read
  definitions and instances into the prompt through a library's own
  prose or a retriever's ranking; here the piece quotes the declaration
  and the library writes one constant header. That is the family's
  sentence-basis law applied to an ontology, and it is what lets the
  receipt hash the piece and the served view rebuild it byte for byte.
- **The record, not the prompt, is the unit.** The declaration is a run
  constant on the record with its hash; the join to the skills is written
  from the registry's facts; a lens draws the map from the record with no
  library call. None of the surveyed systems put the ontology on a
  per-run, per-request-hashed record that a reader can travel.

Two honest limits the literature sharpens: the second row's finding that
grounding pays most where pretraining is thin suggests the map's value on
a public domain (VMware, Cisco MDS) is smaller than on a private one — the
first host's stores are private, its vocabulary is not; and the first
row's result (identifier hallucination 43% → 0%) is a constraint on
arguments this map does NOT impose, so a wrong identifier in a tool call
is still the findings ledger's and the answer validation's to catch, not
the map's.

Sources: [arXiv 2605.11234](https://arxiv.org/abs/2605.11234) ·
[arXiv 2604.00555](https://arxiv.org/html/2604.00555v2) ·
[arXiv 2602.03439](https://arxiv.org/abs/2602.03439) ·
[the research brief](https://www.designpattern.fyi/ontological-engineering/ontology-agentic-ai-research-brief/) ·
[an agent-ontology architecture read](https://zerofuturetech.substack.com/p/palantir-aip-agent-ontology-interaction) ·
[Don't Hallucinate, Abstain (ACL 2024)](https://aclanthology.org/2024.acl-long.786.pdf) — abstention without a declared map, the baseline the fifth use improves on.

Raw answers and per-turn numbers: the host keeps them beside its `.dev/`
bench (`nodata-ontology-{on,off}.json`); this table is the record of them.

## Open

- A `configured: false` source is served as declared; nothing withholds the
  tools that read it. The map states, the tools answer.
- Aliases are served, not resolved: a question using an alias is the
  model's to map to the node. The library matches nothing.
- The Lens: the record carries the whole spec, so a `Served` tab can draw
  the map from `AgentState.ontology` with no library call; not this packet.
