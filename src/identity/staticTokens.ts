/**
 * staticTokens — a dev/test {@link CredentialProvider} backed by canned credentials.
 *
 * No network, no SDK. Use it to develop tools that need credentials without
 * standing up AgentCore Identity (or any IdP). Production swaps it for
 * `agentCoreIdentity()` — the tool code never changes.
 *
 *   // a plain string is treated as a bearer token (the common case):
 *   const credentials = staticTokens({ github: 'ghp_dev_xxx' });
 *   // …or give an explicit kind:
 *   const credentials = staticTokens({ internal: apiKey('k', 'x-internal-key') });
 *
 *   const r = await credentials.getCredential({ service: 'github' });
 *   if (isCredentialIssued(r)) callGithub({ headers: r.credential.toHeaders() });
 */

import type { Credential, CredentialProvider, CredentialResult } from './types.js';
import { bearer } from './kinds.js';

export interface StaticTokensOptions {
  /** Optional id (defaults to 'static-tokens'). */
  readonly id?: string;
  /** Optional fixed expiry (unix seconds) applied to every credential. */
  readonly expiresAt?: number;
}

/**
 * Build a {@link CredentialProvider} from a `service → credential` map. A plain
 * string value is treated as a bearer token; a {@link Credential} is used as-is.
 * Always 2-legged (issues directly); throws if a requested service has none.
 */
export function staticTokens(
  creds: Readonly<Record<string, string | Credential>>,
  options: StaticTokensOptions = {},
): CredentialProvider {
  return {
    id: options.id ?? 'static-tokens',
    getCredential(req): Promise<CredentialResult> {
      const entry = creds[req.service];
      if (entry === undefined) {
        return Promise.reject(
          new Error(
            `staticTokens: no credential configured for service '${req.service}'. ` +
              `Known services: ${Object.keys(creds).join(', ') || '(none)'}.`,
          ),
        );
      }
      const credential = typeof entry === 'string' ? bearer(entry) : entry;
      return Promise.resolve({
        status: 'issued',
        credential,
        ...(options.expiresAt !== undefined && { expiresAt: options.expiresAt }),
      });
    },
  };
}
