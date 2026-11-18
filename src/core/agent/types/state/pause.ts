export interface PauseState {
  // Pause checkpoint — set when a tool calls `pauseHere()`, consumed on resume.
  pausedToolCallId: string;
  pausedToolName: string;
  pausedToolStartMs: number;
  /**
   * The args the paused tool was ACTUALLY RUNNING WITH — every before-tool
   * transform applied — carried across a `pauseHere()` / `askHuman()` pause
   * (8.13.0).
   *
   * Written for the same reason the three sibling pauses write
   * `pausedAskArgs` / `pausedCheckInArgs` / `pausedCredentialArgs`: on resume the
   * after-tool moment runs, and `ToolResultContext.args` promises the args the
   * tool ran with, not the ones the model proposed. Scope is the only carrier
   * across a checkpoint.
   *
   * Optional because a checkpoint written before 8.13.0 does not have it; the
   * resume path recovers those args from the assistant turn in `history` (see
   * `argsForPausedCall` in `stages/toolCalls/batch/paused.ts`).
   */
  pausedToolArgs?: Readonly<Record<string, unknown>>;
  /**
   * The party whose contract the paused call was resolved against (9.92.0) —
   * the wire's party for a name on the wire, the off-wire answering party
   * otherwise — carried across every pause that re-dispatches on resume (a
   * middleware ask, a check-in, a credential consent). A resume in a FRESH
   * Agent instance has an empty served-party record and never re-runs
   * Compose, so without this the resumed dispatch fell back to the build-time
   * map and an inactive skill could answer a provider's contract. Written on
   * the pause paths only: a run that never pauses commits the exact bytes it
   * always did.
   */
  pausedToolParty?: {
    readonly channel: import('../../../../events/payloads.js').ToolNameChannel;
    readonly id?: string;
  };
  // Check-in checkpoint — set when a tool's `checkIn` demand trips and the
  // run pauses BEFORE execute. `pausedCheckIn` discriminates a check-in pause
  // from a plain `askHuman` pause on resume; `pausedCheckInArgs` carries the
  // proposed args so an APPROVED tool can execute on resume. Both survive
  // structuredClone (checkpoint discipline). Absent for non-check-in pauses.
  pausedCheckIn?: boolean;
  pausedCheckInArgs?: Readonly<Record<string, unknown>>;
  /**
   * The request a consent-gate pause (a check-in or a middleware ask) put to
   * a person: the id its decision must quote and the nonce that binds that id
   * to the exact paused call (`core/consentRequest.ts`). Written at the pause,
   * read and cleared by the resume that uses the decision. Absent for every
   * other pause. Named with the arguments in the conversation redaction
   * vocabulary: the nonce lets whoever holds it confirm a guess of them.
   */
  pausedRequest?: import('../../../consentRequest.js').PendingRequest;
  // Which REGISTERED screen component the outstanding ask nominated to collect
  // its decision (9.24.0) — the `componentId` of the check-in's / middleware
  // ask's `AskComponent`, written at pause time ONLY when one exists and read
  // back on resume so the decision record can say which surface answered.
  // Never written for component-less asks (their checkpoints stay
  // byte-identical) and cleared on the resume that consumed it.
  pausedComponentId?: string;
  // Middleware-ask checkpoint — set when a `toolMiddleware` answers `ask` and
  // the run pauses BEFORE the tool executes. Same wire as the check-in pause,
  // discriminated the same way: `pausedAsk` tells resume which kind of question
  // is outstanding. `pausedAskArgs` carries the args AS TRANSFORMED SO FAR (the
  // human approved those, not the model's originals) and `pausedAskIndex` says
  // which link asked, so resume continues the chain from the NEXT one instead
  // of re-running decisions the checkpoint already recorded. All survive
  // structuredClone. Absent for every other pause.
  pausedAsk?: boolean;
  pausedAskArgs?: Readonly<Record<string, unknown>>;
  pausedAskIndex?: number;
  pausedAskMiddleware?: string;
  /**
   * The rules an asked call still had to pass when the person was asked: the
   * NAME of the link that asked and of every link after it, in chain order.
   * Bound into the request (`core/consentRequest.ts`), so a checkpoint whose
   * record of it changed is refused (`'call-changed'`), and held against the
   * resuming agent's own chain, so a redeploy that removed, added, renamed or
   * moved one of those rules is refused (`'chain-changed'`) rather than skip a
   * rule the approval was given under. Names only — never a value of the run.
   */
  pausedAskChain?: readonly string[];
  // Credential-consent checkpoint (8.6.0) — set when a tool's DECLARED
  // credential comes back `authorization-required` under the default
  // `onAuthorizationRequired: 'pause'`. Same wire as the check-in and ask
  // pauses, discriminated the same way. `pausedCredentialArgs` carries the
  // proposed args so the tool can run on resume; there is no
  // `pausedCredentialUrl`, deliberately — the URL rides `pauseData` to the
  // caller and is re-fetched from the provider on resume, so it never has to
  // live in tracked state (which is the commit log, and therefore the trace).
  pausedCredential?: boolean;
  pausedCredentialArgs?: Readonly<Record<string, unknown>>;
  pausedCredentialService?: string;
  // NOTE (8.6.0) — there is deliberately NO scope key for the `'tell-model'`
  // consent record. A tracked write is a commit-log entry, which is the
  // snapshot, the narrative and every recording; putting the consent URL there
  // would rebuild the exact leak this release removes. It travels instead on a
  // side channel (`ToolCallsHandlerDeps.reportConsentOutstanding`) to a private
  // field on the Agent, lives for the length of the run, and reaches the caller
  // only as `CredentialConsentRequiredError`.
  /**
   * The dispatch a PAUSED call of a declared code-running tool was filed under
   * (`scripts/rows.ts` · `recordScriptRow`), carried across the checkpoint so
   * the row that settles it on resume joins the same dispatch — one call, one
   * dispatch, counted once. Ids and numbers only, never the program. Written
   * at the pause, read and cleared by the resume; absent on every run that
   * files no script row.
   */
  pausedScriptDispatch?: {
    readonly dispatch: number;
    readonly toolCallId: string;
    readonly turn: number;
  };
  /**
   * The program values of a call that paused from INSIDE `execute`
   * (`pauseHere()` / `askHuman()`): its declared argument as the model
   * proposed it and as `execute` was handed it, read before the tool ran. The
   * resume settles that call without running it again, so the values travel
   * here — never re-read from a carrier the tool may have edited. Content: named
   * in the conversation redaction vocabulary. Written at that pause, read and
   * cleared by its resume.
   */
  pausedScriptPrograms?: {
    readonly proposed?: string;
    readonly submitted?: string;
  };
}
