/**
 * strategies/proxyChoice — `proxy-token`: an authenticating reverse proxy
 * (oauth2-proxy, mod_auth_openidc, Pomerium) signs the person in and forwards
 * a signed token on every request; the library still VERIFIES it (design §4.4).
 *
 * It is `oidc-token` token-only with three differences:
 *  - **No discovery.** Many proxies publish a JWKS but no OpenID discovery
 *    document, so `IDENTITY_JWKS_URL` is required (https; plain http only on
 *    this machine outside production) and fetched without following a
 *    redirect, and `IDENTITY_ISSUER` is a literal compared exactly.
 *  - **A configurable header** (`IDENTITY_PROXY_HEADER`, default
 *    `authorization`, read as `Bearer …`; any other header is the raw token).
 *  - **Only an ACCESS token for this API** (`IDENTITY_PROXY_TOKEN=access-token`,
 *    required). An ID token's audience is the proxy's own client and it carries
 *    no scope, so the person test could not run on it; forwarding one is refused
 *    at boot. The whole person test and the client check apply —
 *    `IDENTITY_ALLOWED_CLIENTS` names the proxy's client.
 *
 * **Every door is hardened (design §3, H1).** The browser's credential here is
 * the PROXY's cookie (or a Windows login), which the proxy turns into a valid
 * header on every request it forwards — forged cross-site ones included. So
 * `proxy-token` refuses to start without the host's door guard lists
 * (`boot.crossSite`): `allowedHosts` set (unless the public URL is this
 * machine), never `'any'`, the JSON rule on, and the public URL passing them.
 *
 * What the library cannot check: that the proxy was on the path. A person who
 * reaches the app port directly with their OWN valid token skips whatever the
 * proxy enforces beyond identity (MFA step-up, device posture, per-route
 * rules). So the app port must be reachable only from the proxy, and any
 * authorization that must hold is repeated in the library.
 */

import { browserDoorGuard } from '../../../hosting/signin/browserGuard.js';
import { fetchableUrlProblem } from '../verify/discovery.js';
import { IdentityConfigError, type IdentityConfig } from './config.js';
import {
  bannerSafe,
  buildVerifier,
  oidcOptions,
  type IdentityBootOptions,
  type IdentityChoice,
} from './choose.js';
import { doorRefusal } from './doorError.js';
import { keyLabel } from './vocabulary.js';

export function proxyTokenChoice(
  config: IdentityConfig,
  boot: IdentityBootOptions,
  production: boolean,
): IdentityChoice {
  const kind = config.proxyToken;
  if (kind !== 'access-token') {
    throw new IdentityConfigError(
      kind === 'id-token'
        ? `IDENTITY_PROXY_TOKEN=id-token is refused: an ID token's audience is the proxy's own ` +
          `client and it carries no scope, so it cannot pass the person test. Have the proxy ` +
          `forward the ACCESS token for this API (oauth2-proxy: --pass-access-token, or an ` +
          `injectRequestHeaders rule on claim access_token) and set IDENTITY_PROXY_TOKEN=access-token.`
        : `proxy-token needs IDENTITY_PROXY_TOKEN=access-token: the proxy forwards an ACCESS ` +
          `token for this API (an ID token is refused).`,
      'IDENTITY_PROXY_TOKEN',
    );
  }
  const jwksUrl = config.jwksUrl;
  if (jwksUrl === undefined) {
    throw new IdentityConfigError(
      `proxy-token needs ${keyLabel('jwksUrl')}: there is no discovery here, so the signing ` +
        `keys' URL is given directly (https).`,
      'IDENTITY_JWKS_URL',
    );
  }
  const publicUrl = config.publicUrl;
  if (publicUrl === undefined) {
    throw new IdentityConfigError(
      `proxy-token needs ${keyLabel('publicUrl')}: the URL people open through the proxy — the ` +
        `door guard's lists must allow it.`,
      'IDENTITY_PUBLIC_URL',
    );
  }
  const header = (config.proxyHeader ?? 'authorization').toLowerCase();
  if (!isTokenHeader(header)) {
    throw new IdentityConfigError(
      `IDENTITY_PROXY_HEADER '${header}' is not a header a proxy forwards a TOKEN in: use ` +
        `'authorization' or a custom 'x-…' header. A standard header (cookie, set-cookie, …) ` +
        `means something else, and a bare user name (X-Forwarded-User) is never trusted: it ` +
        `is a string anybody can send.`,
      'IDENTITY_PROXY_HEADER',
    );
  }
  const url = parsePublicUrl(publicUrl, production);
  try {
    // proxy-token sets no cookie of its own (the proxy's is the proxy's).
    browserDoorGuard('proxy-token', boot.crossSite, url, false);
  } catch (err) {
    throw doorRefusal('proxy-token', err);
  }
  const options = {
    ...oidcOptions(config, boot, production, { strategy: 'proxy-token', literalIssuer: true }),
    discovery: 'off' as const,
    jwksUrl,
  };
  const verifier = buildVerifier(options);
  const clients =
    options.allowedClients === 'any'
      ? `any — the client check is OFF (development only)`
      : options.allowedClients.join(', ');
  return {
    strategy: 'proxy-token',
    mode: 'proxy',
    identity: { verify: verifier.verify, tokenHeader: header },
    banner: [
      `identity: strategy proxy-token — the proxy forwards an ACCESS token in '${header}'; the library verifies it`,
      `identity: issuer (literal) ${options.issuer}; signing keys ${jwksUrl} (no discovery, no redirects)`,
      `identity: audience ${[options.audience].flat().join(', ')}; user id claim ${
        options.userIdClaim
      }`,
      `identity: person test — required scope '${options.requiredScope}' in '${
        options.scopeClaim ?? 'scp'
      }'; allowed clients (the proxy's): ${clients}`,
      `identity: door guard on for ${url.origin} (the proxy's cookie rides along on forged requests)`,
      'identity: WARNING the app port must be reachable ONLY from the proxy: a person who reaches it directly with their own token skips what the proxy enforces beyond identity (MFA step-up, device posture, per-route rules)',
    ].map(bannerSafe),
  };
}

/**
 * The headers a proxy may forward the token in (recheck NIT): `authorization`,
 * or a custom `x-` header — never another standard header (`cookie`,
 * `set-cookie`, `host`, …, which mean something else to every hop) and never
 * `x-forwarded-user*` (a user NAME, not a token).
 */
function isTokenHeader(header: string): boolean {
  if (header === 'authorization') return true;
  return /^x-[a-z0-9-]+$/.test(header) && !header.startsWith('x-forwarded-user');
}

function parsePublicUrl(raw: string, production: boolean): URL {
  const problem = fetchableUrlProblem(raw, !production);
  if (problem !== undefined) {
    throw new IdentityConfigError(
      `${keyLabel('publicUrl')} '${raw}' ${problem}.`,
      'IDENTITY_PUBLIC_URL',
    );
  }
  const url = new URL(raw);
  // The same rule as the sign-in door (idI57 N-5): the origin alone.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new IdentityConfigError(
      `${keyLabel('publicUrl')} '${raw}' has a path, query or fragment; give the origin alone (${
        url.origin
      }).`,
      'IDENTITY_PUBLIC_URL',
    );
  }
  return url;
}
