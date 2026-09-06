/**
 * ONE list of the sentences the skill-graph cursor bug has produced, and the
 * reason each of them can be falsified (9.84.0).
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
 *
 * Round 3 of this bug wrote the checker below inside
 * `test/skillGraphSelfCall.test.ts` and pointed it at TOOL RESULTS only. It
 * worked: all twelve matrix cells of the self-call notice came out clean. Then
 * the very same banned sentence — "read_skill MOVES you to a DIFFERENT skill"
 * — reappeared forty lines away in the `read_skill` DESCRIPTION, a surface the
 * checker could not see, and shipped.
 *
 * A checker whose SCOPE is decided by which suite happens to import it is not a
 * checker, it is a habit. So the list lives here, every model-facing surface
 * this release touches is run through it, and a surface that is NOT run through
 * it is an omission a reader can see (`test/modelFacingSurfaces.test.ts` is the
 * inventory) rather than one they have to notice the absence of.
 *
 * An inventory still only holds what somebody remembered to register, and in
 * 9.86.0 two live producers matching these very rules turned out to be missing
 * from it. So there is a third instrument: `test/modelFacingScan.test.ts` walks
 * every string literal in `src/`, judges it here at the strictest lifetime, and
 * fails on one that is neither judged by a registered row nor accounted for
 * with the reason it is safe.
 *
 * ── THE LAW, IN THE FAMILY'S WORDS ────────────────────────────────────────
 *
 * A Lens may OMIT; a Lens may never DENY what the Fold holds. The Fold is what
 * the run really carries — the wire, the registry, the cursor, the catalog —
 * and every string judged here is a Lens onto it: a narrowed view composed for
 * a reader who cannot see the Fold directly. Leaving something out of that view
 * costs nothing and is frequently the point (a role-hidden skill is silently
 * absent, never declared forbidden). Saying a capability is GONE while it is on
 * the wire is an honesty failure rather than a wording bug, because the model
 * acts on it — the field report this whole family exists for records a model
 * concluding it could not help while the tools it needed sat in that same
 * call's tool list. A tool result is the hardest Lens of all: it is re-read on
 * every later call of the turn, so a clause that was true when it was composed
 * turns into a denial later without anybody rewriting a word. Two walks now
 * enforce that law instead of remembering it — `test/modelFacingScan.test.ts`
 * over every sentence-shaped literal in `src/`, and
 * `test/lib/injection-engine/userTurnProducers.test.ts` over every
 * `role: 'user'` turn this library writes.
 *
 * ── WHY A SURFACE IS TWO DIMENSIONS AND NOT ONE ───────────────────────────
 *
 * A clause is provable or not depending on HOW LONG the string lives, and that
 * is not the same question as WHERE it is delivered. The first list conflated
 * them — `'tool-result' | 'tool-description'` — and the conflation held only
 * because the release happened to touch one channel of each lifetime:
 *
 *   lifetime: 'persistent-history'  — composed on iteration N, written into
 *                        `history`, and re-read by the model on call N+1 AND on
 *                        every call after it, including the tool-less wrap-up.
 *                        Nothing in it may depend on state that moves: the
 *                        cursor, the wire, the budget, the posture's verdict. A
 *                        present-tense clause here is a FORECAST.
 *   lifetime: 'request-ephemeral'  — recomposed from scratch for a single
 *                        request and never re-read. Present tense about THIS
 *                        request's cursor is a FACT there, not a forecast.
 *
 * The two do not correlate with the channel. System-prompt text is rebuilt
 * every request, so it is EPHEMERAL and may speak in the present; a tool result
 * is PERSISTENT and may not — and the same sentence in an injected turn is
 * persistent again, because an injected turn is appended to `history` exactly
 * as a tool result is. A channel is not evidence about lifetime, so the caller
 * states both and the RULES JUDGE `lifetime`.
 *
 * "May speak in the present" means the present TENSE — "You are in 'alpha'",
 * "Two skills are reachable" — reported as the state of the request being
 * answered. It does not extend to the deictic ADVERBS (`now`, `currently`,
 * `right now`, `at the moment`), which the `now` row bans on every lifetime:
 * they point at the moment of reading rather than name the pass, and the
 * anchor that repairs them ("when that call was made", "on that pass") is
 * available on an ephemeral surface too. So an ephemeral producer may say
 * "You are on step 2 of 5" and may not say "You are currently on step 2 of
 * 5" — the file's stance since the `right now` literal, stated here so the
 * header and the row agree.
 *
 * `channel` is carried for the inventory and for the failure message, so a
 * failing assertion tells the reader which producer to open rather than only
 * which sentence is wrong.
 *
 * ── EXEMPTIONS ARE LIFETIME CLAIMS, AND THEY HAVE EVIDENCE ────────────────
 *
 * Two of the three exemptions below were written as claims about the
 * `read_skill` DESCRIPTION, and both argued the same thing in prose: that
 * string is rebuilt per request and never re-read. That is a lifetime, so it is expressed as one
 * — and it is derivable rather than asserted. `AgentBuilder.skillGraph` REFUSES
 * `reactMode: 'classic'` at build (the one mode that caches the tools slot),
 * so a graph-composed description cannot exist on a cached slot: every call
 * that has an offer recomposed it. {@link GRAPH_TOOL_DESCRIPTION} carries that
 * evidence, which is why a bare "it's a tool description" is NOT the exemption
 * — a description composed once and cached would be persistent, and the rows
 * below would rightly fail it.
 *
 * The third exemption — the container deictic — is keyed to the same dimension
 * for a different reason, and the pair is worth reading together. Its falsifier
 * is not staleness at all: `this session` denotes the same session forever.
 * What breaks is ATTRIBUTION, and attribution only breaks where a second copy
 * of the sentence can come to sit beside the first. A persistent surface
 * manufactures those copies; an ephemeral one cannot. So two rows share one
 * lifetime exemption while arguing from opposite properties of it — which is
 * why `exemptBecause` is required TEXT rather than a flag.
 *
 * ── WHAT THIS CHECKER DOES NOT COVER, SAID OUT LOUD ───────────────────────
 *
 * The `read_skill` description's two lists are framed as a verdict on the gate
 * ("Not reachable from here (read_skill for these will be refused)"), and that
 * framing is a compose-time prediction which two shipped mechanisms falsify:
 * a `strictness: 'rails'` / off-menu `'guard'` posture refuses a hop the list
 * calls REACHABLE, and the re-engagement arm admits a parked map member the
 * list calls REFUSABLE. Both predate this release (SG-C and 9.59.0), neither is
 * introduced or edited by it, and fixing them means changing what the offer's
 * `grantable` set MEANS — a design change, not a sentence repair. It is named
 * here so the gap is on the record instead of hiding behind a green suite.
 */

/**
 * WHERE the string is delivered, and HOW LONG it lives — see the header. Both
 * are stated by the caller because neither can be inferred from the other.
 */
export interface Surface {
  readonly channel: 'tool-result' | 'tool-description' | 'injected-turn' | 'system-text';
  readonly lifetime: 'persistent-history' | 'request-ephemeral';
}

/**
 * Any tool result. Persistent by construction: the dispatch loop writes it onto
 * a `role: 'tool'` message and every later call in the turn re-reads it.
 */
export const TOOL_RESULT: Surface = {
  channel: 'tool-result',
  lifetime: 'persistent-history',
};

/**
 * The `read_skill` description composed from a graph OFFER.
 *
 * Ephemeral for a reason with an enforcement point, not by convention:
 * `.skillGraph()` throws under `reactMode: 'classic'` (AgentBuilder), and
 * classic is the only mode that caches the tools slot — so a description
 * carrying an offer was composed for the request the model is answering. A tool
 * description on a CACHED slot would be `'persistent-history'`, and naming this
 * constant after the graph rather than after the channel is what keeps the two
 * cases apart.
 */
export const GRAPH_TOOL_DESCRIPTION: Surface = {
  channel: 'tool-description',
  lifetime: 'request-ephemeral',
};

/**
 * The mount kernel's park card, served as a system-prompt fragment.
 *
 * Ephemeral with a behavioural proof rather than a convention: the injection
 * engine rebuilds `activeInjections` on every pass and appends the card from
 * THAT pass's freshly-advanced engagement state, so a pass on which nothing is
 * parked carries no card at all — `test/maps/park-is-visible.test.ts` pins the
 * re-engaged pass having none. Nothing re-reads a previous pass's prompt.
 *
 * And it still failed on registration, which is the point of separating the
 * two dimensions. The row it tripped (`right now`) carries no `provableWhen`,
 * because its falsifier is not staleness on re-read — it is COMPOSE ORDER. The
 * card is written in the injection-engine subflow; the tools slot that acts on
 * the park runs after it. An ephemeral surface may report the present; it still
 * may not report a wire that does not exist yet.
 */
export const PARK_CARD: Surface = {
  channel: 'system-text',
  lifetime: 'request-ephemeral',
};

/**
 * A turn this library writes in a person's voice and appends to `history` —
 * the budget wrap-up instruction, the stepped-skill nudge, the window drop
 * notice, the corrections.
 *
 * Persistent for the same reason a tool result is, and the reason is worth
 * stating because the channel invites the opposite guess: an injected turn is
 * appended to `scope.history` exactly as a tool result is, so it is re-read on
 * every later call of the turn — including a schema retry or an evidence
 * recheck that arrives after the condition it describes has passed.
 */
export const INJECTED_TURN: Surface = {
  channel: 'injected-turn',
  lifetime: 'persistent-history',
};

/**
 * One banned clause: a shape a model-facing sentence may not have, and the
 * reason a later call falsifies it.
 *
 * The exemption is a DISCRIMINATED UNION, not two optional fields, because
 * the old shape documented `exemptBecause` as required and enforced nothing:
 * a row could carry `provableWhen` with no argument at all and the compiler
 * was happy. An exemption with no argument is how a false sentence gets waved
 * through, so a row now either carries BOTH or NEITHER, and the compiler is
 * the one saying so — proven in
 * `test/type-regressions/ModelFacingClaims.assignability.test.ts`, since the
 * root `tsconfig.json` excludes `test/` and an assertion of this kind is inert
 * anywhere else. (`test/modelFacingSurfaces.test.ts` asserts the two are
 * non-empty as well — a union cannot catch `exemptBecause: ''`.)
 */
export type BannedClause = {
  readonly re: RegExp;
  /** How a later call falsifies it. Printed on failure, so it teaches. */
  readonly why: string;
} & (
  | {
      /** Lifetimes where the clause IS provable. */
      readonly provableWhen: readonly Surface['lifetime'][];
      /** Why the exemption holds — the argument, in prose. */
      readonly exemptBecause: string;
    }
  | { readonly provableWhen?: undefined; readonly exemptBecause?: undefined }
);

/**
 * The rules, LITERALS FIRST and SHAPES AFTER.
 *
 * The literals are the exact wordings that shipped. They are kept because a
 * regression to a sentence that once escaped should fail by name — but a list
 * of past wordings only ever catches the past. Fifteen plausible forward-
 * looking sentences were written out and put through the literals-only list,
 * and THIRTEEN of them passed it: "You are currently in 'alpha'", "Calling
 * read_skill switches you to beta", "The following tools are available to you:
 * …", "Nothing is live in this scope at the moment." Every one of them is the
 * same defect as the sentences the literals name, wearing different words.
 * (The fifteen are in `test/modelFacingSurfaces.test.ts`, run against the rules
 * as they stand — so a row narrowed to let one of them through fails there.)
 *
 * So the rows below the literals judge SHAPE: the grammar a claim has when it
 * is about the present rather than about one finished call. They are coarse on
 * purpose — a rule that tried to decide which clause an adverb governs would
 * be parsing English — and the repair they ask for is always the same one, the
 * one every repaired producer in this tree has converged on: say what was true
 * on a NAMED call, in the past tense.
 */
export const BANNED_CLAUSES: readonly BannedClause[] = [
  { re: /Go ahead and act/, why: 'exhortation: the wrap-up call dispatches no tool at all' },
  {
    // Generalised from the round-3 literal: any claim about what `read_skill`
    // WOULD DO from here. This is the clause that escaped into the description.
    re: /\bmoves you\b|\btakes you to\b/i,
    why:
      "read_skill effect prediction: 'rails' refuses every model hop, 'guard' refuses every " +
      'hop off an outstanding menu, and the wrap-up dispatches no tool at all',
  },
  {
    re: /These activate without moving you/,
    why: 'open-skill offer: no call may be left to take it up',
  },
  {
    re: /budget is spent|no further tool call will run/,
    why: 'a budget read at compose time is a claim about a call that has not happened',
  },
  {
    // Case-insensitive since 9.86.0: `describeOffer` writes the phrase as a
    // LINE HEADER ("Reachable from here:"), and a header is exactly the form
    // that gets lifted into a result when somebody reuses the offer text.
    re: /reachable from here|a MOVE from here/i,
    why: 'reachability is cursor-relative, and a sibling tool can move the cursor',
    provableWhen: ['request-ephemeral'],
    exemptBecause:
      "a string rebuilt from THIS request's cursor and never re-read cannot carry the " +
      'staleness this row names. (The separate posture/re-engagement falsifier is the ' +
      "documented gap in this file's header — it is not this row.)",
  },
  { re: /right now|\bon this call\b/, why: 'present-tense claim about a wire not yet composed' },
  {
    // The present-tense INVENTORY — a CENSUS of what exists, as distinct from
    // the row above, which catches a claim about what will ride the wire.
    //
    // Phase 1 anchored the EMPTY arm of two ternaries ("Nothing was live … when
    // you made that call") and left the stocked sibling three lines away in
    // both files, because no row here matched its shape: it names no wire and
    // forecasts no call, it just publishes a list in the present tense. That is
    // its own falsifiable claim, and it is falsified in BOTH directions.
    //
    // Fires on the BARE form only. An inventory that names the call it was
    // taken for ("… were live in this run's scope when you made that call: …")
    // says the same thing without the claim, which is the repair, not an
    // escape from the row.
    re: /\b(?:refs?|artifacts?|files?) in scope\b/i,
    why:
      'present-tense inventory on a persistent result: an artifact scope is swept and ' +
      'restocked between calls, so a census composed for one call is BOTH stale (a ref it ' +
      'names may be gone) and short (a ref minted since is missing) by the time the model ' +
      're-reads it — bind the list to the call it was taken for, as the empty arm of the ' +
      'same refusal already does',
  },
  {
    // Widened in 9.86.1: the contraction and an optional noun ("You're in
    // 'alpha'", "You are in skill 'alpha'", "Your current skill is 'alpha'")
    // walked past a row that required the quote right after `in `.
    re: /You(?:'re| are)(?: already| currently)? in (?:(?:the |skill |the skill )?)'|Your current skill is '/,
    why: 'present-tense cursor claim: the read_skill description owns the present tense',
    provableWhen: ['request-ephemeral'],
    exemptBecause:
      "a string recomposed for one request, from that request's own cursor, is a report of " +
      'the present rather than a forecast — and it is the positive signal the whole fix ' +
      'exists to deliver',
  },
  { re: /\bcallable\b|\byou can call\b/, why: 'capability prediction' },
  {
    re: /the call you just made/,
    why: 'deictic anchor: re-read four calls later it denotes the wrong call',
  },
  {
    // The CONTAINER DEICTIC — a third shape, and neither of the two above.
    //
    // The wire row catches a forecast about a call that has not happened. The
    // inventory row catches a census that goes stale in both directions. This
    // one is neither: `this session`, `this run`, `this conversation` all
    // RESOLVE, and they go on resolving to the same thing on every re-read —
    // there is exactly one of each and it does not move. Nothing here is
    // stale. The defect is that the anchor holds MORE than the sentence
    // describes. A session contains every call of the turn, so a per-call
    // report anchored to it ("staged into this session before your code ran:
    // dataset") is a true sentence about a container, offered in place of the
    // one fact the model needs — WHICH call it is about. Two staged calls
    // leave two such lines in `history`, differing only in the names they
    // list, and a model re-reading them can conclude both files are present.
    //
    // So the row fires on a string that names NO call at all, and stands down
    // the moment one is named — which is the repair all three producers have
    // converged on: "when you made that call" (present), "when that call was
    // refused" (wants), "the <tool> call this result answers" (the code
    // runner). Order-independent, because the anchor is written before the
    // deictic as often as after it.
    //
    // Coarse, and deliberately so. From text alone the only judgeable question
    // is whether a call is named anywhere; a per-call report that names none
    // is the entire class. A row that tried to decide WHICH clause an anchor
    // governs would be parsing English, and would fail closed on the sentences
    // it exists to bless.
    re: /^(?![\s\S]*(?:that call|call this result answers))[\s\S]*\bthis (?:session|run|conversation)\b/i,
    why:
      'container deictic with no call named: `this session` / `this run` / `this ' +
      'conversation` resolve — and go on resolving — but they hold every call of the turn, ' +
      'so a per-call report anchored to one of them cannot say which call it describes. Two ' +
      'such results in one `history` differ only in their payloads, and neither is ' +
      'attributable. Name the call the result answers, as the sibling arms already do',
    provableWhen: ['request-ephemeral'],
    exemptBecause:
      'the falsifier is attribution AMONG SIBLINGS, and an ephemeral string has none: it is ' +
      'composed for one request, read once, and never joined in `history` by a second copy ' +
      'of itself carrying different data. `this session` read there denotes the only session ' +
      'the reader is in. The tree makes the distinction concrete inside ONE file: the very ' +
      "module that writes the result this row catches also writes `codeRunnerTool`'s tool " +
      'description, "their data is written into this session as files BEFORE your code ' +
      'runs" — the same words, and true, because a description states the MECHANISM instead ' +
      "of reporting one call, and it rides the request's `tools` array rather than landing " +
      'in `history` to be re-read beside a later copy of itself',
  },
  {
    re: /\bis withheld\b|\bare withheld\b/,
    why: 'present-tense hold-out claim: hold-outs advance',
  },

  // ── SHAPES (9.86.0) — the same defects, without their wordings ──────────

  {
    // PRESENT-TENSE COPULA + CAPABILITY NOUN. The census shape: not a claim
    // about what a call will do, and not a deictic — just "X is/are <on the
    // wire>", asserted flat. It is the shape of every inventory the library
    // serves: tools, skills, refs, maps, runs.
    //
    // Falsified by the wire itself. The tools array, the graph's reachable
    // set, the artifact scope and the mounted maps are all recomposed per
    // request, so the sentence is re-read on a later call beside a wire that
    // no longer matches it — and it reads as a DENIAL of a capability that is
    // on the wire, or an OFFER of one that is not.
    // Widened in 9.86.1 to the nouns real producers use for the same census
    // (`enabled`, `mounted`, `offered`, `in scope`, `off the wire`, `yours to
    // use`), the passive `have been withheld`, and the auxiliary-less
    // "Skills you can reach: …" — a probe of seventeen forecast sentences
    // found six of them walking past the six-noun list.
    re: /\b(?:is|are) (?:available|active|loaded|live|on the wire|off the wire|reachable|enabled|mounted|offered|in scope|yours to use)\b|\b(?:has|have) been withheld\b|\b(?:you can|you may) (?:reach|use|call)\b/i,
    why:
      'present-tense capability census: tools, skills, refs and maps are recomposed for every ' +
      'request, so a flat "is/are available|active|loaded|live|on the wire|reachable|enabled|' +
      'mounted|offered|in scope" is read later beside a different wire — bind it to the call ' +
      'it was taken for, in the past tense',
    provableWhen: ['request-ephemeral'],
    exemptBecause:
      "a string recomposed for the request being answered, from that request's own wire, is a " +
      'REPORT of what that request carries rather than a forecast about a later one — the ' +
      'ground the cursor row above already stands on, and the reason the `read_skill` ' +
      'description is allowed to publish a catalog at all',
  },
  {
    // DEICTIC-PRESENT ADVERBS. Distinct from the copula row: the adverb does
    // not name a capability, it points at a MOMENT — and the moment it points
    // at is the moment of READING, which the composer cannot see. "Now" is
    // whenever the model looks.
    //
    // No exemption, deliberately, and the file already takes this stance on
    // the `right now` literal above: an ephemeral surface may report the
    // present, but it reports it as the state of a named pass or a named call
    // ("when that call was made", "on that pass"), not by pointing. The repair
    // is the anchor, and it is available on every surface — so an exemption
    // here would buy nothing but the shape it exists to catch.
    re: /\b(?:currently|at the moment|right now|now)\b/i,
    why:
      'deictic present: `currently` / `now` / `at the moment` denote the moment the sentence ' +
      'is READ, which is not the moment it was composed — on a persistent surface that is a ' +
      'later call, and on any surface it is a moment the composer cannot check. Name the pass ' +
      'or the call instead ("when that call was made")',
  },
  {
    // SECOND-PERSON EFFECT VERBS. The generalisation of `moves you` — the
    // clause that escaped into the description in round 3. Any claim that a
    // named call WILL DO something to the reader is a forecast the gate can
    // refuse: `'rails'` refuses every model hop, `'guard'` refuses every hop
    // off an outstanding menu, a role filter can hide the destination, and
    // the wrap-up call dispatches no tool at all.
    //
    // Widened in 9.86.1 to the future and modal forms — "will move you",
    // "would take you", "can switch you", "to bring you" — which are the
    // plainest way to write the forecast and matched nothing in 9.86.0.
    re: /\b(?:switches|moves|brings|activates|takes|grants) you\b|\b(?:will|would|can|could|shall|may|to) (?:switch|move|bring|activate|take|grant) you\b/i,
    why:
      'second-person effect prediction: the posture, the role filter and the budget all sit ' +
      'between the model and the effect claimed, and each of them can refuse it',
  },
  {
    // A HEADED INVENTORY. "Available tools: calc, probe." and "Tools you
    // have: calc, probe." are the copula census with the verb elided — a
    // label, a colon, a list — and no copula row can see them. Same
    // falsifier, same repair: name the call the list was taken for.
    re: /(?:^|\n)\s*(?:Available|Your|The following|Current(?:ly)? available) (?:tools?|skills?|maps?|refs?)\b[^\n:]*:|(?:^|\n)\s*(?:Tools?|Skills?) you (?:have|can (?:use|call|reach))\s*:/i,
    why:
      'headed inventory: a label-and-colon list of what is on the wire is the capability census ' +
      'with its verb elided, re-read later beside a different wire — bind the list to the call ' +
      'it was taken for',
    provableWhen: ['request-ephemeral'],
    exemptBecause:
      'the same argument as the copula row: a list composed from the request being answered is ' +
      'a report of what that request carries, and is never re-read beside a later wire',
  },
  {
    // A CAPABILITY FORECAST ABOUT THE NEXT CALL. "the next call will not run
    // a tool", "cannot be retried this turn", "will not change during this
    // run" — a claim about what a LATER call will or cannot do, which is the
    // denial class in its purest form: the budget, the wire and the checker
    // all move between this sentence and the call it forecasts.
    re: /\b(?:the )?next call will\b|\bcannot be (?:retried|called|used|reached)\b|\bwill not (?:run|change|be (?:offered|available|reachable))\b/i,
    why:
      'forecast about a later call: the wire, the budget and the checker are decided at request ' +
      'assembly, so what a call after this one will or cannot do is not a fact the composer holds',
  },
  {
    // THE BARE CALL DEICTIC. `on this call` is banned above as a literal;
    // the bare `this call` walked past it in both 9.86.0 frames ("exhausted
    // before this call", "This call was for running them") and in a trace
    // result ("this call may be one of them"). A frame written into
    // `history` is restored verbatim by `applyContinuation`, and on the next
    // turn a model resolves "this call" to the call it is answering — which
    // has the full tool list. Same exemption shape as the container deictic:
    // on an ephemeral surface there is exactly one call the phrase can mean.
    re: /\bthis call\b/i,
    why:
      'bare call deictic: `this call` denotes whichever call re-reads the sentence, and on a ' +
      'persistent surface that is a later call with a different wire — name the call ("the ' +
      'wrap-up call this message opened", "call \'c1\'") instead of pointing at it',
    provableWhen: ['request-ephemeral'],
    exemptBecause:
      'a string composed for one request and never re-read has exactly one call it can mean, ' +
      'and a tool description saying "on this call" is describing the request that carries it',
  },
  {
    // STANDING IMPERATIVES TO THE MODEL, at a clause start only.
    //
    // A tool result is composed once and re-read on every later call of the
    // turn, wrap-up included. An imperative there is not advice about the call
    // that produced it — it is an ORDER that outlives its conditions, and the
    // model obeys it on a call where the tool it names is off the wire or the
    // budget is spent. "Pick one of these, or finish" was exactly this, and it
    // cost a refusal to discover.
    //
    // Anchored to clause starts (string start, or after `. ! ? : ; —` or a
    // newline) so the row fires on the imperative MOOD and not on the words:
    // "Tool names that resolved to an implementation on that call" keeps its
    // `call`, and
    // "no rule can Use…" is not a sentence anybody writes. Case-sensitive for
    // the same reason.
    re: /(?:^|[.!?:;—]\s+|\n\s*)(?:Do not|Pick one|Call|Use)\s/,
    why:
      'standing imperative: a persistent surface is re-read on every later call, so an order ' +
      'composed under one set of conditions is obeyed under conditions that refuse it — ' +
      'report what the finished call did and leave the next call to the surfaces that are ' +
      'recomposed for it',
    provableWhen: ['request-ephemeral'],
    exemptBecause:
      'an instruction that rides ONE request — a tool description in the `tools` array of the ' +
      'request being answered, a system-prompt fragment rebuilt for it — is spent when that ' +
      'request is answered ' +
      'and is never re-read under conditions it did not name. That is what a tool description ' +
      'is FOR: it says how to use the tool being offered, on the request offering it. The same ' +
      'words become a standing order the moment they land in `history`',
  },
];

/**
 * Every banned clause the text contains, with the reason it is unprovable where
 * this string lives. `[]` is the only passing answer.
 *
 * Judged on `surface.lifetime`; `surface.channel` rides the message so a red
 * suite names the producer to open.
 */
export function unprovable(text: string, surface: Surface): string[] {
  return BANNED_CLAUSES.filter(
    (row) => row.re.test(text) && !(row.provableWhen ?? []).includes(surface.lifetime),
  ).map((row) => `[${surface.channel}] ${row.re.source} — ${row.why}`);
}

/**
 * Every skill id the text names other than the cursor it is about.
 *
 * A property of TOOL RESULTS: the notice speaks about one finished call and has
 * no business naming a destination, because any id it names is a prediction the
 * posture, the budget or a hidden-id filter can falsify. The DESCRIPTION names
 * ids by design — the catalog is its job — so this is not the property to check
 * there; {@link hiddenIdsNamed} is.
 */
export function foreignIds(text: string, cursor: string, all: readonly string[]): string[] {
  return all.filter((id) => id !== cursor && text.includes(id));
}

/**
 * Every hidden id the text names — the property `hiddenIds` exists to enforce.
 *
 * The description's own law (`describeOffer`): "Hidden first, so nothing below
 * can name one." Not as reachable, not as refusable, not as the menu's cursor,
 * and — the 9.84.0 regression — not as the skill the model is standing in.
 */
export function hiddenIdsNamed(text: string, hidden: readonly string[]): string[] {
  return hidden.filter((id) => text.includes(id));
}
