/**
 * echo — a failure answer never repeats what the request carried.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * A non-2xx body becomes the MCP client's error text, and a failed tool call
 * hands that text to the model, the run's history and `tool_end`. AWS's
 * validation errors quote the value they refused ("Value '…' at
 * 'runtimeSessionId' failed to satisfy constraint"), and a proxy or a hosted
 * server may echo a header back in a 4xx. So the session ids and the bearer
 * token THIS request sent are replaced in any failure body before the MCP
 * client reads it — the message stays, the values do not. The runtime's MCP
 * contract also sends some platform errors as an HTTP 200 JSON-RPC error, so a
 * 2xx JSON body is read too (a copy of it) and rebuilt only when it holds one
 * of the values; any other 2xx answer, a stream included, is handed on unread.
 *
 * Pattern: pure helper. Role: outer ring, the transport's own hygiene.
 */

/** What a value is replaced with. */
export const ECHO_PLACEHOLDER = '[withheld]';

/** Values shorter than this are not scrubbed: they are not identifiers and would match prose. */
const MIN_SCRUBBED_LENGTH = 8;

/**
 * `response` with every one of `values` replaced in its body when it is a
 * failure (not 2xx), or a 2xx JSON body that holds one; the very object
 * otherwise.
 */
export async function withoutEcho(
  response: Response,
  values: readonly (string | null | undefined)[],
): Promise<Response> {
  if (response.body === null) return response;
  const sent = scrubbable(values);
  if (sent.length === 0) return response;
  let text: string;
  if (response.ok) {
    if (!isJson(response.headers.get('content-type'))) return response;
    try {
      text = await response.clone().text();
    } catch {
      return response;
    }
    if (!sent.some((value) => text.includes(value) || text.includes(escapedOf(value)))) {
      return response;
    }
  } else {
    try {
      text = await response.text();
    } catch {
      text = '';
    }
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(scrubText(text, sent), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** `text` with every one of `values` — raw or JSON-escaped — replaced. */
export function scrubText(text: string, values: readonly string[]): string {
  let out = text;
  for (const value of values) {
    out = out.split(value).join(ECHO_PLACEHOLDER);
    const escaped = escapedOf(value);
    if (escaped !== value) out = out.split(escaped).join(ECHO_PLACEHOLDER);
  }
  return out;
}

/** `value` as it appears inside a JSON string. */
function escapedOf(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** `application/json`, with or without parameters, in any case. */
function isJson(contentType: string | null): boolean {
  return contentType !== null && /^application\/json\b/i.test(contentType.trim());
}

/**
 * The values worth scrubbing, longest first (so a token is replaced whole
 * before a shorter value inside it could split it); an `Authorization` value
 * contributes its credential part too (`Bearer <token>` → `<token>`).
 */
function scrubbable(values: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const credential = /^\S+\s+(\S.*)$/.exec(value)?.[1];
    for (const candidate of [value, credential]) {
      if (candidate !== undefined && candidate.length >= MIN_SCRUBBED_LENGTH) out.add(candidate);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}
