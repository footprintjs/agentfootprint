# Scored choice — a distribution over declared candidates, on the record (2026-09-16)

Status: DESIGN, gated. Nothing is built until a provider that exposes
scores is in reach. Facts found while reading change this page, not a
chat.

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

## Track

- [x] design · [ ] a provider in reach that exposes scores (BE-side, the
  owner's call) · [ ] 1 capability · [ ] 2 scorer + fallback · [ ] 3 lens bar
