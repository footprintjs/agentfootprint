/**
 * A body the pool's fetch passes with no guard: a JSON-RPC notification (a
 * method, no id) or an answer to the server's own request (an id, a result or
 * an error, no method). Never refused, never counted here. Anything else — a
 * request, a batch, a body that is not JSON-RPC — needs a guard.
 */
export function passesUnguarded(body: RequestInit['body'] | undefined): boolean {
  if (typeof body !== 'string') return false;
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return false;
  }
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return false;
  const fields = message as {
    readonly method?: unknown;
    readonly id?: unknown;
    readonly result?: unknown;
    readonly error?: unknown;
  };
  if (typeof fields.method === 'string') return fields.id === undefined;
  return fields.method === undefined && ('result' in fields || 'error' in fields);
}

/** A `tools/call` request: a pooled one always brings its own call's guard. */
export function isToolCall(message: unknown): boolean {
  return (
    message !== null &&
    typeof message === 'object' &&
    (message as { readonly method?: unknown }).method === 'tools/call'
  );
}
