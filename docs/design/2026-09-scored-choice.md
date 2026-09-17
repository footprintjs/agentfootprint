# Scored choice — a distribution over declared candidates, on the record (2026-09-16)

Status: GATE OPENED 2026-09-17 — a provider that scores is in reach
(TypeSafe "System One", model `jev`; one real call, quoted below). Steps 1
and 2 landed in 9.104.0 as `agentfootprint/classify` + `classifierScorer`;
the judge on the findings ledger (`.findings({ judge })`) landed beside them
(docs/design/2026-09-findings-ledger.md § Judge). Step 4 — tool choice,
advisory rows and a bench-gated narrowing dial (`.toolChoice()`) — landed in
9.105.0 (§ Step 4 below). The lens bar (step 3) remains. Facts found while reading change this page, not a chat.

## The borrowed idea

Constrained decoding (the "Jev" page): for a field whose answers are a
finite set, do not generate the answer — score the candidates from one
hidden state and take the largest, with a probability per candidate. The
schema holds by construction and the decision comes with its evidence.

Our loop makes the same kind of choice several times a turn — which skill,
which route branch, which action tier — and today the model generates it
as text or a tool call. The evidence of the choice is the text. A scored
choice would put the distribution on the record instead.

## Facts (what exists — read before designing)

- **The scorer seam already exists, and is recorded.**
  `src/lib/injection-engine/entryScorer.ts`: `EntryScorer { name; score(input:
  EntryScorerInput, signal?) → EntryScoring }`, where `EntryScorerInput` is
  `{ userMessage, candidates: EntryCandidate[{ id, description }] }` and
  `EntryScoring` is `{ scorer, chosen, ranked: EntryScore[{ id, score,
  relevance }] }`. Plugged by `skillGraph().entryBy(scorer)`; the shipped
  scorers are deterministic (`keywordScorer`, the intent scorer). The
  scoring — scorer name, the chosen id, every candidate's score — is
  already what the "Why this skill?" panel reads. So a model-backed scorer
  is a STRATEGY on an existing seam, not a new record shape.
- **No provider exposes scores today.** `LLMResponse` carries `content`,
  `toolCalls`, `usage { input, output, cacheRead?, cacheWrite? }`; nothing
  in `src/adapters` or the shipped providers names log-probabilities.
- **The port already has an optional capability precedent.** `LLMProvider`
  is `{ name; carriesInMessages?; complete(req, hooks?); stream?(req,
  hooks?) }` — `stream?` is optional and absent on a provider that cannot.
  `scoreChoices?` follows that shape exactly.
- **The nearest gate.** The first host's BE names Azure (hosted, text only)
  and Ollama (local open weights). Ollama is where scores could first be
  reached; whether its API exposes them for the served model is the
  owner's check before step 1.
- **The gate is the provider.** A hosted API that returns only text cannot
  score; an OpenAI-compatible endpoint with `logprobs` can score one
  token per candidate when candidates are single tokens; open weights
  served locally (Qwen, per the Jev page) can score exactly as Jev does.
- `usage.cacheRead` IS recorded by the cache recorder
  (`src/cache/cacheRecorder.ts · cacheReadTokensTotal`) — a fact for the
  Served tab's reuse share, separate from this page.

## The cut (when the gate opens)

1. **Provider capability, optional.** `LLMProvider.scoreChoices?(input:
   { context: LLMRequest-shaped prefix; candidates: readonly string[] },
   signal?) → { scores: readonly { candidate; score; basis: 'logprob' |
   'hidden-state' }[] }`. Absent on a provider that cannot; never
   simulated by generating and parsing — that is the fallback the
   scorer names as such.
2. **The scorer.** `llmScorer(provider, { prompt })` implements
   `EntryScorer`: candidates → `scoreChoices`; `ranked` is the
   distribution; `scorer: 'llm-scored'`; when the provider has no
   `scoreChoices`, it returns `scorer: 'llm-scored:unavailable'` and
   defers to a deterministic scorer handed in as `fallback`. Both facts
   land on the record through `EntryScoring` unchanged.
3. **The lens.** Nothing new to record; the "Why this skill?" panel already
   prints `scorer` and the ranked scores. A bar per candidate is a
   rendering choice, made when the data exists.
4. **Route branches and action tiers** follow the same pattern only if a
   real run shows the skill case paying off. One seam first.

## Laws

- A score is data only when the provider produced it. The library never
  infers a probability from text.
- The candidates are declared before the call (the skill catalog, the
  branch names) — the same law as declared tags and declared routes.
- The chosen candidate and the whole distribution are recorded together;
  a panel that shows the winner without the runners-up is denying data
  it has.

## The gate, opened (2026-09-17)

The provider is not an LLM with log-probabilities; it is a classifier that
SCORES: `POST https://api.typesafe.ai/v1/systemone` with `{ model:
'jev-latest', state, questions }`, where a question is a `choice` over
declared options (`criteria: { option: description }`), a `noul` (a yes/no
as a probability) or a `score` (a rung on a declared scale). One real call
was made on 2026-09-17, the state a `{ proposition, predicts, tool, result }`
for a result the MODEL had declared `ruled-out`; the response, verbatim:

```json
{ "model": "jev-1.13.0",
  "answers": {
    "standing": { "type": "choice", "choice": "noise", "confidence": 0.59,
                  "probabilities": { "fact": 0.0, "noise": 0.69, "open": 0.3, "ruled-out": 0.01 } },
    "tests_proposition": { "type": "noul", "noul": 0.19 } },
  "usage": { "input_tokens": 494, "output_tokens": 68 } }
```

Errors: 401 bad key, 422 validation, 429 rate limit, 529 overloaded (backoff
on 429/529). Latency about 100–300 ms. The classifier disagreed with the
model — `noise` at 0.69 against the model's `ruled-out` — and gave 0.19 that
the result tests the proposition at all. That disagreement is the first
recorded fact of the second source, and it is resolved by nobody.

What this changed in the cut: step 1's "provider capability" is not
`LLMProvider.scoreChoices?` after all — a classifier is its own port
(`Classifier { name; classify(request, signal?) }`, `src/classify/types.ts`),
because the thing that scores is not the thing that generates and pretending
otherwise would put a `scoreChoices` on every text provider that cannot.
Step 2's scorer is `classifierScorer(classifier)` (9.104.0): one `choice`
question over the entry candidates (criteria = `{ id: description }`),
`ranked[].score` and `.relevance` BOTH the provider's probability as sent
(never renormalised — `rankEntries`'s softmax is not applied, there is no raw
score to soften), `chosen` the provider's own `choice` (never an argmax the
library took), `scorer: 'classifier:<model>'`. A provider failure is
`scorer: 'classifier:unavailable'` with an EMPTY ranking and no `chosen`; the
existing `pickEntry` stage leaves the cursor unset on an undefined `chosen`
and the cold-start entry pick takes over, so the "fallback scorer handed in"
of the original cut was not needed — the fallback already existed, reached
through an honest empty result rather than a throw. Step 3, the lens bar, is
unchanged: the panel already prints `scorer` and `ranked`; a bar per
candidate is a rendering choice.

## Step 4 — tool choice: the second reading beside the model's call (9.105.0)

The loop's most frequent choice is WHICH TOOL, and the model makes it by
generating a call. `.toolChoice({ classifier, serve })` asks the classifier
the same question at every model call — one `choice` question, id `tool`,
criteria = the offered tools by name with their own descriptions (the merged
wire MINUS the always-served doors), state = the user's message plus the
active skill id — and files the answer under `AgentState.toolChoices` as a
`ToolChoiceRow` BEFORE the call: `offered`, `ranked` (the distribution as
sent, highest first, an unscored tool absent), `chosen` (the provider's own
pick, absent when it named nothing offered), `confidence`, `usage`,
`latencyMs`, and `served` (what the slot committed) with `narrowed`. After
the reply `callLLM` files a `ToolChoiceOutcomeRow`: `called` in order,
`firstAgrees` (`chosen === called[0]`, absent when either is absent), and
`miss` (the names called outside a NARROWED served list). A failed call is a
`ToolChoiceErrorRow` (status, message, latency) and the full wire is served.

Two dials. **Advisory** (`serve: 'all'`, default): the wire is byte for byte
the unarmed twin's — every request equal, every receipt equal; the record
gains the rows and nothing else. **Narrowing** (`serve: { top: N }`): the
tools slot commits the top-N plus the doors (`read_skill`, `list_skills`,
`skip_step`, `present`, `alwaysServe`), in the merged wire's order, at the
ONE decoration site — so `dynamicToolSchemas`, the receipt's
`tools.schemaHashes` and `servedAt(k).tools.schemas` are the narrowed list
by construction, and no new `SERVED_GAPS` kind exists. The full wire is
served, with the reason on the row (`narrowedSkipped`), when the classifier
failed or scored fewer than N (`unavailable`), fewer than N + 1 candidates
were offered (`too-few`), the previous outcome carried a miss (`after-miss`)
or the call is the wrap-up (`wrap-up`).

What a miss is, in the code as found: `toolCalls.ts · resolveTool` does not
refuse a call for a registry tool that was not on the wire — it dispatches
it OFF-WIRE under the party the model last read the name under, and records
`tools.answered_off_wire`. So a narrowed-away tool the model names anyway
RUNS, the outcome row and `tool_choice.outcome` record the miss, and the
next call serves the full wire. The brief expected a refusal; the behaviour
kept is the code's. On a hosted API the wire constrains `tool_use` to the
served schemas, so a miss as defined cannot occur there — a wrong ranking
shows up as a wrong pick or an answer, which `firstAgrees` measures.

What the bench measures (`npm run bench:tool-choice`, mock provider, one
skill of eight tools, six scripted steps; the print on 2026-09-17):

```
condition   script        first-agrees  misses  extra-calls  tools-slot-bytes  pick-tokens  pick-latency-ms
unarmed     -             -             0       0            1745.0            -            -
advisory    right-first   1.000         0       0            1745.0            -            0
advisory    right-second  0.000         0       0            1745.0            -            0
advisory    wrong-pair    0.000         0       0            1745.0            -            0
top-2       right-first   1.000         0       0            743.0             -            0
top-2       right-second  0.000         0       0            743.0             -            0
top-2       wrong-pair    0.000         3       0            1172.4            -            0
```

Read: advisory costs nothing on the wire (1745 bytes of tools slot on every
row, the twin's to the byte — the bench exits non-zero otherwise); a right
ranking under top-2 cuts the tools slot to 743 bytes (two tools + `read_skill`
against eight + `read_skill`); a wrong ranking misses on every narrowed tool
call and the after-miss law serves the full wire on the call after, so the
row lands between (1172 bytes) and `extra-calls` stays 0 because the
off-wire dispatch answers the missed call. `pick-tokens` and
`pick-latency-ms` are `-` and 0 on the mock — a cost is data only when the
provider reported it; `AF_TOOL_CHOICE_CLASSIFIER=typesafe` runs the same
table on the hosted classifier (not run in this packet). The one armed
byte-identity reference is `agent-tool-choice`; the 18 unarmed references
did not move.

Open: the state the classifier reads is the message and the skill id, not
the conversation so far — "the current step" is inferred from the request
alone, which a real classifier will do poorly on a long procedure. The tools
subflow never sees `history`; carrying the last assistant line across the
mount is the next cut, gated on a hosted run of the bench.

## Track

- [x] design · [x] a provider in reach that exposes scores (2026-09-17,
  TypeSafe `jev`, one real call above) · [x] 1 capability
  (`agentfootprint/classify`: the `Classifier` port, `typesafe()`,
  `mockClassifier()`, 9.104.0) · [x] 2 scorer + fallback (`classifierScorer`,
  9.104.0; the fallback is the empty ranking) · [ ] 3 lens bar · [x] 4 tool
  choice — advisory rows + the bench-gated `serve: { top }` narrowing
  (`.toolChoice()`, 9.105.0; a hosted run of `bench:tool-choice` decides
  whether narrowing is ever a default)

## Measured on the first host (2026-09-17, agentfootprint 9.105.0) — model-led vs classifier-led tool selection

Eight questions to the host's chatbot (Claude Sonnet 5, real seeded stores,
a skill graph offering up to twelve tools per skill), one pass per condition,
the same questions in the same order; every number read from the turns'
records (`toolChoices` rows and the receipts' tools-slot measurement), none
from a log. `calls` counts the tool calls in the served history at the answer,
which the sliding window trims, so it is not a per-turn total.

| condition | classifier picks | first pick = model's call | narrowed calls | misses | tools-slot bytes served, all 8 turns | pick tokens, all 8 | latency per pick |
|---|---|---|---|---|---|---|---|
| off | 0 | — | 0 | 0 | 2,242,812 | 0 | — |
| advisory (`serve: 'all'`) | 32 | 6 of 23 | 0 | 0 | 2,016,575 | 65,831 | ≈300 ms |
| `top-2` | 33 | 6 of 24 | 26 of 33 | 8 | 960,497 | 67,314 | ≈290 ms |

Read:
- **The classifier's first pick matched the model's own call about one time
  in four.** Skill descriptions in this host are long procedures; the pick was
  made from the request and the skill id alone (the conversation tail does not
  cross the tools mount — named as the next cut).
- **Narrowing to two still cut the tools slot by 57%** (2.24 MB → 0.96 MB over
  the eight turns) **with every answer reaching the same verdict** as the
  unarmed pass, because the fail-open rules did their job: a call outside the
  served pair was recorded as a miss (8 in 8 turns) and the full set came back
  on the next call; no turn lost its answer. The cost of the picks is ≈67k
  tokens over the eight turns at ≈0.3 s each — against ≈1.3 MB of schema bytes
  not sent.
- **So the dial pays on bytes, not on judgment**: the classifier is not a
  better tool-picker than the model here, but serving its pair first and
  falling open on a miss is cheaper than serving twelve schemas every call.
  Whether the misses cost answer quality on harder questions is the next
  measurement; this pass shows none on these eight.
- Policy stays: the model's call is never substituted; the dial is off unless
  the host names it (`SEO_TOOL_CHOICE=advisory|top-2` there).

