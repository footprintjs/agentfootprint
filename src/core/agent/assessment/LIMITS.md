# Assessment limits

## Not covered

- Source links are produced in the flat chart only. A grouped run's record
  carries no source-link channel.
- Source links for an argument's declared source wait for cross-scope support
  because its check, default fill, or kept-answer reuse runs in the inputs sub-flow.
- An Agent chart mounted directly in an engine host records served rows only.
  Witnesses require AgentFootprint's own run and its native privacy policy.
- A row whose checked output write cannot be determined yields no source link or gap.
- A collected source-link channel is partial when the shared scope replay
  reaches its allowance. It keeps the bound links and reports
  `budget-exhausted`, even when the reader could not finish the first link.

- **A host-built record's top-level lists.** The lists ON a row go through
  `rowList`. The record's own keys — `history`, `findingsLedger`,
  `coverageDeclared`, `answerValidation.checks`, `middlewareDecisions` (and the
  `changedKeys` the shared reader `middleware/rewrites.ts` ·
  `argumentRewritesOf` walks) — are read with the array's own length and
  elements: never through `history`'s iterator or the checks' own `entries`, but
  a getter at an index runs, an overridden `forEach` runs, and a very long
  sparse list costs its length. A record the library committed, or a saved
  recording read with `JSON.parse`, holds none of these.
- **A Proxy, and a getter on an entry object.** `rowList`'s guarantee covers an
  ordinary (non-Proxy) array and its own index accessors and iterator, nothing
  more. A Proxy around an array passes `Array.isArray`, and its traps
  (`getPrototypeOf`, `getOwnPropertyDescriptor`) run code inside the reader and
  can throw out of it; a revoked Proxy throws from `Array.isArray` itself. An
  entry is handed on as it is, so a getter on an entry object runs when the
  fold reads that property. A record the library committed, or a saved
  recording read with `JSON.parse`, holds neither.
- **Verdicts that exist only as events.** A `.claims()` `checked-pass` (so a
  claims-supported "known") is not on the committed record. The fold never reads
  events; the step that needs a verdict commits one row, and its reason joins
  `REASONS` then. The gate's clean pass, unfinished steps, integrity findings and
  unsettled claims are committed only while the answer layer is armed; on an agent
  without it they stay events, and the fold does not read them.
- **A run that threw, read by `assessAnswer` directly.** No committed row says a
  turn ended in an error in this version, so the fold folds what the crashed run
  left, as if it had answered. `agent.assessment()` (which knows) resolves to
  `undefined` and the answer account (which reads the recording's `turn_end`)
  says the record shows no answer; a caller of `assessAnswer` checks the run's
  outcome first. Step 6 did not settle it: the answer layer's stage runs inside
  the final branch, whose output mapping receives the answer string, never the
  branch's scope, so it cannot commit an "answered" row to the run's state; a row
  filed by the Route decider could, and it needs the fold's return shape to say
  "no answer" — a decision of its own (`docs/design/honesty/answer.md`).
- **A row lost AND its envelope gone.** A record that lost a call's coverage row
  is still read from the envelope in `history` — `fold-real-record.test.ts` pins
  the account's reduced fixture reading the same standing as the full record. A
  record that dropped the history too has nothing left to read.
- **Tool entry and settlement after eviction.** The turn keeps up to 1,024
  entries in each occurrence-keyed list. The standing reports `check-unreachable`
  when a list could not retain every fact or an argument observation cannot be
  bound in a keyed record. An older saved keyed tool-end can prove entry.
- **Evicted results.** The recorded settlement keeps the delivery, the call's
  outcome and selected result declarations after `.window()` evicts the model's
  copy. Checks that need the original text or app-provided row paths can say
  less. A later completion cannot clear an earlier failure by matching its
  arguments. The current dispatch records no retry link to the earlier call.
- **A correction after an evicted call with the same ID.** When a call's result
  is evicted and a later proposal with the same turn, tool and ID gets a
  library correction or another pre-dispatch row, the remaining rows can look
  exactly like a correction of one proposal that never ran. The earlier
  argument failure may be replaced in an older recording without call
  addresses. New recordings distinguish the two by their call addresses.
- **Incomplete rewrite addresses.** A masked address or an address missing on
  one side prevents matching the rewrite, so the overwritten argument may
  still be reported as assumed.
- **Model-declared findings with repeated IDs.** The findings layer treats two
  calls that share a provider ID in one batch as one call because the model
  names its subject by that ID.
- **Rows from an earlier turn that reuse a call id — on an agent without an
  honesty layer.** Without a turn stamp, the fold places a ledger row in this
  turn by the call ids it names, and a provider that reuses ids across turns
  (numbering each response's calls from `0`, say) makes an earlier turn's row
  look like this turn's in three places: a carried conflict row whose witness
  shares an id with a call of this turn reads `sources-conflict`
  (`readConflicts`); a contingent row declared on such a call reads
  `value-contingent`; and `firstRowOfTurn` — which finds where this turn's rows
  begin as the first unstamped row naming a call of this turn — can stop at an
  EARLIER turn's row that named the reused id, so every contingent row declared
  on the answer after it, an earlier turn's answer included, is read as this
  turn's. Each over-reports ("not sure") and never hides. The cheap guard —
  start the search after the last row naming an id that only earlier turns
  called — does not help a provider that reuses every id, so it is not built.
  While the inputs layer is armed, the one writer stamps every row with its
  conversation `turn` (honesty step 3), and a stamped row counts only in its own
  turn.
- **An unstamped contingent row declared on the ANSWER, on a later turn the
  ledger cannot place** (an agent without the inputs layer). Such a row names no
  call of its own, and the ledger crosses turns on a continued conversation, so
  on a turn after the first it counts only when it follows — or is — a row the
  ledger shows to be this turn's: one stamped with this turn, or one that names
  a call of this turn (a row cannot name a call before the call exists; a reused
  id is the bullet above). A later turn that made no call and filed nothing else
  leaves it unread: it may be an earlier turn's answer, and an earlier answer
  must never make this one "not sure". Arm the inputs layer and every row
  carries its turn.
- **Subject placement.** Which entity the question names is on hold, so the fold
  reads every call of the turn.
- **A finished step procedure** files no row, so it cannot count as a check that
  ran — only an unfinished one is on the record.
- **The line's reasons carry no counts** — it names which kinds of reason fired;
  `agent.assessment()` and the account have the counts and the rows.
- **Where a declared name does not reach yet.** The before-tool rewrite clause
  ("a before-tool rule set a value a call ran with …") stays anonymous: its reason
  mixes rewrite and default rows, and the line does not split them. The time
  layer's own limits lines (`Period:` checks, `Clocks`, under `.time()`) keep the
  registered name. A typed answer's limits as data (`turn_end.answerCoverage`)
  carry no per-item source. A reason's `source` is not on the event or on
  `turn_end.answerAssessment` — their fields are pinned and unchanged; read
  `agent.assessment()` or `assessAnswer(recording)`. A later, versioned projection
  can carry it.
- **Withheld results.** The standing emits one anonymous reason when this turn's record proves that a returned result was withheld, including after eviction and a same-request resume. Public standing gives no count, tool name or result facts. The raw `accountForAnswer` still reads native declarations for a denied result until card 9.
- **Integrity findings without a resolved call.** Standing omits a finding when the record cannot resolve it to one call occurrence.
- **Older recordings.** Without the settlement ledger, the assessment derives delivery and outcomes from retained history, so a warning can go unreported once its message has left the window.
- **Compositions.** Standing is available only per Agent turn, with the final
  answer carrying the line of the Agent that produced it and earlier warnings
  reaching that Agent only as text from prior members.
- **In the run, no app declarations.** The layer folds without `rowsAt`;
  `assessAnswer(record, declarations)`, `agent.assessment(declarations)` and the
  account take them and can say more about the same run.
- **Where the event does not reach** — a composition that mounts the agent reads
  `turn_end.answerAssessment` (its dispatcher does not bridge `answer.*`); the line
  is never streamed. The rest of the layer's gaps: `docs/design/honesty/answer.md`,
  "Not covered".
