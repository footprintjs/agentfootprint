# commentary/ — the prose layer

One event in, one English sentence out. Every viewer (Story Lens, the CLI tail,
`agentThinkingTrace`) runs this same engine, so a run reads the same way
everywhere and a consumer's voice or locale is one merged map away.

| file | one job |
| --- | --- |
| `commentaryTemplates.ts` | the `key → sentence` map, the per-event key router (`selectCommentaryKey`), the var extractor, and the flat non-recursive renderer |
| `artifactPhrases.ts` | plain-English words for the artifact unions (`ArtifactOp`, `ArtifactRefusalReason`, `ArtifactSweepReason`) + the two size humanizers |

## The rules a new template has to keep

1. **Only what the event carries.** No inference, no "and then it retried"
   unless an event says a retry happened. A sentence that is accepted and
   silently wrong is worse than a raw payload a reader distrusts on sight.
2. **Absent field → absent clause.** Optional payload fields ride clauses that
   are pre-rendered in `extractCommentaryVars` (the `descClause` precedent), so
   a missing value shortens the sentence instead of leaving a hole — or, worse,
   quoting words nobody spoke.
3. **Prose, not DETAILS.** Refs, digests, fingerprints, ids and durations belong
   in the details panel. Sizes are humanized (`41.0 KB`, `240,000 characters`);
   payload bytes never appear at all.
4. **Never a secret.** Thrown refusal `detail` strings and raw errors stay out —
   error strings are the one place a credential has ever ridden into a log. The
   typed reason says enough to act on.
5. **Add keys, never move them.** Consumers override BY KEY. Branch inside a
   pre-rendered clause rather than splitting a shipped key in two, or every
   existing override goes silently unconsulted (the `cost.limit_hit` lesson).
6. **Unknown events fall through.** `selectCommentaryKey` returns `undefined`
   for anything without a template, and the caller renders it raw — nothing is
   ever dropped on the floor. `null` is the separate, deliberate "skip this".

Tests live in `test/recorders/observability/commentary/`: each family gets
fixture → exact sentence, plus an absent-field omission case, plus the
anti-drift pass that every routed key resolves to a template that exists and
every rendered sentence is free of unsubstituted `{{placeholders}}`.
