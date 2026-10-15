/**
 * errorType — the error type an AWS REST answer names in its
 * `x-amzn-errortype` header, trimmed to the bare name.
 *
 * The header may carry a `:` suffix (a URL) or a `namespace#` prefix; both are
 * removed, so `aws.protocols#AccessDeniedException:http://…` reads
 * `AccessDeniedException` — the name the SDK gives the same exception.
 *
 * Pattern: pure helper. Role: outer ring, vendor fact.
 */

/** The bare error type, or `undefined` when the answer names none. */
export function awsErrorType(headers: Headers): string | undefined {
  const raw = headers.get('x-amzn-errortype');
  if (raw === null) return undefined;
  const withoutSuffix = raw.split(':')[0] ?? '';
  const name = withoutSuffix.slice(withoutSuffix.lastIndexOf('#') + 1).trim();
  return name === '' ? undefined : name;
}
