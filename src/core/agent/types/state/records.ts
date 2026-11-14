import type { FindingsLedger } from '../../findings/types.js';
import type { DeclaredCoverage } from '../../../../semantics/coverage/index.js';
import type { ClaimLedgerRow } from '../../../../integrity/unsupported-claim/check.js';

export interface RecordsState {
  /**
   * Every coverage statement the run's tools declared, in the order they
   * landed — `absent(…)`'s "here is where I looked" and `coverage(…)`'s
   * "here is what my verdict does not rule out".
   *
   * TRACKED state, unlike the repeated-call counters, and for the opposite
   * reason: a limit is a fact ABOUT THE ANSWER, not a fact about an attempt,
   * so it has to be in the record the answer is read beside — the commit log,
   * the snapshot, every recording. The zero-cost guarantee holds anyway
   * because the key is written only when a tool actually declares one: an
   * agent whose tools never return either shape commits exactly what it
   * always did.
   */
  coverageDeclared?: ReadonlyArray<DeclaredCoverage>;
  /**
   * The reservation counters behind every RESULT IDENTITY this run minted —
   * `claim-result/<namespace>/<runId>/<ordinal>`, the address of a composed
   * coverage row (`semantics/coverage/composedCoverage.ts`). Reserved BEFORE
   * a call of a tool that declares its `search` is dispatched, by the one
   * owner (`findings/verificationState.ts` · `reserveResultIdentity`), so an
   * identity is never a provider's call id (those repeat across iterations,
   * branches, resume legs and turns). Tracked state, so a paused run resumes
   * with the same namespace and counters; written only when a `search` tool
   * is called, so every other agent commits the key set it always did.
   */
  resultIdentities?: import('../../findings/verificationState.js').ClaimVerificationState;
  /** Private admitted tool attempts; only the negative-claim runtime writes this. */
  negativeClaimState?: import('../../negativeClaims/capture.js').NegativeRuntimeState;
  /** Library-composed answer and diagnostic verdicts, never model evidence. */
  answerNegatives?: import('../../negativeClaims/delivery.js').AnswerNegatives;
  /**
   * The ANSWER's coverage, as data — `coverageDeclared` folded into the three
   * lists the limits block would have printed (merged in declaration order,
   * duplicates dropped, every entry kept: `coverage/answer.ts` ·
   * `coverageOfAnswer`) — and, only when a call declared one (honesty step
   * 7b), `periods`, the data twin of the block's `Period:` lines; and, on an
   * agent whose inputs layer is armed, the values a tool's rule assumed this
   * turn (`assumed`: the rows the prose answer's "Assumed" block prints, read
   * the same way).
   *
   * Written only when the answer is TYPED (`.outputSchema()`) and
   * `.limitsTravelWithTheAnswer()` is on: a typed answer is JSON, and prose
   * appended to it is not, so its limits travel BESIDE the answer instead of
   * inside it. Committed by the Route decider on the turn it picks `final`
   * (`stages/answerCoverage.ts` · `withAnswerCoverage`) — the Final branch
   * cannot write back — and only when the run's tools declared something or
   * a value was assumed, so every other run commits exactly the keys it always
   * did. Read it with `agent.answerCoverage()`; `turn_end.answerCoverage`
   * mirrors it.
   */
  answerCoverage?: import('../../../../semantics/coverage/index.js').AnswerCoverage;
  /**
   * The typed readings this run's tools settled (9.61.0) — one row per
   * (entity, field, value) flattened out of each recognized semantic
   * envelope, in declaration order, never rewritten. The claim seam reads
   * it at answer time: the LAST row for a fact is the settled value, every
   * earlier one is quotable history.
   *
   * The `coverageDeclared` key one line up is the shape and the reason:
   * the envelope is replaced by its compact model projection on the wire,
   * so without a tracked key the typed object exists nowhere a check could
   * reach. Written only when a tool actually declares readings — an agent
   * whose tools return none commits exactly what it always did.
   */
  claimFacts?: ReadonlyArray<ClaimLedgerRow>;

  /** Accepted response's request-local identity evidence, independent of optional receipts.
   * Singleton tuple so grouped output Replace is atomic, including nested result lists. */
  findingsRequest?: readonly [import('../../findings/admission.js').FindingsRequest];
  /** Declarations have already been preserved before this batch's optional human ask. */
  findingsBatchRecordedAt?: number;

  // ── The findings ledger (`.findings()`) ────────────────────────
  /**
   * The model's own standings on its tool results (9.101.0) — one flat
   * append-only list of `basis`, `standing` and `conflict` rows, in the
   * order they were declared. A basis row is what the model said a call was
   * FOR (`direct` / `exploratory`) before the tool ran; a standing row is
   * what it later made of one result (`fact` with the assertions it stands
   * on, `open`, `ruled-out`, `noise`); a conflict row is the assertion
   * algebra's fact at the write that created it, witnesses by identity only.
   * Beside the model's rows, never merged into them: the judge's `judgment`
   * / `judgment-error` rows (9.104.0), `contingent` rows (9.110.0), and an
   * `unsettled-by-absence` row after a `ruled-out` standing whose only
   * witness was an absence (9.113.0) — the library's reading, the model's
   * row untouched.
   *
   * Written ONLY by `recordFindings`, and only when `.findings()` is
   * configured AND the model actually declared something — ABSENT otherwise,
   * so every other agent commits exactly the keys it always did (the
   * `claimFacts` key one line up is the shape and the reason). Plain records
   * and arrays only, so it survives `structuredClone` and a TypedScope read;
   * every write assigns a FRESH array, never mutates the committed one.
   *
   * Reading it: the LAST standing row per `toolCallId` is the current
   * reading, every earlier one is quotable history; an id with no standing
   * row is undeclared — never `open`, never "no findings". A disagreeing
   * second standing is two rows, not a conflict; conflicts come only from
   * assertions, and the current conflict set is a fold, not the rows.
   */
  findingsLedger?: FindingsLedger;
}
