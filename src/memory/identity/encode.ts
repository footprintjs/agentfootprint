/**
 * identity/encode — one identity field → one unambiguous key segment.
 *
 * **This module is the tenant boundary.** Every durable store in the library
 * addresses rows by a string composed from `{ tenant, principal,
 * conversationId }`. If two DIFFERENT tuples can spell the SAME string, one
 * scope reads, overwrites and erases another scope's data — no race, no
 * misconfiguration, just arithmetic. So the encoding here is **injective**
 * (different tuples ⇒ different strings, always), and that property is
 * load-bearing rather than tidy: it is the whole isolation guarantee.
 *
 * Two things could collapse two tuples into one string, and each has a rule:
 *
 *   • **the separator.** `/` is what joins the fields, so a value containing
 *     one would otherwise donate a field boundary: tenant `acme/hr` and
 *     principal `alice` spelled the same string as tenant `acme` and
 *     principal `hr/alice`. Real ids hit this — a JWT `sub` is often a URI.
 *     `/` is therefore escaped to `%2F`, and `%` — the escape's own
 *     introducer — is escaped FIRST to `%25`, or a value that merely reads
 *     like an escape (`a%2Fb`) would land on the value that produced it
 *     (`a/b`) and we would have moved the collision rather than closed it.
 *
 *   • **the absence marker.** A field that was not given still needs a
 *     segment, and that segment is `_`. A tenant *named* `_` is a different
 *     scope from *no tenant*, so a present value that spells the marker is
 *     escaped to `%5F`. `%5F` is unreachable any other way (every `%` in an
 *     encoded value is already escaped), which is what makes it safe to
 *     reserve.
 *
 * **What deliberately does NOT change.** A value containing neither `/` nor
 * `%`, and which is not exactly `_`, is returned BYTE FOR BYTE. That is not a
 * nicety — it is what makes this fix deployable: every existing artifact and
 * memory row written under a well-behaved id keeps its address, so there is no
 * migration. The only tuples that change key are the ones that were sharing a
 * key with somebody else, and those were already broken.
 *
 * Absence has exactly ONE spelling: `undefined`, `null` and `''` all mean "not
 * given". An empty string is not a name, and treating it as one would create a
 * second anonymous scope rather than distinguish anything real.
 */

/** The one segment that means "this field was not given". */
export const IDENTITY_ABSENT = '_';

/**
 * The segment for a present value that literally spells {@link IDENTITY_ABSENT}.
 *
 * Reserved, and reachable ONLY from the value `_`: any escaper used with
 * {@link distinctFromAbsent} escapes `%` itself, so no other input can produce
 * these three bytes.
 */
const ABSENT_LOOKALIKE = '%5F';

/**
 * Keep a PRESENT value from spelling the absence marker.
 *
 * For encoders that already do their own escaping (the artifact path
 * segments use `encodeURIComponent`) and only need the absence law applied on
 * top.
 *
 * **Precondition:** `escaped` comes from an escaper that escapes `%`. Without
 * that, a caller-supplied `%5F` would collide with an escaped `_` and this
 * function would be hiding a collision instead of closing one.
 */
export function distinctFromAbsent(escaped: string): string {
  return escaped === IDENTITY_ABSENT ? ABSENT_LOOKALIKE : escaped;
}

/**
 * Encode ONE identity field as a key segment that cannot be confused with any
 * other field's, or with absence.
 *
 * @param raw the field as the caller gave it; `undefined`/`null`/`''` are
 *            absence.
 * @returns a segment containing no `/`, never equal to another field's segment
 *          unless the fields were equal.
 * @throws TypeError when a present field is not a string. The value is NOT
 *         named in the message — this function is the identity boundary, and
 *         an error string is the one place a tenant id must never travel.
 */
export function encodeIdentityField(raw: string | undefined | null): string {
  if (raw === undefined || raw === null || raw === '') return IDENTITY_ABSENT;
  if (typeof raw !== 'string') {
    throw new TypeError(
      '[identity] a MemoryIdentity field must be a string or omitted. A non-string was ' +
        'given, and it is not quoted here on purpose: this value addresses a tenant, and an ' +
        'error message is the wrong place for one. Convert it at the call site so the id ' +
        'that reaches storage is the id you meant.',
    );
  }
  // '%' FIRST — it introduces every escape below, so it has to be inert before
  // any are emitted. Reversing these two lines re-opens the collision.
  const escaped = raw.replace(/%/g, '%25').replace(/\//g, '%2F');
  return distinctFromAbsent(escaped);
}
