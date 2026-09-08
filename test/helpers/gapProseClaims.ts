/**
 * ONE list of the shapes a GAP SENTENCE may not have, and the reason each one
 * can be made false by an edit nobody makes to the sentence (9.88.0).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * `SERVED_GAPS[k].why` and `UNGAPPED_FIELDS[k]` are sentences a renderer prints
 * beside a rebuilt request. They are frozen into a constant, composed once, and
 * then read against every later version of the code they describe. One of them
 * shipped as:
 *
 *   "This epoch minted no receipt, so nothing checks the rebuilt view. THREE
 *    causes and none of them is a hole in this view: …"
 *
 * A fourth path was then added — a value under the receipt key refused because
 * it is not a receipt shape — and BOTH halves went false at once: four causes,
 * and that one IS a hole. Nobody edited the string. Nobody had to.
 *
 * Five review rounds each found NEW false prose in the sentences the previous
 * round had just written, at a roughly constant rate. That is not carelessness;
 * it is the law this tree already named in 9.84–9.86 — A SENTENCE COMPOSED ONCE
 * AND READ MANY TIMES IS A PREDICTION — one surface over. `modelFacingClaims.ts`
 * judges a sentence a MODEL re-reads on a later call. This file judges a
 * sentence a PERSON re-reads against a later version of the code, which is the
 * same falsifier with a slower clock and no error message.
 *
 * ── THE LAW, AS OF THE SIXTH ROUND ────────────────────────────────────────
 *
 * The rule used to permit a MECHANISM clause — "the fold had no base for this
 * epoch's log", "no receipt was found for this epoch" — and five rounds tried
 * to write those truthfully. The rate of new falsehoods did not fall. The
 * sixth round applied one question to all ten printed sentences — COULD THIS
 * BECOME FALSE WITHOUT ANYONE EDITING IT? — and nine could, two of them being
 * false the day they shipped. Exactly one could not:
 *
 *   UNGAPPED_FIELDS.gaps — "The account itself rather than a fact about the
 *   request: a gap naming this list would be the account excusing its own
 *   absence."
 *
 * It survives because it makes NO CLAIM ABOUT CODE. It says what the field
 * MEANS inside the account, and nothing outside the sentence can falsify it.
 * Every other sentence described a mechanism, and a mechanism is code, and
 * code moves. So the conclusion is not to write them better. It is to STOP
 * WRITING THEM.
 *
 * A PRINTED gap sentence may now say only:
 *
 *   1. WHICH FIELDS it covers;
 *   2. WHAT THEY MEAN ON THIS VIEW for the person reading — unproven, possibly
 *      short, absent-means-unknown, unchecked against what went out;
 *   3. WHAT TO DO DIFFERENTLY because of that.
 *
 * It may NOT name a module, a function, a key, a version, a chart, a strategy,
 * an option, or any mechanism at all — not `initialState`, not "the fold", not
 * "the cache strategy", not "recomposed from". If a sentence needs one of
 * those words to be understood, it is explaining WHY the gap exists, which is
 * not the printed sentence's job. None of it is lost: the mechanism goes into
 * the code comment beside the entry, where a maintainer reads it and review
 * catches its rot; the cause is already data (`ServedGap.cause`); and the docs
 * may explain the mechanism at length, because a doc is versioned with the
 * code and its reader can open the file.
 *
 * WHAT THAT BUYS — and the sixth round claimed more for it than it is worth,
 * which the seventh round measured and this header now states. The claim was:
 * a sentence with no code claim in it cannot go false when the code changes,
 * so the reduction ENDS the class. It does not. Checked sentence by sentence
 * against real runs, TEN of the eleven reduced sentences still make a claim a
 * code edit falsifies — "may be SHORT", "absent means unknown", "the tool list
 * is complete and the schemas are one short" are all claims about how the
 * rebuild behaves. Exactly one is claim-free, `UNGAPPED_FIELDS.gaps`, and it is
 * claim-free because it is SELF-REFERENTIAL — a statement about what its field
 * is inside the account. The other ten cannot copy that shape, because a
 * sentence that tells a reader something USEFUL is a claim about the rebuild.
 * The reduction changed the VOCABULARY of the claims, not their CLASS.
 *
 * What the reduction really buys is two smaller things, and they are worth the
 * rows on their own: the sentences are SHORT AND READABLE, and the enumerations
 * that went false in five rounds have nowhere to come back through. It also
 * makes the rule ENFORCEABLE — the fifth round's four rows were PHRASING-shaped
 * and near-synonyms walked straight through them, while a rule that admits no
 * code-shaped token and no mechanism verb is NEARLY A WHITELIST, and a
 * whitelist has no synonyms.
 *
 * WHAT ACTUALLY CLOSES THE CLASS is one file over:
 * `test/lib/time-travel/gap-sentences.test.ts` drives a real run per catalogue
 * entry and ASSERTS WHAT THE SENTENCE CLAIMS about the view it raises. That is
 * how the seventh round found a BRAND-NEW false sentence inside the round
 * written to end false sentences — `no-run-log` claimed fields "could not be
 * fully recovered" where, measured, nothing was lost at all. No row here caught
 * it; a run caught it. This checker judges SHAPE, that file judges TRUTH, and
 * neither substitutes for the other.
 *
 * ── WHERE THE ENUMERATION WENT INSTEAD ────────────────────────────────────
 *
 * It was PROSE DOING DATA'S JOB. A frozen constant cannot know which cause
 * applied at the site it is printed beside, so it listed every cause it could
 * think of and hoped. The discriminating fact is now computed where it is known
 * and carried as a field — `ServedGap.cause` — which is the "one fact, one
 * owner" move that fixed the `read_skill` refusals in 9.86. A checker cannot
 * enforce that half; it can only make the prose stop pretending to do it.
 *
 * ── TWO SURFACES, AND WHY THE STRONG ROWS STAND DOWN ON ONE OF THEM ───────
 *
 *   reader: 'printed-with-the-gap'  — the frozen `why` and the `UNGAPPED_FIELDS`
 *                       reasons. Printed beside a trace by a renderer, to a
 *                       reader with no way to check them and no reason to
 *                       suspect them. This is the near-whitelist surface: the
 *                       two REDUCTION rows fire here and nowhere else.
 *   reader: 'prose-doc' — the `why` cell of the gap table in `README.md` and in
 *                       the docs site, which restate the same catalogue for a
 *                       reader who is not in the source.
 *
 * Three rows are exempt on `'prose-doc'` — the two reduction rows and the older
 * cross-module row — and the decision itself scopes them that way: a DOC SHOULD
 * NAME THE MECHANISM. That is what a doc is for; it is versioned in the same
 * tree as the code it names, and its reader can open the file it points at. The
 * falsifier of a printed sentence is that nobody who changes the mechanism ever
 * sees it. The other three rows do NOT stand down: a count of causes, a
 * benignity verdict and a "you can tell which" go stale in a doc exactly as they
 * do in a constant, and both doc copies shipped the same "Three causes" sentence
 * the constant did — which is why judging the docs is worth the parser it costs.
 *
 * ── WHAT THIS CHECKER DOES NOT COVER, SAID OUT LOUD ───────────────────────
 *
 *   • THE ONE THING THAT MATTERS MOST. A sentence can pass every row and be
 *     plain English that names nothing and is simply WRONG ABOUT WHAT THE
 *     FIELDS MEAN. "Absent means unrecovered, not unused" passed every row and
 *     was measured false on the ordinary view that prints it. No shape test
 *     reaches that. What reaches it is a run:
 *     `test/lib/time-travel/gap-sentences.test.ts` asserts each sentence's
 *     claim against a real view, and that file — not this one — is why the
 *     class is closed. A person reading the sentence against the field is still
 *     what writes the assertion; the reduction makes that reading cheap.
 *   • THE HONEST LIMIT OF THE WHOLE ARRANGEMENT: a claim nobody wrote an
 *     assertion for. `gap-sentences.test.ts` partitions every sentence into
 *     clauses and guarantees each clause a test; nothing guarantees the test
 *     is as STRONG as the clause. An assertion can pin one pairing where the
 *     sentence quantifies over all of them, or one chart shape where the
 *     sentence covers two. That narrowing is invisible to this checker and to
 *     the partition alike; only a person comparing clause to assertion sees
 *     it, and docs/design/2026-09-recorded-not-built.md entry 10 lists the
 *     instances known today.
 *   • It reads TEXT, so it also cannot see a gap naming a field whose absence
 *     its own mechanism does not cause. That is what four of the five earlier
 *     rounds found, and the walk's field-by-field damage half is what measures
 *     it.
 *   • A BARE capitalised word (`Agent`, `Receipt`) is indistinguishable from a
 *     sentence-initial word, so no row can see one. The code-shape row sees a
 *     dotted path, a `*.ts` file, a call, camelCase, two-hump PascalCase, a
 *     SCREAMING_SNAKE identifier, a quoted option token and a version number.
 *     A bare capital walks past it — and so does a bare lowercase word:
 *     `forced-tool-schema` once shipped "its NAME is on the record (seed
 *     commits it)" and passed every row, because `seed` is spelled like an
 *     English word. The MECHANISM-VERB row is the answer to that half: `seed`
 *     as a verb, and nine others, are refused by name. The list is closed and
 *     small on purpose — a big one would start refusing English.
 *   • The allowlist for the cross-module row is supplied by the CALLER. It is
 *     now VESTIGIAL on the printed surface, where the code-shape row refuses
 *     every code token whatever the allowlist says; the walk passes `[]` and
 *     the row still fires. It is kept as the second line of defence, and it is
 *     what would still be standing if the reduction rows were ever loosened.
 *   • `RECEIPT_BOUNDARY` IS judged now. It used to be exempt — two entries
 *     append it verbatim and it is owned in `receipt.ts` — and the exemption
 *     was removed by making the sentence obey the same rule as the entries that
 *     quote it. One string, one rule set.
 *   • The rows are the defect shapes six review rounds actually produced. A
 *     shape nobody has written yet passes, and the repair when one turns up is
 *     a row here rather than a correction to the sentence.
 */

/**
 * WHERE the sentence is read, and by whom — see the header. The site rides the
 * failure message so a red suite names the entry to open rather than only the
 * shape that is wrong.
 */
export interface GapSurface {
  /** Judged. The two surfaces differ in what a reader can do about a pointer. */
  readonly reader: 'printed-with-the-gap' | 'prose-doc';
  /** Carried. The constant key, or the file and row the prose came from. */
  readonly site: string;
}

/** A `SERVED_GAPS[k].why` or an `UNGAPPED_FIELDS[k]` reason. */
export const PRINTED_GAP_PROSE = (site: string): GapSurface => ({
  reader: 'printed-with-the-gap',
  site,
});

/** One `why` cell of a hand-written gap table that restates the catalogue. */
export const DOC_GAP_PROSE = (site: string): GapSurface => ({ reader: 'prose-doc', site });

/**
 * One banned shape, and the reason an edit elsewhere falsifies it.
 *
 * The exemption is a DISCRIMINATED UNION for the reason its sibling in
 * `modelFacingClaims.ts` is one: two optional fields let a row stand down on a
 * whole surface while saying nothing about why, and an argument nobody had to
 * write is an argument nobody wrote. A row carries BOTH or NEITHER, and the
 * compiler is what says so (`test/type-regressions/GapProseClaims.assignability.test.ts`,
 * since the root `tsconfig.json` excludes `test/`).
 */
export type BannedGapClause = {
  readonly re: RegExp;
  /** How an edit elsewhere falsifies it. Printed on failure, so it teaches. */
  readonly why: string;
  /**
   * This row's matches are TOKENS, checked against the caller's allowlist
   * rather than banned outright — the one row where the same shape is the
   * defect in one position and the subject matter in another. A gap that names
   * `cache.transform` is naming a field it covers; one that names
   * `Agent.create(...)` is describing a module it cannot see.
   */
  readonly allowlisted?: true;
} & (
  | {
      /** Surfaces where the shape IS defensible. */
      readonly provableWhen: readonly GapSurface['reader'][];
      /** Why the exemption holds — the argument, in prose. */
      readonly exemptBecause: string;
    }
  | { readonly provableWhen?: undefined; readonly exemptBecause?: undefined }
);

/**
 * A token that names CODE: a dotted path, a `*.ts` file, a call, camelCase, an
 * acronym head (`LLMCall`), two-hump PascalCase (`ServedView`), a
 * SCREAMING_SNAKE identifier (`RECEIPT_KEY`), a quoted option token
 * (`'tool-forced'`), or a version number (`9.88.0`).
 *
 * Deliberately a shape test and not a list of this library's exports: a list of
 * the symbols that appeared in the false sentences would only ever catch the
 * sentences already written, which is the weakness its sibling file records
 * about its own literals.
 *
 * THE UNDERSCORE IS LOAD-BEARING in the SCREAMING_SNAKE row. A bare all-caps
 * word is EMPHASIS, and the reduced sentences use it — "may be SHORT", "the
 * turns that went out are UNKNOWN". Refusing those would be refusing English
 * to catch an identifier, so the row requires the shape only an identifier has.
 */
const CODE_TOKEN_SOURCE = [
  '\\b[A-Za-z_$][\\w$]*\\.ts\\b',
  '\\b[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+\\b',
  '\\b[A-Za-z_$][\\w$]*\\(\\)',
  '\\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\\b',
  '\\b[A-Z]{2,}[a-z][A-Za-z0-9]*\\b',
  '\\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\\b',
  '\\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\\b',
  '[\'"`\u2018\u2019\u201C\u201D][a-z][a-z0-9]*(?:[-_][a-z0-9]+)*[\'"`\u2018\u2019\u201C\u201D]',
  '\\bv?\\d+\\.\\d+(?:\\.\\d+)?\\b',
].join('|');

/**
 * The verbs that describe HOW the record was made rather than WHAT it means.
 *
 * Closed and short on purpose. A long list would start refusing English, and
 * the row is not trying to be a grammar — it is trying to catch the ten words
 * the six rounds of false sentences actually reached for when they explained a
 * mechanism the reader cannot check. Every one of them is a claim about
 * machinery: something folded, committed, minted, assembled or rewritten it.
 *
 * `record` and `recorded` are deliberately ABSENT. "was not recorded" is a
 * statement about what the reader is holding, not about how it got made, and
 * the reduced sentences need it.
 */
const MECHANISM_VERB_SOURCE = [
  'recompos(?:e|es|ed|ing)',
  'fold(?:s|ed|ing)?',
  'commit(?:s|ted|ting)?',
  'mint(?:s|ed|ing)?',
  'bubbl(?:e|es|ed|ing)',
  'assembl(?:e|es|ed|ing|y)',
  'rewrit(?:e|es|ing|ten)',
  'seed(?:s|ed|ing)?',
  'derived from',
  'read off',
].join('|');

/**
 * The rules. SIX shapes: the two REDUCTION rows the sixth round added, which
 * are what makes the printed surface near-whitelist, then the four PHRASING
 * rows the fifth round wrote, kept as the second line of defence.
 *
 * The reduction rows come FIRST so a failure message leads with the rule that
 * actually decides the sentence.
 */
export const BANNED_GAP_CLAUSES: readonly BannedGapClause[] = [
  {
    // CODE SHAPE. Not "a symbol the sentence does not own" — ANY symbol, with
    // no allowlist, because the sixth round's rule is that a printed sentence
    // names no code at all. The row that came before this one let a gap name
    // the fields it covers, which is how `initialState`, `asSent` and
    // `cache.transform` reached a printed sentence: each was argued, and each
    // was a mechanism claim wearing a field's clothes. A sentence says "the
    // fields below"; the FIELD LIST is a separate value and needs no prose.
    re: new RegExp(CODE_TOKEN_SOURCE),
    why:
      'code-shaped token: a printed gap sentence names no module, function, key, option or ' +
      'version — a sentence that describes code is one the next edit to that code can falsify, ' +
      'and nothing rebuilds a frozen constant. Say which fields (as "the fields below"), what ' +
      'they mean on this view, and what to do; put the mechanism in the comment beside the entry',
    provableWhen: ['prose-doc'],
    exemptBecause:
      'a doc names the mechanism because that is what a doc is FOR, it is versioned in the same ' +
      'tree as the code it points at, and its reader can open the file. The falsifier of a ' +
      'printed sentence is that nobody who changes the mechanism ever sees it; a doc paragraph ' +
      'is at least in the diff of the release that changes it',
  },
  {
    // MECHANISM VERB. The half of the reduction a shape test cannot reach: a
    // sentence can name no symbol at all and still be a mechanism claim —
    // "recomposed from the conversation", "the fold could not read", "was
    // never committed". Those are what went false in five rounds while every
    // shape row stayed green. Ten words, closed list, no synonyms to find.
    re: new RegExp(`\\b(?:${MECHANISM_VERB_SOURCE})\\b`, 'i'),
    why:
      'mechanism verb: it describes how the record was MADE, which is code, and code moves. ' +
      'The sentence is read against every later version of that code and nothing rebuilds it. ' +
      'Say what the fields MEAN on this view instead — unproven, short, absent-means-unknown, ' +
      'unchecked — and leave the machinery to the comment beside the entry',
    provableWhen: ['prose-doc'],
    exemptBecause:
      'the same argument as the code-shape row: explaining the mechanism is the job of a doc, ' +
      'and a doc is edited in the same diff as the mechanism it explains',
  },
  {
    // CARDINALITY. "THREE causes", "for two reasons", "the three charts that
    // run no cache strategy". A count of anything in the code is a claim the
    // sentence cannot check and the compiler cannot either: the cause the
    // shipped sentence had never counted was a shape check inside the receipt
    // read, and it made the count false without touching the string.
    //
    // Scoped to counts of CAUSES and of CODE. "one turn of three" counts turns
    // in a rebuilt conversation, which is a fact about the record the sentence
    // is describing rather than a fact about the tree it lives in.
    re: /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:\w+[- ]){0,2}(?:causes?|reasons?|ways?|charts?|stages?|strategies|callers?|places?|paths?|modules?|files?)\b/i,
    why:
      'cardinality claim: how many causes produce a gap, or how many charts or stages behave ' +
      'one way, is decided by code the sentence cannot see. A path added anywhere makes the ' +
      'count false with nobody editing the string — which is exactly how the shipped ' +
      '"THREE causes" sentence became a four-cause sentence',
  },
  {
    // BENIGNITY. "none of them is a hole", "the rebuild is untouched", "this
    // entry is vacuous". A verdict that the situation is harmless is the same
    // prediction as the count, and it went false in the same edit: the fourth
    // cause IS damage, and the sentence had already promised it was not.
    re: /\bnone (?:of them )?is (?:a|an|the)\b|\bnone of them\b|\bneither of them\b|\bnot a (?:hole|defect|bug|problem|failure|loss)\b|\bharmless\b|\bbenign\b|\bnothing (?:is|has gone|went) wrong\b|\bis untouched\b|\bis vacuous\b/i,
    why:
      'benignity verdict: whether a gap is harmless depends on which cause produced it, and a ' +
      'frozen sentence cannot know that. The cause added in this release is the one that means ' +
      'DAMAGE, and the sentence that ruled it out was written before it existed',
  },
  {
    // DISCRIMINATION. "says which", "which of the three it was", and the
    // denial-shaped twin "is not something this gap tells you". Both age the
    // same way: the moment the fact is computed somewhere, the promise is
    // redundant and the denial sends the reader away from the field that holds
    // it. Coarse on purpose — a rule that decided WHICH clause a "which"
    // governs would be parsing English — and the repair is always the same one:
    // name the field that carries the fact, or say nothing.
    re: /\b(?:says?|tells? you|names|shows|reports|indicates) which\b|\byou can tell which\b|\bwhich (?:one|case|of (?:the )?(?:two|three|four|them))\b|\bnot something this gap tells you\b|\bdiscriminates?\b/i,
    why:
      'discrimination claim: a frozen sentence cannot know which cause applied at the site it ' +
      'is printed beside. If a reader is to know, the fact is computed where it is known and ' +
      'carried as a field (`ServedGap.cause`); a sentence promising it, or denying it, is prose ' +
      "doing data's job",
  },
  {
    // CROSS-MODULE. A named symbol inside a printed sentence — `LLMCall`,
    // `Agent.create({ recordReceipt: false })`, `buildReceipt`, `receipt.ts`.
    // Every one of those is a claim about code the sentence does not own, and
    // the sentence is not rebuilt when that code changes. The allowlist is what
    // kept the row from banning the one thing a gap was then allowed to name:
    // the fields it covers, and the key on the record that was missing.
    //
    // SUPERSEDED ON THE PRINTED SURFACE by the code-shape row above, which
    // refuses every code token and consults no allowlist. Kept because a row
    // that is redundant today is the one still standing if the row above it is
    // ever loosened, and because its allowlist is the argument for why the
    // reduction had to go further than it did.
    re: new RegExp(CODE_TOKEN_SOURCE),
    allowlisted: true,
    why:
      'cross-module claim: a printed gap sentence that names a symbol is asserting what another ' +
      'module does, and nothing rebuilds the sentence when that module changes. Name the fields ' +
      'this gap covers and what could not be established about them; leave the mechanism to the ' +
      'comment beside the code, which is edited with it',
    provableWhen: ['prose-doc'],
    exemptBecause:
      'a doc names the mechanism because that is what a doc is FOR, it is versioned in the same ' +
      'tree as the code it points at, and its reader can open the file. The falsifier of a ' +
      'printed sentence is that nobody who changes the mechanism ever sees it; a doc paragraph ' +
      'is at least in the diff of the release that changes it',
  },
];

/**
 * Every banned shape the text has, with the reason it is unprovable where this
 * sentence is read. `[]` is the only passing answer.
 *
 * `allowed` is the vocabulary the cross-module row stands down for — the field
 * paths this gap covers and the keys on the record it names as missing, both
 * with their dotted segments. It is the CALLER's list because only the caller
 * knows which shape the sentence is about; see the header for what a caller
 * that passes too much costs.
 */
export function unprovableGapProse(
  text: string,
  surface: GapSurface,
  allowed: Iterable<string> = [],
): string[] {
  const vocabulary = new Set(allowed);
  const out: string[] = [];
  for (const row of BANNED_GAP_CLAUSES) {
    if ((row.provableWhen ?? []).includes(surface.reader)) continue;
    if (row.allowlisted === true) {
      // The ROW'S OWN regex, run globally — not a second copy of the shape
      // test living in this function, which is how two rules that were meant
      // to be one drift apart.
      const found = [...text.matchAll(new RegExp(row.re.source, 'g'))].map((m) => m[0]);
      const foreign = [...new Set(found)].filter((token) => !vocabulary.has(token));
      if (foreign.length > 0) out.push(`[${surface.site}] ${foreign.join(', ')} — ${row.why}`);
      continue;
    }
    const hit = row.re.exec(text);
    if (hit !== null) out.push(`[${surface.site}] "${hit[0]}" — ${row.why}`);
  }
  return out;
}

/**
 * Every code-shaped token in the text, in order, duplicates included.
 *
 * Exported because the allowlist has to be built against the same shape test
 * that judges it: a caller assembling `allowed` from a field path splits it on
 * `.`, and a segment that is not itself a token would be a permission for
 * nothing.
 */
export function codeTokens(text: string): string[] {
  return [...text.matchAll(new RegExp(CODE_TOKEN_SOURCE, 'g'))].map((m) => m[0]);
}
