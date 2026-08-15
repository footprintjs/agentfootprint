/**
 * artifacts/scopePath — the ONE owner of "a scope becomes path segments".
 *
 * Every durable adapter partitions its storage by the scope tuple, and every
 * one of them takes CALLER STRINGS (`tenant`, `principal`, `conversationId`)
 * and turns them into names inside a hierarchy: directories on a filesystem,
 * key prefixes in an object store. That is a traversal surface, and it must
 * be closed the same way in all of them — one encoding, one place, so a
 * hostile tenant cannot be inert on disk and a navigation hop in a bucket.
 *
 * The law, unchanged from the directory adapter that first stated it
 * (9.21.0), now shared rather than copied:
 *
 *   • encode from the FIELD, never from a joined namespace — a tenant
 *     containing `/` must not become two segments;
 *   • `encodeURIComponent` leaves `.` alone, so dots are encoded too:
 *     a tenant of literally `'..'` would otherwise survive as a real
 *     parent-directory hop (`%2E%2E` is a NAME);
 *   • an empty or absent field collapses to `_`, mirroring
 *     `identityNamespace`'s stable layout, so "no tenant" is one shape and
 *     not two — and a field whose VALUE is `_` is escaped away from that
 *     marker, so absence and the tenant named `_` are not one directory.
 *
 * After this, `..`, `/` and `\` arrive as data and land as literals. The
 * adapters assert `isArtifactRef` on the last segment anyway, because
 * "cannot happen" is a claim, not a defence.
 *
 * The encoding is INJECTIVE, per field and therefore per scope: two different
 * scopes never address one directory or one key prefix. `encodeURIComponent`
 * supplies that for every character (it escapes `%`, its own introducer, so
 * an already-escaped-looking value cannot land on the value that produced
 * it); {@link distinctFromAbsent} supplies it for the absence marker, which
 * `encodeURIComponent` passes through untouched because `_` is unreserved.
 *
 * ── Injective is not enough: the NAME has to be case-unambiguous too ─────────
 * Two different strings are two different names only where the namer agrees.
 * macOS/APFS and Windows/NTFS are **case-insensitive by default**, so a scope
 * encoding that is injective as a string can still put two tenants in one
 * directory — which is what this file did until 9.44.0. A tenant of `Acme` and
 * a tenant of `acme` encoded to two distinct segments and landed in one folder,
 * and since the ref is a content address that both scopes then resolve, the
 * neighbour could read, LIST and delete. Reproduced on a stock Mac; the store
 * conformance battery passed all 106 cases in the same process, because it had
 * pairs for separators, absence markers and pre-escaped values, and no pair
 * that differed only in case.
 *
 * So an uppercase ASCII letter is escaped BEFORE `encodeURIComponent`, leaving
 * an output whose every letter is lowercase except the hex digits inside
 * `%XX` escapes, which are always uppercase and can never be preceded by a
 * lone `%` in any other way. No two distinct outputs can differ by case alone,
 * so folding them is not something a filesystem is able to do.
 *
 * The escape is `~`, doubled when it appears in the input — the same
 * escape-the-escape shape `identityNamespace` uses (9.40.0) and for the same
 * reason: it makes a decoder a left inverse, which is what "injective" means
 * when you have to prove it rather than assert it. `~` survives
 * `encodeURIComponent` untouched because it is unreserved.
 *
 * **What re-keys.** Only a scope field containing an uppercase ASCII letter
 * moves. Every all-lowercase field — including one carrying `/`, spaces, dots
 * or non-ASCII — encodes to exactly the bytes it did before, so the ordinary
 * deployment migrates nothing. A field that DID contain an uppercase letter was
 * sharing a directory with its case variants on two of the three major
 * platforms, which is the condition being fixed.
 */

import { distinctFromAbsent, IDENTITY_ABSENT } from '../memory/identity/index.js';
import type { ArtifactScope } from './types.js';

/**
 * `~` → `~~`, then every uppercase ASCII letter → `~` + its lowercase form.
 *
 * Escaping the escape first is what makes this reversible: a decoder reads `~~`
 * as a literal tilde and `~x` as the uppercase of `x`, and never has to guess.
 */
function escapeUppercase(raw: string): string {
  return raw.replace(/~/g, '~~').replace(/[A-Z]/g, (letter) => `~${letter.toLowerCase()}`);
}

/** One RAW tuple field → one inert path/key segment. */
export function scopeSegment(raw: string | undefined): string {
  if (raw === undefined || raw === '') return IDENTITY_ABSENT;
  return distinctFromAbsent(encodeURIComponent(escapeUppercase(raw)).replace(/\./g, '%2E'));
}

/** The three encoded segments of a scope, in the fixed tenant/principal/
 *  conversation order every adapter lays out. */
export function scopeSegments(scope: ArtifactScope): readonly [string, string, string] {
  return [
    scopeSegment(scope.tenant),
    scopeSegment(scope.principal),
    scopeSegment(scope.conversationId),
  ];
}

/**
 * The object-key prefix for one scope: `[<root>/]<tenant>/<principal>/<conversation>/`.
 *
 * Trailing slash included on purpose — it is what makes a prefix listing
 * exact. Without it, scope `c` would also list scope `c2`'s keys, which is
 * the isolation bug this whole module exists to prevent.
 */
export function scopeKeyPrefix(scope: ArtifactScope, root?: string): string {
  const head = root === undefined || root === '' ? '' : `${root}/`;
  return `${head}${scopeSegments(scope).join('/')}/`;
}

/**
 * Validate an operator-supplied key ROOT at construction (the prefix a bucket
 * is shared under). It is not caller data — an operator writes it — so it is
 * not encoded; it is CHECKED, and refused where it would be ambiguous.
 *
 * @param adapter the factory name, for the refusal's first word.
 * @param root    the raw option, or undefined.
 * @returns the normalized root (no leading/trailing `/`), or undefined.
 */
export function normalizeKeyRoot(adapter: string, root: string | undefined): string | undefined {
  if (root === undefined) return undefined;
  if (typeof root !== 'string' || root.trim() === '') {
    throw new TypeError(
      `[artifacts] ${adapter}({ prefix: ${JSON.stringify(root)} }) is not a key prefix. ` +
        `Give it a path segment (e.g. 'artifacts'), or omit the option — absent means the ` +
        `scope layout starts at the root of the bucket.`,
    );
  }
  if (root.includes('..')) {
    throw new TypeError(
      `[artifacts] ${adapter}({ prefix: ${JSON.stringify(root)} }) contains '..'. Object keys ` +
        `are flat strings and '..' is not a hop here, but a prefix that reads like one is a ` +
        `misunderstanding waiting to be acted on. Name the prefix literally.`,
    );
  }
  const trimmed = root.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed === '') {
    throw new TypeError(
      `[artifacts] ${adapter}({ prefix: ${JSON.stringify(root)} }) is only slashes. Name a ` +
        `prefix, or omit the option.`,
    );
  }
  return trimmed;
}
