# Contrastive influence — cancel the topical-innocent confound

> `scoreContrastiveInfluence` · `ScoreContrastiveInfluenceArgs`
> — from `agentfootprint/observe`.

## The problem it solves

The influence scorer (`scoreInfluence`) ranks the context sources of a run by how
much each **resembles the model's final answer** (the `FA` signal). That has a
built-in confound: the **topic the decision is about** resembles _any_ answer on
that topic — the right one and the wrong one alike.

So a **topically-central innocent** can out-rank the real culprit. A refund
decision quotes the refund policy; the policy text therefore resembles whatever
the model decided — approve _or_ deny. When the answer is wrong, the policy still
scores high (it's on-topic), and can sit _above_ the source that actually caused
the wrong answer. Plain output-similarity has no way to tell "central to the
topic" apart from "caused this answer".

## The fix — contrast against a reference output

If you have a **reference output** — a known-good, expected, or prior-good run —
score by the _contrast_ between how much a source resembles the actual answer and
how much it resembles the reference:

```
contrastive FA(e) = sim(e, answer) − sim(e, reference)
```

- A **topical innocent** is similar to _both_ outputs → the two terms cancel → ~0.
- The **real culprit** is similar to the _wrong_ output specifically → it stands out.

Everything else — the `AVG` / `PERSIST` / `DEPTH` reasoning-trace signals, the
adaptive weights, the composite — is **shared with `scoreInfluence` verbatim**.
Only the `FA` term becomes contrastive. The return type is the same
`InfluenceScore[]`, so `rankingConfidence` and the rest compose unchanged.

## Basic use

```typescript
import { scoreContrastiveInfluence, rankingConfidence } from 'agentfootprint/observe';

const scores = await scoreContrastiveInfluence({
  evidence, // the context sources (+ their reasoning ancestors)
  answerText, // the ACTUAL (e.g. buggy) output
  referenceText, // a known-good / expected / prior-good output
  embedder, // injected; wrap in EmbeddingCache to share embeddings
});

const c = rankingConfidence(scores); // same honesty marker composes
console.log(scores[0].id, c.clearWinner);
```

`ScoreContrastiveInfluenceArgs` fields:

| field                   | meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `evidence`              | context sources, each `{ id, text, ancestorTexts }` (ids must be unique) |
| `answerText`            | the actual output the evidence is scored against                         |
| `referenceText`         | the reference output to contrast against (the confound canceller)        |
| `embedder`              | injected embedder; wrap in `EmbeddingCache` to reuse embeddings          |
| `weights?`              | composite weights (default: paper priors 0.40/0.30/0.20/0.10)            |
| `persistenceThreshold?` | `PERSIST` threshold T (default 0.3)                                      |
| `signal?`               | `AbortSignal` for the embedding pass                                     |

## When to use it (and when not)

- **Use it** for **regression / eval debugging**, where you _have_ a reference: a
  prior-good run, a golden answer, or the expected output of a test case. This is
  exactly the CTXBUG setting — every instance ships an expected output.
- **Don't reach for it** in **cold localization**, where there is no reference
  output to contrast against. Use plain `scoreInfluence` there.

## Honest limits — the claim ladder

- Still an **embedding-geometry PROXY**, never causal. The contrast removes a
  _confound_; it does not _prove_ causation. A source can resemble the wrong
  answer specifically and still be innocent (correlation, not cause).
- **Ablation is the causal tier.** Use `scoreContrastiveInfluence` →
  `rankingConfidence` to get a _short, well-ordered_ shortlist cheaply, then
  confirm the lead by ablation (remove it, see if the outcome flips).
- The reference output must be a **genuine** good/expected run for the contrast to
  mean anything. If `answer == reference`, every contrastive `FA` is ~0 (no
  contrast, no signal) — by design.

## Plug it into the localizer (the `scorer` slot)

`localizeContextBug` ranks suspects with a **pluggable `InfluenceScorer`** — the
default is `scoreInfluence`; pass your own to change the ranking ORDER (never
causality — ablation alone convicts). The contrastive scorer drops straight in,
remapping its one differently-named field (`answerText` ← `finalAnswerText`) and
supplying the reference:

```ts
import {
  localizeContextBug,
  scoreContrastiveInfluence,
  type InfluenceScorer,
} from 'agentfootprint/observe';

const contrastive: InfluenceScorer = (args) =>
  scoreContrastiveInfluence({
    evidence: args.evidence,
    answerText: args.finalAnswerText, // the localizer calls it finalAnswerText
    referenceText: expectedOutput, // the confound canceller
    embedder: args.embedder,
  });

const report = await localizeContextBug({ artifacts, embedder, atStep, scorer: contrastive });
```

A scorer only narrows; the causal claim still comes from supplying a `rerun` so
ablation can confirm the lead.

## See also

- Runnable: [`examples/observability/11-contrastive-influence.ts`](../../examples/observability/11-contrastive-influence.ts)
- The scorer slot end-to-end: [`examples/observability/16-pluggable-scorer.ts`](../../examples/observability/16-pluggable-scorer.ts)
- The plain scorer it extends: `scoreInfluence` (influence-core, D6)
- The honesty marker that composes on it: [`ranking-confidence.md`](./ranking-confidence.md)
- The causal tier to confirm with: `localizeContextBug` (ablation, RFC-003 Part B)
