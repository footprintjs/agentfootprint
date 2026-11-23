import { RequestTooLargeError, WireRequestRefusal } from '../errors.js';
import { toWireJson } from '../../lib/wireJson.js';
import { REFUSAL_STATUS } from '../refusalStatus.js';
import { isProviderInterventionError } from '../../provider-contract/intervention.js';

const PROVIDER_CODES = new Set([
  'ERR_PROVIDER_BLOCKED',
  'ERR_PROVIDER_INTERVENTION_UNKNOWN',
  'ERR_PROVIDER_GUARDRAIL_LIMIT',
]);

/** The refusal an error means — its own status and code, or a 500 that quotes nothing. */
export function failure(err: unknown, name: string): Response {
  if (err instanceof RequestTooLargeError) return refusal(413, err.message, err.code);
  if (err instanceof WireRequestRefusal) return refusal(err.status, err.message, err.code);
  if (isProviderInterventionError(err))
    return refusal(REFUSAL_STATUS[err.code] as number, err.message, err.code);
  const code = (err as { code?: unknown } | null)?.code;
  // These response outcomes are recognized by class, never a forged string.
  if (typeof code === 'string' && PROVIDER_CODES.has(code))
    return refusal(500, `[hosting] '${name}' could not serve the request.`, 'ERR_INTERNAL');
  if (err instanceof Error && typeof code === 'string' && REFUSAL_STATUS[code] !== undefined) {
    return refusal(REFUSAL_STATUS[code] as number, err.message, code);
  }
  // Never the thrown message: it is the author's note to their own logs.
  return refusal(500, `[hosting] '${name}' could not serve the request.`, 'ERR_INTERNAL');
}

/** A JSON refusal: `{ error, code }` under the refusal's own status. */
export function refusal(
  status: number,
  message: string,
  code: string,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(toWireJson({ error: message, code }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** The request's headers, names lower-cased (the door guard's and an adapter's view). */
export function headersOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** The body as text, refused at the byte that crosses `limit`. */
export async function readBody(request: Request, limit: number, name: string): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new RequestTooLargeError(limit, name);
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new RequestTooLargeError(limit, name);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function positive(
  value: number | undefined,
  fallback: number,
  field: string,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`[hosting] '${name}': ${field} must be a positive whole number of bytes.`);
  }
  return value;
}
