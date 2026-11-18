/**
 * Is a 404 the MCP server's own answer — a JSON-RPC error response — rather than
 * an intermediary's (a platform's "not found" for a missing endpoint, a proxy's
 * page)? Read from a copy of the body, which the SDK reads too.
 */
export async function isServerAnswer(response: Response): Promise<boolean> {
  try {
    const text = await response.clone().text();
    const parsed = JSON.parse(text) as { readonly jsonrpc?: unknown; readonly error?: unknown };
    const error = parsed?.error as { readonly code?: unknown } | undefined;
    return parsed?.jsonrpc === '2.0' && typeof error?.code === 'number';
  } catch {
    return false;
  }
}
