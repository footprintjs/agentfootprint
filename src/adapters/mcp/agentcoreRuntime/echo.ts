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
 * 2xx JSON body that is ONE JSON-RPC error reply is read too (a copy of it) and
 * its error's string values scrubbed — parsed and re-serialized, so the reply
 * stays valid JSON; a `result` is never touched, and any other 2xx answer, a
 * stream included, is handed on unread.
 *
 * Pattern: pure helper. Role: outer ring, the transport's own hygiene.
 */

/** What a value is replaced with. */
export const ECHO_PLACEHOLDER = '[withheld]';

/** Values shorter than this are not scrubbed: they are not identifiers and would match prose. */
const MIN_SCRUBBED_LENGTH = 8;

/**
 * `response` with every one of `values` replaced in its body when it is a
 * failure (not 2xx), or in the error of a 2xx JSON-RPC error reply that holds
 * one; the very object otherwise.
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
    let reply: string;
    try {
      reply = await response.clone().text();
    } catch {
      return response;
    }
    const scrubbed = scrubbedErrorReply(reply, sent);
    if (scrubbed === undefined) return response;
    return rebuilt(response, scrubbed);
  } else {
    try {
      text = await response.text();
    } catch {
      text = '';
    }
  }
  return rebuilt(response, scrubText(text, sent));
}

/** The same answer around a new body. */
function rebuilt(response: Response, body: string): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * ONE JSON-RPC error reply with every one of `values` replaced inside its
 * error's string values, re-serialized; `undefined` when `text` is not such a
 * reply or holds none of them (a `result` is never a target).
 */
function scrubbedErrorReply(text: string, values: readonly string[]): string | undefined {
  let reply: unknown;
  try {
    reply = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (reply === null || typeof reply !== 'object' || Array.isArray(reply)) return undefined;
  const error = (reply as { readonly error?: unknown }).error;
  if (error === null || typeof error !== 'object') return undefined;
  let changed = false;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const out = scrubText(value, values);
      if (out !== value) changed = true;
      return out;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  const scrubbed = { ...(reply as Record<string, unknown>), error: walk(error) };
  return changed ? JSON.stringify(scrubbed) : undefined;
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
