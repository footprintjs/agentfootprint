/**
 * Redis's own pattern matcher, ported — so a `SCAN MATCH` test proves
 * something about Redis rather than about our mock.
 *
 * A test double that matches `MATCH` with `pattern.replace(/\*"/g, '.*')` in a
 * RegExp cannot catch a glob-injection bug: it does not implement `?`, does not
 * implement `[a-z]`, and treats a backslash as a regex escape rather than a
 * glob one. The bug being guarded here IS the pattern language, so the double
 * has to speak it.
 *
 * This is a direct port of `stringmatchlen_impl` from Redis `src/util.c`, which
 * is what the server runs for `SCAN MATCH`, `KEYS` and `PSUBSCRIBE`:
 *
 *   • metacharacters are `*`, `?`, `[` and `\`;
 *   • `\` escapes the character after it (`\*` is a literal asterisk);
 *   • `[abc]` / `[^abc]` / `[a-b]` are character classes, and inside one a `\`
 *     escapes too;
 *   • a `]` OUTSIDE a class has no case of its own — it falls through to the
 *     literal comparison, which is why it does not need escaping;
 *   • an unterminated `[` backtracks and is compared literally.
 *
 * The one thing deliberately not ported is the `skipLongerMatches` early-exit,
 * which is a performance guard on pathological patterns and cannot change
 * whether a pattern matches.
 *
 * @see https://redis.io/docs/latest/commands/keys/ — "Use `\` to escape
 *      special characters if you want to match them verbatim."
 */

/** Does `key` match glob `pattern`, exactly as the Redis server decides it? */
export function redisStringMatch(pattern: string, key: string): boolean {
  return match(pattern, 0, key, 0);
}

function match(pat: string, p: number, str: string, s: number): boolean {
  while (p < pat.length && s < str.length) {
    switch (pat[p]) {
      case '*': {
        while (pat[p + 1] === '*') p++;
        if (p + 1 === pat.length) return true; // trailing '*' takes the rest
        for (let at = s; at <= str.length; at++) {
          if (match(pat, p + 1, str, at)) return true;
        }
        return false;
      }
      case '?':
        s++;
        break;
      case '[': {
        p++;
        const negate = pat[p] === '^';
        if (negate) p++;
        let hit = false;
        for (;;) {
          if (pat[p] === '\\' && p + 1 < pat.length) {
            p++;
            if (pat[p] === str[s]) hit = true;
          } else if (pat[p] === ']') {
            break;
          } else if (p >= pat.length) {
            // Unterminated class: Redis rewinds and treats '[' literally.
            p--;
            break;
          } else if (p + 2 < pat.length && pat[p + 1] === '-') {
            let lo = pat.charCodeAt(p);
            let hi = pat.charCodeAt(p + 2);
            if (lo > hi) [lo, hi] = [hi, lo];
            const c = str.charCodeAt(s);
            p += 2;
            if (c >= lo && c <= hi) hit = true;
          } else if (pat[p] === str[s]) {
            hit = true;
          }
          p++;
        }
        if (negate ? hit : !hit) return false;
        s++;
        break;
      }
      case '\\':
        if (p + 1 < pat.length) p++;
      // falls through to the literal comparison
      default:
        if (pat[p] !== str[s]) return false;
        s++;
        break;
    }
    p++;
    if (s === str.length) {
      while (pat[p] === '*') p++;
      break;
    }
  }
  return p === pat.length && s === str.length;
}
