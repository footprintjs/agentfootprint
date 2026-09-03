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
 * `channel` is carried for the inventory and for the failure message, so a
 * failing assertion tells the reader which producer to open rather than only
 * which sentence is wrong.
 *
 * ── EXEMPTIONS ARE LIFETIME CLAIMS, AND THEY HAVE EVIDENCE ────────────────
 *
 * Both exemptions below were written as claims about the `read_skill`
 * DESCRIPTION, and both argued the same thing in prose: that string is rebuilt
 * per request and never re-read. That is a lifetime, so it is expressed as one
 * — and it is derivable rather than asserted. `AgentBuilder.skillGraph` REFUSES
 * `reactMode: 'classic'` at build (the one mode that caches the tools slot),
 * so a graph-composed description cannot exist on a cached slot: every call
 * that has an offer recomposed it. {@link GRAPH_TOOL_DESCRIPTION} carries that
 * evidence, which is why a bare "it's a tool description" is NOT the exemption
 * — a description composed once and cached would be persistent, and the rows
 * below would rightly fail it.
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

interface BannedClause {
  readonly re: RegExp;
  /** How a later call falsifies it. Printed on failure, so it teaches. */
  readonly why: string;
  /**
   * Lifetimes where the clause IS provable, with the reason it is safe there.
   * Empty/absent means banned wherever the string lives.
   */
  readonly provableWhen?: readonly Surface['lifetime'][];
  /** Why the exemption holds. Required alongside `provableWhen` — an exemption
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
    provableWhen: ['request-ephemeral'],
    exemptBecause:
      "a string rebuilt from THIS request's cursor and never re-read cannot carry the " +
      'staleness this row names. (The separate posture/re-engagement falsifier is the ' +
      "documented gap in this file's header — it is not this row.)",
  },
  { re: /right now|\bon this call\b/, why: 'present-tense claim about a wire not yet composed' },
  {
    re: /You are (already )?in '/,
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
    re: /\bis withheld\b|\bare withheld\b/,
    why: 'present-tense hold-out claim: hold-outs advance',
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
  return BANNED.filter(
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
