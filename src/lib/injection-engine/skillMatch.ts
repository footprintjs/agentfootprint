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
 * predicate. The two SYNC leaf members:
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
 * The third member (SG-C) is the INTENT matcher:
 *   • `{ intent, examples }` — one sentence naming the intent ("customer wants
 *     a refund") plus ≥1 real user phrasings. Unlike the other two it compiles
 *     to NO message predicate: it cannot answer synchronously, so the entry
 *     carrying it compiles cursor-gated and the matching happens in the
 *     turn-start cascade (the RouteTurn stage), judged by the graph's
 *     configured classifier (`.classify(scorer)` / `start.classify`). A graph
 *     declaring one without a classifier is refused at build.
 *
 * The fourth member (9.20.0) is the CONJUNCTION:
 *   • `{ all: [...] }` — the rule matches only when EVERY member matches ("zone
 *     AND audit-shaped" as data, instead of a lookahead regex nobody can read
 *     back). Members are the SYNC data arms only — RegExp or `{ keywords }`:
 *     an intent inside `all` is refused at build (intents are judged by the
 *     classifier at turn start; they cannot compose into a synchronous AND —
 *     declare a separate intent rule instead). A nested `all` is FLATTENED
 *     (AND is associative, so the flattened form runs identically and the
 *     stored data describes exactly what runs — the same normalize-to-truth
 *     rule that drops a regex's stateful flags). An empty `all` is refused:
 *     it has nothing to check, so it could only surprise.
 *
 * Extensible by design: each non-RegExp member is an object discriminated by its
 * own required key, so a future matcher is a new arm — not a reshape. A shape
 * that is none of these is refused at build time, naming the forms that ARE
 * supported.
 */
export type SkillMatch =
  | RegExp
  | { readonly keywords: readonly string[] }
  | { readonly intent: string; readonly examples: readonly string[] }
  | { readonly all: readonly SkillMatch[] };

/**
 * The serializable description of a DATA matcher on a start rule (`match:` on
 * `start.rules` / `SkillEntryOptions.match`) — what the check-up compares, what
 * `toMermaid()` captions, and what rides the compiled skill's provenance. Pure
 * strings by design (it has to survive `structuredClone`): a `RegExp` matcher is
 * stored as its `source` + the `flags` that actually run.
 *
 * A discriminated union so a future member (e.g. an intent matcher) is a new
 * `kind` arm, not a reshape.
 *
 * The `'all'` arm carries the conjunction's members as `parts`. Compilation
 * GUARANTEES the parts are the leaf sync arms only (`'regex'` / `'keywords'`):
 * an intent member is refused, and a nested `all` is flattened before the data
 * is stored — so every consumer (the check-up's part comparison, the mermaid
 * caption) reads a flat AND of leaves, never a tree.
 */
export type SkillMatchData =
  | { readonly kind: 'regex'; readonly source: string; readonly flags: string }
  | { readonly kind: 'keywords'; readonly keywords: readonly string[] }
  | { readonly kind: 'intent'; readonly intent: string; readonly examples: readonly string[] }
  | { readonly kind: 'all'; readonly parts: readonly SkillMatchData[] };

/** The one field a compiled matcher reads. Structural on purpose — the engine's
 *  `InjectionContext` satisfies it, and this module never has to import it. */
export interface MatchableContext {
  readonly userMessage: string;
}

/**
 * The EVIDENCE a data matcher routed on (9.28.0) — the actual text out of the
 * USER MESSAGE that made the rule true. Recorded on the routing verdict
 * (`turn_routed.witness`, `cursorMove.witness`) so the record can say *because
 * the message said "…"* instead of only *a rule matched*.
 *
 * Three honesty rules, all enforced at capture:
 *   • the text comes from `ctx.userMessage` and nothing else — never a tool
 *     result, never system/assistant prose (a matcher only ever reads the user
 *     message, so this is a property of where it is captured, not a filter);
 *   • it is BOUNDED to {@link WITNESS_MAX_CHARS} characters, ellipsis included
 *     — a `/[\s\S]+/` rule must not paste the whole message into every record;
 *   • runs of whitespace collapse to one space and the ends are trimmed, so a
 *     multi-line match stays one quotable clause. That is the ONLY edit made to
 *     the matched substring, and it is the reason `text` is described as the
 *     matched text rather than the matched bytes.
 *
 * `keyword` is present only for the `{ keywords }` arm: WHICH declared keyword
 * hit, beside the text it hit on (they differ in case, and `text` may carry the
 * phrase's real spacing).
 *
 * A `when` predicate produces NO witness (opaque code — the library cannot know
 * what convinced it), and neither does an intent match (a scorer's evidence is
 * its scores, already recorded). Absent is the honest answer there.
 */
export interface RouteWitness {
  readonly text: string;
  readonly keyword?: string;
}

/** The witness bound — 80 characters, ellipsis included. A record is evidence,
 *  not a transcript. */
export const WITNESS_MAX_CHARS = 80;

/** Normalize + bound one matched substring into witness text. Returns undefined
 *  when nothing quotable is left (a zero-length or whitespace-only match, e.g.
 *  `/^/` — "the message said ''" would be worse than saying nothing). */
function toWitnessText(matched: string): string | undefined {
  const collapsed = matched.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return undefined;
  return collapsed.length > WITNESS_MAX_CHARS
    ? `${collapsed.slice(0, WITNESS_MAX_CHARS - 1)}…`
    : collapsed;
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
 * never describe different matchers. Refuses a shape it cannot honor (a bare
 * string, an empty keyword list, an intent without examples), naming the forms
 * that ARE supported — accepting one and matching nothing would be the silent kind
 * of wrong.
 *
 * The INTENT arm compiles to `predicate: undefined` — it cannot answer
 * synchronously (a classifier judges it in the turn-start cascade), so the entry
 * carrying it is cursor-gated instead of rule-gated. `skillGraph.ts` is the only
 * caller that accepts a predicate-less compile, and it refuses `match: { intent }`
 * when no classifier is configured.
 *
 * The third member of the returned triple is `witness` (9.28.0): the SAME
 * compilation's evidence extractor — given a context the predicate accepted, it
 * returns {@link RouteWitness} (the matched text, bounded). It is a separate
 * function on purpose, so the hot path stays exactly what it was (a boolean
 * `.test`) and the evidence is paid for ONCE per turn, on the rule that actually
 * won. The intent arm has no witness (nothing matched synchronously).
 */
export function compileMatch(
  match: SkillMatch,
  where: string,
): {
  predicate: ((ctx: MatchableContext) => boolean) | undefined;
  data: SkillMatchData;
  witness?: (ctx: MatchableContext) => RouteWitness | undefined;
} {
  if (match instanceof RegExp) {
    // `.test` on a /g or /y regex advances `lastIndex`, so the SAME message would
    // alternate match/no-match across iterations. A matcher is a pure yes/no —
    // the stateful flags are dropped, and the stored provenance carries the flags
    // that actually run (never flags that silently do not).
    const re = new RegExp(match.source, match.flags.replace(/[gy]/g, ''));
    return {
      predicate: (ctx) => re.test(ctx.userMessage),
      data: { kind: 'regex', source: re.source, flags: re.flags },
      // The evidence is the substring the regex actually matched (`m[0]`) —
      // re-run only on the winning rule, on a regex with no stateful flags, so
      // this answer is the same one `.test` gave.
      witness: (ctx) => {
        const m = re.exec(ctx.userMessage);
        if (m === null) return undefined;
        const text = toWitnessText(m[0]);
        return text === undefined ? undefined : { text };
      },
    };
  }
  // A JS caller can pass anything here (null, a string, a bare function) — every
  // unhonorable shape gets the same teaching refusal, never a raw TypeError.
  const shaped = match !== null && typeof match === 'object' ? (match as object) : undefined;
  const all = (shaped as { readonly all?: unknown } | undefined)?.all;
  if (all !== undefined) return compileAllArm(all, where);
  const intent = (shaped as { readonly intent?: unknown } | undefined)?.intent;
  if (intent !== undefined) {
    // The INTENT arm — data for the turn-start classifier, no sync predicate.
    // Both halves required and non-empty: an intent with no examples gives a
    // keyword/embedding classifier nothing a user ever typed to match on, and
    // an example list under a blank intent is a menu row with no name.
    const examples = (shaped as { readonly examples?: unknown }).examples;
    const intentUsable = typeof intent === 'string' && intent.trim().length > 0;
    const examplesUsable =
      Array.isArray(examples) &&
      examples.length > 0 &&
      examples.every((e) => typeof e === 'string' && e.trim().length > 0);
    if (!intentUsable || !examplesUsable) {
      throw new Error(
        `skillGraph: ${where} declares \`match: { intent }\` this library cannot honor. An ` +
          `intent matcher is { intent: 'one sentence naming the intent', examples: ['a real ` +
          `user phrasing', …] } — both required, both non-empty (examples are what the ` +
          `classifier actually matches against). Fix the ${
            !intentUsable ? '`intent` sentence' : '`examples` list'
          }, or use a RegExp / { keywords } / \`when\` instead.`,
      );
    }
    return {
      predicate: undefined,
      data: { kind: 'intent', intent: intent.trim(), examples: (examples as string[]).slice() },
    };
  }
  const keywords = (shaped as { readonly keywords?: unknown } | undefined)?.keywords;
  const usable =
    Array.isArray(keywords) &&
    keywords.length > 0 &&
    keywords.every((k) => typeof k === 'string' && k.trim().length > 0);
  if (!usable) {
    throw new Error(
      `skillGraph: ${where} has a \`match\` this library cannot honor. Supported matchers: ` +
        `a RegExp (tested against the user message), { keywords: ['refund', …] } — a ` +
        `non-empty array of non-empty strings (case-insensitive; any keyword present ` +
        `matches, whole-word at word-character edges) — { all: [...] } (a conjunction: ` +
        `EVERY listed RegExp / { keywords } member must match), or { intent: '…', ` +
        `examples: [...] } (judged by the graph's classifier at turn start; needs ` +
        `\`classify\`). For any other condition, use \`when: (ctx) => …\`.`,
    );
  }
  const kws = (keywords as string[]).slice();
  const tests = kws.map(keywordRegExp);
  return {
    predicate: (ctx) => tests.some((re) => re.test(ctx.userMessage)),
    data: { kind: 'keywords', keywords: kws },
    // Matching is ANY-keyword in declaration order, so the witness names the
    // FIRST keyword that hit — the one the predicate stopped on — plus the text
    // it hit (they differ in case, and a phrase carries the message's spacing).
    witness: (ctx) => {
      for (let i = 0; i < tests.length; i++) {
        const m = tests[i].exec(ctx.userMessage);
        if (m === null) continue;
        const text = toWitnessText(m[0]);
        return text === undefined ? undefined : { text, keyword: kws[i] };
      }
      return undefined;
    },
  };
}

/**
 * The conjunction arm of {@link compileMatch} (9.20.0) — `{ all: [...] }`
 * compiles to ONE predicate ANDing every member with ONE flat data record
 * beside it, in the same single compilation.
 *
 * Three refusals, all teaching, all at build time:
 *   • an EMPTY `all` — nothing to check, so it could only match everything or
 *     nothing, both the silent kind of wrong;
 *   • an INTENT member — an intent is judged by the graph's classifier at turn
 *     start; it has no synchronous answer to AND with. The honest spelling is
 *     a SEPARATE `match: { intent }` rule (rules already compose by order);
 *   • any other shape `all` cannot hold, naming the member forms that work.
 *
 * A NESTED `all` is FLATTENED rather than refused: AND is associative, so
 * `{ all: [a, { all: [b, c] }] }` runs identically to `{ all: [a, b, c] }`,
 * and the stored data describes the form that actually runs — the same
 * normalize-to-truth rule that drops a regex's stateful `g`/`y` flags. Every
 * consumer therefore sees a flat list of leaf parts.
 */
function compileAllArm(
  all: unknown,
  where: string,
): {
  predicate: (ctx: MatchableContext) => boolean;
  data: SkillMatchData;
  witness: (ctx: MatchableContext) => RouteWitness | undefined;
} {
  if (!Array.isArray(all) || all.length === 0) {
    throw new Error(
      `skillGraph: ${where} declares \`match: { all }\` this library cannot honor — \`all\` ` +
        `must be a NON-EMPTY array of matchers that must every one match, e.g. ` +
        `{ all: [/zone/i, { keywords: ['audit', 'sweep'] }] }. An empty \`all\` has nothing ` +
        `to check, so it could only match everything or nothing — both silent surprises. ` +
        `List at least one matcher, or drop the rule.`,
    );
  }
  const predicates: Array<(ctx: MatchableContext) => boolean> = [];
  const witnesses: Array<(ctx: MatchableContext) => RouteWitness | undefined> = [];
  const parts: SkillMatchData[] = [];
  (all as unknown[]).forEach((member, i) => {
    const label = `${where}, \`all\` member ${i + 1}`;
    const memberShaped =
      member !== null && typeof member === 'object' && !(member instanceof RegExp)
        ? (member as {
            readonly intent?: unknown;
            readonly all?: unknown;
            readonly keywords?: unknown;
          })
        : undefined;
    if (memberShaped?.intent !== undefined) {
      throw new Error(
        `skillGraph: ${label} is an intent matcher, which \`all\` cannot hold: an intent is ` +
          `judged by the graph's classifier at turn start, so it has no synchronous answer ` +
          `to AND with a RegExp or keyword test. Declare the intent as its OWN rule — ` +
          `\`{ match: { intent, examples }, use: … }\` beside this one — and keep \`all\` ` +
          `to the sync arms (RegExp / { keywords }).`,
      );
    }
    if (memberShaped?.all !== undefined) {
      const nested = compileAllArm(memberShaped.all, label);
      predicates.push(nested.predicate);
      witnesses.push(nested.witness);
      parts.push(...(nested.data as Extract<SkillMatchData, { kind: 'all' }>).parts);
      return;
    }
    const memberKeywords = memberShaped?.keywords;
    const usableMember =
      member instanceof RegExp ||
      (Array.isArray(memberKeywords) &&
        memberKeywords.length > 0 &&
        memberKeywords.every((k) => typeof k === 'string' && k.trim().length > 0));
    if (!usableMember) {
      throw new Error(
        `skillGraph: ${label} is not a matcher \`all\` can hold. Every member must answer ` +
          `synchronously from the user message: a RegExp, { keywords: ['…', …] } (a non-empty ` +
          `array of non-empty strings), or a nested { all: [...] } (flattened — AND is ` +
          `associative). For an intent condition declare a separate intent rule; for any ` +
          `other logic use \`when: (ctx) => …\` on the rule itself.`,
      );
    }
    const compiled = compileMatch(member as SkillMatch, label);
    // Leaf arms always compile a predicate (only the intent arm does not, and
    // it was refused above).
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    predicates.push(compiled.predicate!);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    witnesses.push(compiled.witness!);
    parts.push(compiled.data);
  });
  return {
    predicate: (ctx) => predicates.every((p) => p(ctx)),
    data: { kind: 'all', parts },
    // A conjunction matched because EVERY part matched, so any part's text is
    // true evidence. The FIRST part that yields quotable text is quoted — the
    // author's leading constraint, deterministically — rather than a stitched
    // sentence no reader could find in their message.
    witness: (ctx) => {
      for (const w of witnesses) {
        const found = w(ctx);
        if (found !== undefined) return found;
      }
      return undefined;
    },
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
 *
 * The `'all'` arm (9.20.0) keeps the same law — claim only what part-coverage
 * proves. An `all` rule matches a SUBSET of each of its parts' messages, so:
 *   • a plain rule EARLIER that provably covers ONE part of a later `all` rule
 *     shadows it (every message the `all` matches satisfies that part, which
 *     the earlier already matches);
 *   • an `all` rule EARLIER shadows a later matcher when EVERY earlier part is
 *     provably covered by some later part — the later only ADDS constraints
 *     (identical part sets are the simplest case).
 * "Provably covers" is same-kind only: an identical regex, or a keyword
 * superset. No `'overlaps'` is ever claimed for a pair involving `all`: a
 * conjunction can be unsatisfiable (`all: [/^a/, /^b/]` matches nothing), so a
 * witness message cannot be asserted from the data — and the ordinary
 * specific-rule-first layout (the `all` rule above its plain fallback) is a
 * DESIGN, not a problem to warn about.
 */
export function compareMatchers(
  earlier: SkillMatchData,
  later: SkillMatchData,
): { relation: 'shadows' | 'overlaps'; why: string } | undefined {
  if (earlier.kind === 'all' || later.kind === 'all') return compareWithAll(earlier, later);
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
  // Unlike kinds — and intent-vs-intent — are not comparable without guessing:
  // two example SETS are not claimed comparable without running the configured
  // scorer, which is `checkupIntents()`'s job (leave-one-out, async). The one
  // provable intent-pair fact — the same example string under two intents — is
  // its own check (`duplicate-intent-example`, skillIntent.ts).
  return undefined;
}

/**
 * Provable coverage between two LEAF matchers: `true` means every message `q`
 * matches, `p` provably matches too (matches(q) ⊆ matches(p)). Same-kind only,
 * mirroring `compareMatchers`' own claims: identical regex (source + runtime
 * flags), or `p`'s keyword set ⊇ `q`'s (any-keyword matching, so a message
 * carrying one of `q`'s keywords carries one of `p`'s). Everything else —
 * different regexes, regex vs keywords — is NOT decided: answer `false` and
 * let the caller stay silent.
 */
function partCoversProvably(p: SkillMatchData, q: SkillMatchData): boolean {
  if (p.kind === 'regex' && q.kind === 'regex') {
    return p.source === q.source && p.flags === q.flags;
  }
  if (p.kind === 'keywords' && q.kind === 'keywords') {
    const pSet = new Set(p.keywords.map((k) => k.toLowerCase()));
    return q.keywords.every((k) => pSet.has(k.toLowerCase()));
  }
  return false;
}

/** Human name for one leaf part, for the `why` clauses (prose, not mermaid —
 *  no entity escaping). */
function describePart(p: SkillMatchData): string {
  if (p.kind === 'regex') return `/${p.source}/${p.flags}`;
  if (p.kind === 'keywords') return quoteList(p.keywords);
  return `(${p.kind})`; // unreachable for compiled parts; honest if hand-built data arrives
}

/**
 * The `compareMatchers` arm for pairs involving an `'all'` conjunction —
 * shadows-only, subset logic (see the honesty notes on `compareMatchers`).
 *
 * A matcher is treated as its constraint list: a leaf is the one-element list,
 * an `all` is its parts. `matches(later) ⊆ matches(earlier)` is PROVEN when
 * every earlier constraint is covered by some later constraint (the later
 * satisfies everything the earlier requires, so it can only be narrower).
 * Intent matchers never participate (no sync match set to reason about).
 */
function compareWithAll(
  earlier: SkillMatchData,
  later: SkillMatchData,
): { relation: 'shadows'; why: string } | undefined {
  if (earlier.kind === 'intent' || later.kind === 'intent') return undefined;
  const earlierParts: readonly SkillMatchData[] =
    earlier.kind === 'all' ? earlier.parts : [earlier];
  const laterParts: readonly SkillMatchData[] = later.kind === 'all' ? later.parts : [later];
  const covered = earlierParts.map((e) => laterParts.find((l) => partCoversProvably(e, l)));
  if (covered.some((c) => c === undefined)) return undefined;
  if (earlier.kind !== 'all') {
    // Plain earlier, `all` later: the later requires a part the earlier already
    // matches, and an `all` rule only matches messages where EVERY part holds.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const witness = covered[0]!;
    return {
      relation: 'shadows',
      why:
        `already matches the later rule's required \`all\` part ${describePart(witness)} — a ` +
        `conjunction only matches messages where EVERY part matches, so its matches are a ` +
        `subset of the earlier rule's`,
    };
  }
  return {
    relation: 'shadows',
    why:
      `requires only what the later rule also requires (every earlier \`all\` part — ` +
      `${earlierParts.map(describePart).join('; ')} — is covered by a later part), so the ` +
      `later rule can only ADD constraints, never escape one`,
  };
}

/**
 * Caption an entry edge with its data matcher, escaped for a mermaid `|…|` label
 * (`|` would end the label early; `"` would open a string — both become mermaid
 * entities). Keywords list at most three, then a count, so a wide router stays
 * readable; an `all` conjunction joins its parts with ` AND ` (parts are always
 * leaves — compilation flattened any nesting). Used only when the author gave no
 * explicit `label` — an explicit label always wins, byte-for-byte, exactly as
 * before.
 */
export function mermaidMatchCaption(m: SkillMatchData): string {
  return plainMatchCaption(m).replace(/\|/g, '#124;').replace(/"/g, '#quot;');
}

/**
 * The UNESCAPED caption — one grammar for naming a matcher, shared by the
 * mermaid label (which escapes it once, at the top) and by prose that quotes a
 * matcher back to its author (`skillExamples.ts`'s messages). Recursion for the
 * `all` arm happens here so the escaping stays a single outer pass.
 */
export function plainMatchCaption(m: SkillMatchData): string {
  return m.kind === 'all'
    ? m.parts.map(plainMatchCaption).join(' AND ')
    : m.kind === 'regex'
    ? `/${m.source}/${m.flags}`
    : m.kind === 'intent'
    ? `intent: ${m.intent.length > 40 ? `${m.intent.slice(0, 40)}…` : m.intent}`
    : m.keywords.length > 3
    ? `${m.keywords.slice(0, 3).join(', ')}, +${m.keywords.length - 3} more`
    : m.keywords.join(', ');
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"` — local twin of the check-up's own
 *  list formatter (module-private in both homes, same three lines). */
function quoteList(ids: readonly string[]): string {
  const quoted = ids.map((id) => `"${id}"`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}
