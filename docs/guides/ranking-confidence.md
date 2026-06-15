# Ranking confidence — the honesty marker on influence rankings

> `rankingConfidence` · `marginStrategy` · `ratioStrategy` · `ConfidenceStrategy`
> — from `agentfootprint/observe`.

## The problem it solves

The influence scorer (`scoreInfluence`) ranks the context sources of a run by how
much each **resembles the model's final answer**. That is a strong proxy for
**content-driven** bugs — a misleading fact the answer echoes scores high and
ranks first.

But it is **structurally blind** to one whole class of bug: **absence / crowding**
(history truncation, context dilution, "lost in the middle"). There, the culprit
broke things by *displacing* the context that mattered — it need not resemble the
answer at all. So it ranks **low**, often *below* an innocent source the answer
happens to discuss. The scorer will still hand you a confident #1 — and it's the
wrong one.

The tell is not a low score. It's a **flat top**: no source clearly dominates.
`rankingConfidence` reports that flatness honestly, so you escalate to **ablation**
(the causal tier) instead of trusting a wrong rank-1.

This is the same discipline as the causal slice's incompleteness markers — the
library says what its proxy cannot see.

## Basic use

```typescript
import { scoreInfluence, rankingConfidence } from 'agentfootprint/observe';

const scores = await scoreInfluence({ evidence, finalAnswerText, embedder });
const c = rankingConfidence(scores);

if (c.clearWinner) {
  // one source clearly leads — still a PROXY, confirm the lead by ablation
  confirmByAblation([c.lead!]);
} else {
  // too flat to trust — the culprit may be any of these (or, for absence
  // bugs, none that resemble the answer). Cover the shortlist by ablation.
  confirmByAblation(c.shortlist);
}
console.log(c.reason); // human-readable, for narratives / reports
```

`RankingConfidence` fields:

| field | meaning |
|---|---|
| `clearWinner` | one source clearly dominates (trust as a *lead*, not a verdict) |
| `lead` | id of the top-ranked suspect (the lead) |
| `margin` | absolute top-1 − top-2 gap (display; `undefined` for <2 / malformed) |
| `shortlist` | ids to ablate — always includes `lead`; when **no** clear winner with ≥2 suspects, the runner-up too |
| `reason` | presentation-only string — read the fields as data, never parse this |

**Claim ladder.** `clearWinner` is a proxy for "the ranking has a clear lead",
**never** "the lead is the cause" — a high-similarity innocent the answer
rationalizes over can win. Only ablation (remove a suspect, see if the outcome
flips) makes a causal claim, in **both** branches.

## Pluggable decisiveness — `ConfidenceStrategy`

"Is the top flat?" can be measured more than one way. The rule is a plug-in; the
library ships two and you can bring your own.

```typescript
import { rankingConfidence, marginStrategy, ratioStrategy } from 'agentfootprint/observe';

rankingConfidence(scores);                               // default: marginStrategy(0.05)
rankingConfidence(scores, { clearWinnerMargin: 0.08 });  // tune the default margin
rankingConfidence(scores, { strategy: ratioStrategy(0.05) }); // swap the rule entirely
```

| strategy | rule | when to use |
|---|---|---|
| **`marginStrategy(t)`** (default) | absolute gap `s0 − s1 >= t` | simple, interpretable; but the gap scale is **embedder-relative** |
| **`ratioStrategy(t)`** | relative gap `(s0 − s1) / |s0| >= t` | **transfers across embedders / answer lengths** — same verdict at any scale |

**Why ratio matters.** The absolute margin gives *different* verdicts for the
*same relative gap* at different score scales; the ratio gives the same verdict:

```
scores            abs gap   marginStrategy(0.05)   ratioStrategy(0.05)
[0.10, 0.09]        0.01     not clear              clear  (10% gap)
[1.00, 0.90]        0.10     clear                  clear  (10% gap)
```

Bring your own (e.g. entropy / dispersion of the whole distribution):

```typescript
import type { ConfidenceStrategy } from 'agentfootprint/observe';

const entropyStrategy: ConfidenceStrategy = {
  name: 'entropy',
  // rankedScores: finite scores sorted DESC, length >= 2
  isClearWinner: (s) => /* your flatness test */ s[0] - s[1] >= 0.05,
};
rankingConfidence(scores, { strategy: entropyStrategy });
```

The **framework guarantees hold under any strategy** — the shortlist always
contains the lead and (when there's no clear winner) the runner-up; a single
suspect is always a clear winner; malformed scores degrade safely. The strategy
only judges the clean, all-finite case.

> The strategy is also the key on a benchmark leaderboard: run CTXBUG with
> different strategies to pick the best default for *your* embedder, rather than
> trusting an uncalibrated constant.

## Honest limits

- Thresholds (`0.05` margin, `0.05` ratio) are **uncalibrated** proxies; the
  margin one is embedder-relative. Calibrate by sweeping clear-winner vs flat
  rankings on your embedder.
- `rankingConfidence` does **not** *find* missing context — it tells you the
  ranking can't, so you escalate. Catching a crowding culprit still needs
  **ablation of the present blocks** (the crowder is present and ablatable);
  truly-missing content with nothing to ablate needs the (separate)
  available-vs-sent diff.

## See also

- Runnable: [`examples/observability/09-attributability-marker.ts`](../../examples/observability/09-attributability-marker.ts)
- The full localizer that consumes this: `localizeContextBug` (RFC-003 Part B)
- The scorer it marks: `scoreInfluence` (influence-core, D6)
