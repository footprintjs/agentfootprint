[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / UnsettledByAbsenceRow

# Interface: UnsettledByAbsenceRow

Defined in: [src/core/agent/findings/types.ts:354](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L354)

A `ruled-out` standing whose ONLY witness is an absence (9.113.0) — the
library's row BESIDE the model's, never a rewrite of it. "Nothing was
found" is not "ruled out": a lookup that matched nothing witnesses no
negative, so a ruling-out that rests on it alone is not settled by its
witness — and the envelope already says why (what it did not check) and
where the settling would be (its `try_instead`). `findings/unsettled.ts`
is the one rule; `ledger.ts · recordFindings` files the row immediately
after the standing it is beside, keyed to that standing's `toolCallId`.
The model's `StandingRow` is untouched and served exactly as declared.

TWO WITNESSES, BOTH REQUIRED. A row is filed only when the dispatch door
recorded the standing's result as an absence (`stages/toolCalls.ts ·
declareCoverage` — the delivered status `'absent'`, the `tools.absent`
event, a `kind: 'absence'` row on `AgentState.coverageDeclared`; the rule
never re-reads a return to decide that, so the record holds one answer to
"did the tool return an absence?") AND the model was SERVED one. The door
records the return before the after-tool chain, the tool's own ceiling
and placement act, and the model rules out on what it READ: a result an
after-tool rule denied, a refusal, a placement ticket or a summary was no
absence to the model, so nothing is filed beside a ruling-out on it.

A RECORD OF A CHECK, NOT A FOLD. Written once, at the moment the standing
was filed, and never recomputed, never updated. The record needs it
STORED because what it is read from does not last as long as the
standing: `coverageDeclared` is per run (a continued conversation or a
`resumeOnError` starts without it — it is not on the `AgentRunCheckpoint`),
and the served result leaves `history` when the window evicts it
(`stages/window.ts`). The model needs
it SERVED for a different reason: from the next call on, a ruled-out
result is a ticket on the wire (`serve.ts · collapseJudged`), so the
piece's section is where the envelope's boundary still reaches it. Which
rows are CURRENT — the last per result, while that result's standing is
still `ruled-out` — is the ledger's one fold (`ledger.ts · foldLedger`,
its `unsettled` map), never this row's.

Every field is in its author's words AS THE MODEL WAS SERVED THEM, never
inferred and never more than the model read: `notChecked` / `cannotCover`
are the served envelope's `not_checked` / `cannot_cover`, `tryInstead` its
`try_instead` STRING — so a scrub an after-tool rule applied is honored,
and a word governance withheld never reaches the row (the door's own
copies are its witness, never quoted). These are tool-authored words in
the committed key, under whatever redaction the run configured (the
`ledger.ts` payload law).

THE NAME. The ledger's own verb negated — `settles` is what an `open`
standing says would settle it — and the cause in the coverage vocabulary
(`absent()`, the delivered status `'absent'`). It reuses no standing value
(round 1 re-filed the standing as `open`, a second writer of the model's
word) and no disposition word (the checker's). THE FIELD: the design
(decisions memo § 2.1, page § 5.6) names the carried sentence `settles`;
it ships as `tryInstead`, the envelope's own field name, because `settles`
is the MODEL's word on an `open` standing and calling the tool's sentence
"what settles it" would be an inference — a reader of this row looks for
`tryInstead`, never `settles`.

## Properties

### cannotCover?

> `readonly` `optional` **cannotCover?**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/findings/types.ts:367](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L367)

The served envelope's `cannot_cover`, by the same rule. Present only when non-empty.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/findings/types.ts:375](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L375)

The standing's iteration — the moment the check ran.

***

### kind

> `readonly` **kind**: `"unsettled-by-absence"`

Defined in: [src/core/agent/findings/types.ts:355](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L355)

***

### notChecked?

> `readonly` `optional` **notChecked?**: readonly [`CoverageItem`](/agentfootprint/api/generated/interfaces/CoverageItem.md)[]

Defined in: [src/core/agent/findings/types.ts:365](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L365)

The SERVED envelope's `not_checked` (the served result's leading JSON
object — a framework note joined after it is not part of it) — a
bounding ledger's first, then the absence's, repeats dropped (the one
recognizer's order, which the door files in too). An item that names no
ground is left out. Present only when non-empty.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/findings/types.ts:357](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L357)

The ruled-out RESULT — the key of the standing this row is beside.

***

### tryInstead?

> `readonly` `optional` **tryInstead?**: `string`

Defined in: [src/core/agent/findings/types.ts:373](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/findings/types.ts#L373)

The served absence's `try_instead`, the STRING byte for byte — never
parsed, never trimmed, never read for a tool name. Present only when
that string is non-blank.
