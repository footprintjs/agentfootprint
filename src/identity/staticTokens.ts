/**
 * staticTokens — a dev/test {@link CredentialProvider} backed by canned tokens.
 *
 * No network, no SDK. Use it to develop tools that need credentials without
 * standing up AgentCore Identity (or any IdP). Production swaps it for
 * `agentCoreIdentity()` — the tool code never changes.
 *
 *   const credentials = staticTokens({ github: 'ghp_dev_xxx', slack: 'xoxb-dev' });
 *   const r = await credentials.getCredential({ service: 'github' });
 *   if (r.status === 'token') useHeader(`Bearer ${r.token}`);
 */

import type { CredentialProvider, CredentialResult } from './types.js';

export interface StaticTokensOptions {
  /** Optional id (defaults to 'static-tokens'). */
  readonly id?: string;
  /** Optional fixed expiry (unix seconds) applied to every token. */
  readonly expiresAt?: number;
}

/**
 * Build a {@link CredentialProvider} from a `service → token` map. Always 2-legged
 * (returns the token directly); throws if a requested service has no token.
 */
export function staticTokens(
  tokens: Readonly<Record<string, string>>,
  options: StaticTokensOptions = {},
): CredentialProvider {
  return {
    id: options.id ?? 'static-tokens',
    getCredential(req): Promise<CredentialResult> {
      const token = tokens[req.service];
      if (!token) {
        return Promise.reject(
          new Error(
            `staticTokens: no token configured for service '${req.service}'. ` +
              `Known services: ${Object.keys(tokens).join(', ') || '(none)'}.`,
          ),
        );
      }
      return Promise.resolve({
        status: 'token',
        token,
        ...(options.expiresAt !== undefined && { expiresAt: options.expiresAt }),
      });
    },
  };
}
