# Scored choice — a distribution over declared candidates, on the record (2026-09-16)

Status: GATE OPENED 2026-09-17 — a provider that scores is in reach
(TypeSafe "System One", model `jev`; one real call, quoted below). Steps 1
and 2 landed in 9.104.0 as `agentfootprint/classify` + `classifierScorer`;
the judge on the findings ledger (`.findings({ judge })`) landed beside them
(docs/design/2026-09-findings-ledger.md § Judge). The lens bar (step 3)
remains. Facts found while reading change this page, not a chat.

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

## Track

- [x] design · [x] a provider in reach that exposes scores (2026-09-17,
  TypeSafe `jev`, one real call above) · [x] 1 capability
  (`agentfootprint/classify`: the `Classifier` port, `typesafe()`,
  `mockClassifier()`, 9.104.0) · [x] 2 scorer + fallback (`classifierScorer`,
  9.104.0; the fallback is the empty ranking) · [ ] 3 lens bar
