# Lint your tool catalog — catch confusable tools before the model does

**You don't need to use agentfootprint (or footprintjs) to use this.** If you
have a list of tools — OpenAI function definitions, Anthropic tools, an MCP
server's `tools/list` output, a LangChain tool array — this lint reads it
as-is and tells you which tools a model could plausibly mix up, and which
descriptions are structurally weak. Five minutes from install to a gated CI
check.

## Why

When two tools look alike to the model, it picks the wrong one — quietly.
The classic field case (from a real SAN-operations agent):

```
get_fcns_database         "FC Name Server (FCNS) DB — registered N_Ports in the fabric."
influx_get_fcns_database  "FC Name Server registrations (time-series) — every registered N_Port…"
```

Same database, two backends (live CLI vs. time-series history) — and neither
description says **when** to pick which. The model guesses. Your runs become
non-deterministic in a way no stack trace will ever show you.

Routing through tool descriptions is an LLM decision — so treat the catalog
the way you treat code: **lint it, gate it in CI**.

## 1. Five minutes to a linted catalog

Export your tools to a JSON file. All of these shapes work as-is:

```jsonc
// plain (also MCP tool shape)            // OpenAI
[{ "name": "...",                          [{ "type": "function",
   "description": "...",                      "function": { "name": "...",
   "inputSchema": { ... } }]                    "description": "...",
                                                "parameters": { ... } } }]
// MCP tools/list result                  // Anthropic
{ "tools": [ ... ] }                       [{ "name": "...", "description": "...",
                                              "input_schema": { ... } }]
```

Then:

```bash
npm i -D agentfootprint            # or use npx directly
npx agentfootprint-lint-tools tools.json
```

You get two sections:

**Structural findings** (no embeddings involved — always reliable):

```
✗ error [description-missing-or-short] reset_port
    tool has no description — the model can only guess from the name
~ warn  [enum-in-prose] influx_get_port_ranking.metric
    param 'metric' lists its legal values in prose ("avg_iops | peak_iops | mbps")
    suggest: "enum": ["avg_iops","peak_iops","mbps"]
~ warn  [says-what-not-when] get_fcns_database
    description says WHAT the tool returns but gives no cue for WHEN to use it
~ warn  [optional-param-undocumented] influx_get_interface_counters.switch_name
    optional param 'switch_name' has no description — say what happens when it is omitted
```

**Similarity ranking** (which pairs look most alike):

```
most-similar pairs (relative ordering — top 10):
  0.9613  get_interface_counters <> influx_get_interface_counters
  0.9445  get_fcns_database <> influx_get_fcns_database
  ...
```

Exit codes: `0` pass · `1` findings failed the gate · `2` usage/input error.

## 2. Gate it in CI

```yaml
# .github/workflows/lint-tools.yml
- run: npx agentfootprint-lint-tools tools.json --threshold 0.94 --strict
```

- Without `--threshold`, only **structural** findings gate (errors fail;
  add `--strict` to fail on warnings too). Similarity is report-only.
- With `--threshold`, pairs at/above that cosine are **confusable** and fail
  the gate. Each flagged pair carries a *hint* naming the differentiating
  axis to make explicit:

```
✗ CONFUSABLE 0.9445  get_fcns_database <> influx_get_fcns_database
    hint: names differ only by 'influx' — make the descriptions say WHEN to
    choose each (different backend/data source? live vs historical? freshness?)
```

### Threshold honesty — read this once

Cosine ranges are **per-embedder**. The CLI's built-in embedder is a
deterministic offline mock (character-frequency, no API key) — it compresses
unrelated prose into roughly `0.85–0.97`, so its *relative ordering* is
trustworthy ("these pairs look most alike") while *absolute verdicts* need a
calibrated threshold (`0.94` is the mock starting point; expect some false
positives). With a real embedding model, unrelated tool descriptions
typically land `0.3–0.7` and near-duplicates `0.85+` — calibrate once
against a pair you know is confusable and one you know is fine, then gate.

## 3. The API (real embedders, custom rules)

```ts
import {
  analyzeToolCatalog,
  coerceCatalog,          // OpenAI/Anthropic/MCP/plain → CatalogTool[]
  catalogFromTools,       // agentfootprint Tool[] → CatalogTool[]
  defaultStructuralRules,
  descriptionRule,
  embeddingCache,         // content-hash cache — descriptions embed once
} from 'agentfootprint/observe';

const report = await analyzeToolCatalog(coerceCatalog(myToolsJson), {
  embedder: embeddingCache(myEmbedder),  // any { embed, embedBatch } — yours
  confusabilityThreshold: 0.85,          // calibrate per embedder
  watchBand: 0.05,                       // advisory band below the threshold
  failOn: 'error',                       // 'warn' = strict mode
});

if (!report.ok) {
  for (const pair of report.similarity.confusable) {
    console.error(`${pair.a} <> ${pair.b} (${pair.similarity.toFixed(3)}): ${pair.hint}`);
  }
  for (const finding of report.structural) console.error(finding.message);
  process.exit(1);
}
```

The `embedder` is two async functions — bring OpenAI embeddings, Voyage,
a local model, anything:

```ts
const myEmbedder = {
  embed: async ({ text }) => (await openai.embeddings.create({
    model: 'text-embedding-3-small', input: text })).data[0].embedding,
  embedBatch: async ({ texts }) => (await openai.embeddings.create({
    model: 'text-embedding-3-small', input: texts })).data.map((d) => d.embedding),
};
```

Wrap it in `embeddingCache(...)` and re-lints only pay for **changed**
descriptions (content-hash keyed).

### The rule pack is pluggable

Rules are plain `{ id, check(tool, catalog) }` objects. Ours:

| Rule | Catches | Severity |
|---|---|---|
| `description-missing-or-short` | no description (error) / under 40 chars (warn) | error / warn |
| `says-what-not-when` | no temporal/conditional cue (`for/when/after/first/fallback/only`) — describes WHAT, never WHEN | warn |
| `enum-in-prose` | string params whose legal values live in prose (`"a \| b \| c"`, `"one of: x, y"`) instead of a JSON-Schema `enum` | warn |
| `optional-param-undocumented` | optional params whose omission means something, with nothing saying so | warn |

Add, remove, re-tune:

```ts
rules: [
  ...defaultStructuralRules.filter((r) => r.id !== 'says-what-not-when'),
  descriptionRule({ minChars: 80 }),
  { id: 'house-style', check: (tool) => /* your findings */ [] },
]
```

These are token/regex **heuristics** — they flag review prompts, not
certainties. Tune the factory options rather than deleting a rule.

## 4. What the similarity score actually measures

`confusabilityText(tool)` = the tokenized name + the description — what the
model actually reads when it chooses. Pairwise cosine over those texts is a
deterministic **proxy** for "could the model mix these up": high semantic
overlap, never a measurement of any specific model's selection function.
(RFC-002 tier 3 — choice-entropy sampling against real models — is how the
proxy itself gets validated; it is specified, not shipped.)

The runtime counterpart: if you DO run agents on agentfootprint,
`toolChoiceRecorder` measures the same geometry per live LLM call — which
tools were offered, which was chosen, and how decisive the choice was
(`margin = score(best chosen) − score(best non-chosen)`), with narrow
margins and proxy disagreements flagged. Same text construction, same
embedding cache, so build-time lint and runtime margins agree with each
other. See `examples/observability/04-tool-choice-margins.ts`.

## Examples

- [`examples/observability/02-lint-confusable-catalog.ts`](../../examples/observability/02-lint-confusable-catalog.ts) — lint the real 16-tool Neo catalog; the fcns twins get flagged with hints.
- [`examples/observability/03-lint-fix-and-pass.ts`](../../examples/observability/03-lint-fix-and-pass.ts) — the remediation loop: fail → rewrite descriptions to lead with WHEN → pass under the same thresholds.
- [`examples/observability/04-tool-choice-margins.ts`](../../examples/observability/04-tool-choice-margins.ts) — runtime margins on a scripted agent walking into the twin trap.
