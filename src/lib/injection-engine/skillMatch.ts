/**
 * skillMatch — the DATA-matcher domain for skill-graph start rules (SG-A).
 *
 * One module owns everything a matcher is and does, so the three consumers can
 * never drift apart:
 *
 *   • what a matcher IS       — {@link SkillMatch} (author form) and
 *                               {@link SkillMatchData} (serializable description);
 *   • how it RUNS             — {@link compileMatch}: ONE compilation returns the
 *                               predicate that routes AND the data that describes it;
 *   • how two matchers RELATE — {@link compareMatchers}: what the check-up can
 *                               honestly prove (`overlapping-rules` /
 *                               `rules-shadowed-by-order`);
 *   • how it DRAWS            — {@link mermaidMatchCaption}: the entry-edge caption
 *                               `toMermaid()` uses when the author gave no label.
 *
 * Deliberately engine-type-free (the predicate context is structural —
 * `{ userMessage }` — which the engine's `InjectionContext` satisfies), so
 * `skillGraphCheckup.ts` can import it and keep its own "pure over strings"
 * law intact. Imported by `skillGraph.ts` (compile + caption) and
 * `skillGraphCheckup.ts` (data type + compare); imports nothing.
 */

/**
 * A DATA matcher on a start rule — the declarative alternative to a `when`
 * predicate. Two members:
 *
 *   • a `RegExp` — tested against the user's message (`ctx.userMessage`). The
 *     stateful `g`/`y` flags are dropped at compile time (a sticky regex would
 *     alternate its answer across identical messages); the stored provenance
 *     carries the flags that actually run.
 *   • `{ keywords: [...] }` — case-insensitive; the rule matches when ANY keyword
 *     is present. Whole-word where sensible: a `\b` anchor is applied at each edge
 *     of the keyword that is an ASCII word character, so `refund` does not match
 *     "refunds", while `visa card` matches as a phrase and `v2?` matches literally.
 *
 * Being DATA is the point: a predicate is opaque code the library can only run,
 * while a matcher can be COMPARED by the check-up (`overlapping-rules`,
 * `rules-shadowed-by-order`), CAPTIONED by `toMermaid()` on the entry edge, and
 * STORED on the compiled skill's provenance (`metadata.skillGraph.match`, as
 * serializable {@link SkillMatchData}).
 *
 * Extensible by design: each non-RegExp member is an object discriminated by its
 * own required key, so a future matcher (e.g. an intent matcher with examples)
 * is a new arm — not a reshape. A shape that is none of these is refused at
 * build time, naming the forms that ARE supported.
 */
export type SkillMatch = RegExp | { readonly keywords: readonly string[] };

/**
 * The serializable description of a DATA matcher on a start rule (`match:` on
 * `start.rules` / `SkillEntryOptions.match`) — what the check-up compares, what
 * `toMermaid()` captions, and what rides the compiled skill's provenance. Pure
 * strings by design (it has to survive `structuredClone`): a `RegExp` matcher is
 * stored as its `source` + the `flags` that actually run.
 *
 * A discriminated union so a future member (e.g. an intent matcher) is a new
 * `kind` arm, not a reshape.
 */
export type SkillMatchData =
  | { readonly kind: 'regex'; readonly source: string; readonly flags: string }
  | { readonly kind: 'keywords'; readonly keywords: readonly string[] };

/** The one field a compiled matcher reads. Structural on purpose — the engine's
 *  `InjectionContext` satisfies it, and this module never has to import it. */
export interface MatchableContext {
  readonly userMessage: string;
}

/** Escape a literal for splicing into a RegExp source (local twin of the one in
 *  skillContract.ts — both are module-private one-liners over the same idiom). */
function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word where sensible: anchor `\b` only at a keyword edge that is an ASCII
 *  word character, so `refund` does not match "refunds" while `visa card` matches
 *  as a phrase and a punctuation-edged keyword (`v2?`) matches literally wherever
 *  it appears. Case-insensitive. */
function keywordRegExp(keyword: string): RegExp {
  const left = /^[A-Za-z0-9_]/.test(keyword) ? '\\b' : '';
  const right = /[A-Za-z0-9_]$/.test(keyword) ? '\\b' : '';
  return new RegExp(`${left}${escapeRegExpLiteral(keyword)}${right}`, 'i');
}

/**
 * Compile a data matcher into its predicate + its serializable description — ONE
 * compilation, so the predicate that routes and the data the check-up compares can
 * never describe different matchers. Refuses a shape it cannot honor (a JavaScript
 * caller's `{ intent: … }`, a bare string, an empty keyword list), naming the forms
 * that ARE supported — accepting one and matching nothing would be the silent kind
 * of wrong.
 */
export function compileMatch(
  match: SkillMatch,
  where: string,
): { predicate: (ctx: MatchableContext) => boolean; data: SkillMatchData } {
  if (match instanceof RegExp) {
    // `.test` on a /g or /y regex advances `lastIndex`, so the SAME message would
    // alternate match/no-match across iterations. A matcher is a pure yes/no —
    // the stateful flags are dropped, and the stored provenance carries the flags
    // that actually run (never flags that silently do not).
    const re = new RegExp(match.source, match.flags.replace(/[gy]/g, ''));
    return {
      predicate: (ctx) => re.test(ctx.userMessage),
      data: { kind: 'regex', source: re.source, flags: re.flags },
    };
  }
  // A JS caller can pass anything here (null, a string, a bare function) — every
  // unhonorable shape gets the same teaching refusal, never a raw TypeError.
  const keywords =
    match !== null && typeof match === 'object'
      ? (match as { readonly keywords?: unknown }).keywords
      : undefined;
  const usable =
    Array.isArray(keywords) &&
    keywords.length > 0 &&
    keywords.every((k) => typeof k === 'string' && k.trim().length > 0);
  if (!usable) {
    throw new Error(
      `skillGraph: ${where} has a \`match\` this library cannot honor. Supported matchers: ` +
        `a RegExp (tested against the user message), or { keywords: ['refund', …] } — a ` +
        `non-empty array of non-empty strings (case-insensitive; any keyword present ` +
        `matches, whole-word at word-character edges). For any other condition, use ` +
        `\`when: (ctx) => …\`.`,
    );
  }
  const kws = (keywords as string[]).slice();
  const tests = kws.map(keywordRegExp);
  return {
    predicate: (ctx) => tests.some((re) => re.test(ctx.userMessage)),
    data: { kind: 'keywords', keywords: kws },
  };
}

/**
 * Compare two DATA matchers, earlier vs later (declaration order). Returns only
 * what is PROVABLE:
 *   • `'shadows'`  — every message the later matches, the earlier matches too, so
 *     the later can never be chosen (identical regex; earlier keywords ⊇ later's);
 *   • `'overlaps'` — a witness class of messages matches both (a shared keyword),
 *     but each rule also has messages of its own;
 *   • `undefined`  — nothing provable here (different regex sources, a regex vs a
 *     keyword list): say nothing rather than guess.
 * `why` is the human clause the check-up splices into its problem message.
 */
export function compareMatchers(
  earlier: SkillMatchData,
  later: SkillMatchData,
): { relation: 'shadows' | 'overlaps'; why: string } | undefined {
  if (earlier.kind === 'regex' && later.kind === 'regex') {
    if (earlier.source === later.source && earlier.flags === later.flags) {
      return {
        relation: 'shadows',
        why: `uses the identical regex /${earlier.source}/${earlier.flags}`,
      };
    }
    return undefined; // regex intersection is not decided here — only identity is provable
  }
  if (earlier.kind === 'keywords' && later.kind === 'keywords') {
    const a = new Set(earlier.keywords.map((k) => k.toLowerCase()));
    const bList = later.keywords.map((k) => k.toLowerCase());
    const shared = [...new Set(bList.filter((k) => a.has(k)))];
    if (shared.length === 0) return undefined;
    // Matching is ANY-keyword, so "earlier ⊇ later" means every message the later
    // rule matches (it contains one of later's keywords) also matches the earlier.
    if (bList.every((k) => a.has(k))) {
      return {
        relation: 'shadows',
        why: `already matches every keyword of the later rule (${quoteList(shared)})`,
      };
    }
    return {
      relation: 'overlaps',
      why: `both match the shared keyword${shared.length === 1 ? '' : 's'} ${quoteList(shared)}`,
    };
  }
  return undefined; // unlike kinds — not comparable without guessing
}

/**
 * Caption an entry edge with its data matcher, escaped for a mermaid `|…|` label
 * (`|` would end the label early; `"` would open a string — both become mermaid
 * entities). Keywords list at most three, then a count, so a wide router stays
 * readable. Used only when the author gave no explicit `label` — an explicit label
 * always wins, byte-for-byte, exactly as before.
 */
export function mermaidMatchCaption(m: SkillMatchData): string {
  const raw =
    m.kind === 'regex'
      ? `/${m.source}/${m.flags}`
      : m.keywords.length > 3
        ? `${m.keywords.slice(0, 3).join(', ')}, +${m.keywords.length - 3} more`
        : m.keywords.join(', ');
  return raw.replace(/\|/g, '#124;').replace(/"/g, '#quot;');
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"` — local twin of the check-up's own
 *  list formatter (module-private in both homes, same three lines). */
function quoteList(ids: readonly string[]): string {
  const quoted = ids.map((id) => `"${id}"`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}
