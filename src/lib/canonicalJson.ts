/**
 * canonicalJson — deterministic JSON serialization (`afp-cjson/1`).
 *
 * Pattern: Canonicalization function (RFC 8785 JCS-inspired, JS-native).
 * Role:    The byte contract under the tamper-evident audit chain
 *          (backlog #20). `AuditRecord.hash` = SHA-256 over the
 *          canonical serialization of the record — two parties that
 *          serialize the same VALUE must produce the same BYTES, or
 *          verification breaks. These rules ARE the contract; bump the
 *          identifier (`afp-cjson/2`) for ANY behavioral change.
 *
 * ## Canonicalization rules (`afp-cjson/1`)
 *
 *  1. **Objects** — own enumerable string-keyed properties only, keys
 *     sorted lexicographically by UTF-16 code unit (JavaScript's
 *     default `Array.prototype.sort()` comparison), serialized
 *     `{"k":v,...}` with no whitespace. Symbol keys are ignored.
 *  2. **Arrays** — element order preserved, `[v,...]` no whitespace.
 *  3. **Strings** — `JSON.stringify` escaping (deterministic per the
 *     ECMAScript spec: minimal escapes, lowercase `\uXXXX` hex).
 *  4. **Numbers** — finite numbers via `JSON.stringify` (ECMAScript
 *     shortest round-trip formatting). `NaN` / `±Infinity` → `null`
 *     (JSON.stringify parity). `-0` serializes as `0`.
 *  5. **`null`** → `null`. **`undefined`** — omitted as an object
 *     property, `null` as an array element or top-level value
 *     (JSON.stringify parity).
 *  6. **Functions / symbols** — omitted as object properties, `null`
 *     in arrays (JSON.stringify parity).
 *  7. **`toJSON`** — honored before serialization (so `Date` →
 *     ISO-8601 string, exactly like `JSON.stringify`).
 *  8. **`bigint`** → `TypeError` (JSON.stringify parity). Sanitize
 *     upstream (the audit bounding layer converts bigint to string).
 *  9. **Cycles** → `TypeError`. Canonicalization is defined over
 *     JSON-safe trees; the audit bounding layer breaks cycles first.
 *
 * The domain is "anything `JSON.parse` can produce" (the audit bundle
 * is JSON); for other inputs the behavior mirrors `JSON.stringify`
 * except that object keys are SORTED. Verification re-canonicalizes
 * records that came through `JSON.parse(JSON.stringify(bundle))`, so
 * round-tripping a bundle never changes its hashes.
 *
 * Browser-safe: no Node imports — pure computation.
 */

/** Identifier of the canonicalization rules implemented by
 *  {@link canonicalJson}. Carried on `AuditBundleHeader.canonicalization`
 *  so offline verifiers can reject bundles produced under different
 *  rules instead of mis-verifying them. */
export const CANONICAL_JSON_VERSION = 'afp-cjson/1';

/**
 * Serialize `value` to canonical JSON (see module docs for the exact
 * `afp-cjson/1` rules). Deterministic: equal values (after key
 * reordering) always produce identical strings.
 *
 * @throws TypeError on circular references or bigint values.
 */
export function canonicalJson(value: unknown): string {
  const out = serialize(value, new Set());
  // JSON.stringify parity: a top-level undefined/function/symbol would
  // yield `undefined` from JSON.stringify; for a hashing contract an
  // absent serialization is a footgun, so we pin it to `null`.
  return out ?? 'null';
}

/**
 * Recursive serializer. Returns `undefined` for values that JSON omits
 * (undefined / function / symbol) — the CALLER decides whether that
 * means "omit the property" (objects) or "null" (arrays / top level).
 */
function serialize(value: unknown, seen: Set<object>): string | undefined {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      // JSON.stringify(NaN | ±Infinity) === 'null'; finite numbers use
      // the ECMAScript shortest round-trip representation.
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      throw new TypeError(
        'canonicalJson: bigint is not JSON-serializable (JSON.stringify parity). ' +
          'Convert to string/number before canonicalizing.',
      );
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break; // object — handled below
  }

  const obj = value as object;

  // Honor toJSON (Date → ISO string) BEFORE cycle bookkeeping, exactly
  // like JSON.stringify.
  const toJSON = (obj as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === 'function') {
    return serialize((toJSON as () => unknown).call(obj), seen);
  }

  if (seen.has(obj)) {
    throw new TypeError('canonicalJson: circular reference — canonicalization requires a tree.');
  }
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts = new Array<string>(obj.length);
      for (let i = 0; i < obj.length; i++) {
        parts[i] = serialize(obj[i], seen) ?? 'null';
      }
      return `[${parts.join(',')}]`;
    }

    // Plain object: own enumerable string keys, sorted by UTF-16 code
    // unit (default sort). Properties serializing to undefined are
    // omitted (JSON.stringify parity).
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const serialized = serialize((obj as Record<string, unknown>)[key], seen);
      if (serialized !== undefined) parts.push(`${JSON.stringify(key)}:${serialized}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}
