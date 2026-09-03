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
 * it is an omission a reader can see (there is one import to look for) rather
 * than one they have to notice the absence of.
 *
 * ── WHY THE SURFACE IS AN ARGUMENT AND NOT A DIFFERENT FUNCTION ───────────
 *
 * A clause is provable or not depending on WHEN the string is read, and the two
 * surfaces differ on exactly that:
 *
 *   'tool-result'      — composed on iteration N, written into `history`, and
 *                        re-read by the model on call N+1 AND on every call
 *                        after it, including the tool-less wrap-up. Nothing in
 *                        it may depend on state that moves: the cursor, the
 *                        wire, the budget, the posture's verdict.
 *   'tool-description' — recomposed from scratch on every single request and
 *                        never re-read. Present tense about THIS request's
 *                        cursor is a fact there, not a forecast.
 *
 * Encoding that as `provableOn` keeps the distinction in the one place a reader
 * checks. Deciding it by which suite calls the function is how the sentence got
 * out the first time.
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

/** Where the string will be read — see the header. */
export type Surface = 'tool-result' | 'tool-description';

interface BannedClause {
  readonly re: RegExp;
  /** How a later call falsifies it. Printed on failure, so it teaches. */
  readonly why: string;
  /**
   * Surfaces where the clause IS provable, with the reason it is safe there.
   * Empty/absent means banned everywhere.
   */
  readonly provableOn?: readonly Surface[];
  /** Why the exemption holds. Required alongside `provableOn` — an exemption
   *  without an argument is how a false sentence gets waved through. */
  readonly exemptBecause?: string;
}

const BANNED: readonly BannedClause[] = [
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
    re: /reachable from here|a MOVE from here/,
    why: 'reachability is cursor-relative, and a sibling tool can move the cursor',
    provableOn: ['tool-description'],
    exemptBecause:
      "the description is rebuilt from THIS request's cursor and never re-read, so the " +
      'staleness this row names cannot reach it. (The separate posture/re-engagement ' +
      "falsifier is the documented gap in this file's header — it is not this row.)",
  },
  { re: /right now|\bon this call\b/, why: 'present-tense claim about a wire not yet composed' },
  {
    re: /You are (already )?in '/,
    why: 'present-tense cursor claim: the read_skill description owns the present tense',
    provableOn: ['tool-description'],
    exemptBecause:
      "the description is recomposed on every call from that call's own cursor, so this is " +
      'a report of the present rather than a forecast — and it is the positive signal the ' +
      'whole fix exists to deliver',
  },
  { re: /\bcallable\b|\byou can call\b/, why: 'capability prediction' },
  {
    re: /the call you just made/,
    why: 'deictic anchor: re-read four calls later it denotes the wrong call',
  },
  {
    re: /\bis withheld\b|\bare withheld\b/,
    why: 'present-tense hold-out claim: hold-outs advance',
  },
];

/**
 * Every banned clause the text contains, with the reason it is unprovable on
 * this surface. `[]` is the only passing answer.
 */
export function unprovable(text: string, surface: Surface): string[] {
  return BANNED.filter((row) => row.re.test(text) && !(row.provableOn ?? []).includes(surface)).map(
    (row) => `${row.re.source} — ${row.why}`,
  );
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
