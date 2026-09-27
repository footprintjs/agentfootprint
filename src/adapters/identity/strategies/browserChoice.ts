/**
 * strategies/browserChoice — `oidc-token` WITH browser sign-in, built from
 * config. PENDING INDEPENDENT REVIEW before a company install.
 *
 * Browser sign-in is on when any of its keys is set, and then all of the three
 * it cannot work without are required, together or not at all: the public URL,
 * the client id, and ONE client credential (a private key file, preferred, or a
 * secret file). A half-configured sign-in is not a smaller sign-in.
 *
 * The boot refusals that come with it:
 *  - `IDENTITY_AUDIENCE` equal to `IDENTITY_CLIENT_ID` (design §5.3): an ID
 *    token's `aud` is the client id, so with one value for both an ID token
 *    would pass the API door as an access token;
 *  - door hardening (H1/H4): the door guard is built from the host's own lists
 *    (`boot.crossSite`), and the public URL must pass them;
 *  - `IDENTITY_PKCE` other than `required` or `off`;
 *  - an unreadable key, secret or cookie-key file (named, never printed);
 *  - a sign-in that could never work (review idI57 S-1), found by the
 *    strategy's `ready()`: `openid-client` not installed, a client key that is
 *    not RSA / EC P-256, a discovery document with no authorization or token
 *    endpoint, or PKCE required and `S256` not offered. An IdP that is merely
 *    unreachable at boot is NOT refused — the first login tries again.
 */

import { readFileSync } from 'node:fs';

import { memorySignIns } from '../../../hosting/signin/memorySignIns.js';
import { DEFAULT_IDLE_MINUTES, signInDoor, type SignInDoor } from '../../../hosting/signin/door.js';
import { sealKeyFrom } from '../../../hosting/signin/seal.js';
import type { OidcIdentity } from '../oidc.js';
import {
  MissingOpenIdClientError,
  OidcSignInSetupError,
  oidcSignIn,
  type OidcClientCredential,
} from '../oidcSignIn.js';
import type { RedirectSignIn } from '../../../hosting/signin/types.js';
import { IdentityConfigError, type IdentityConfig } from './config.js';
import type { IdentityBootOptions } from './choose.js';
import { doorRefusal } from './doorError.js';
import { keyLabel } from './vocabulary.js';

/** The settings browser sign-in needs, read and checked. */
export interface BrowserSettings {
  readonly publicUrl: string;
  readonly clientId: string;
  readonly credential: OidcClientCredential;
  readonly scope: string;
  readonly pkce: 'required' | 'off';
  readonly cookieKey?: Buffer;
}

/** The browser-only keys: any of them set turns browser sign-in on. */
const BROWSER_FIELDS = [
  'publicUrl',
  'clientId',
  'clientKeyFile',
  'clientSecretFile',
  'pkce',
  'cookieKeyFile',
  'scope',
  'resource',
  'displayNameClaim',
  'signInHours',
  'signInIdleMinutes',
  'signInMax',
] as const;

/** `undefined` when browser sign-in is off (token-only); else its checked settings. */
export function browserSettings(config: IdentityConfig): BrowserSettings | undefined {
  const on = BROWSER_FIELDS.filter((f) => config[f] !== undefined);
  if (on.length === 0) return undefined;
  const publicUrl = need(config.publicUrl, 'publicUrl', on);
  const clientId = need(config.clientId, 'clientId', on);
  if (config.clientKeyFile !== undefined && config.clientSecretFile !== undefined) {
    throw new IdentityConfigError(
      `${keyLabel('clientKeyFile')} and ${keyLabel('clientSecretFile')} are both set. One client ` +
        `credential: the private key (preferred), or the secret.`,
      'IDENTITY_CLIENT_SECRET_FILE',
    );
  }
  if (config.clientKeyFile === undefined && config.clientSecretFile === undefined) {
    throw new IdentityConfigError(
      `browser sign-in (${on.map(keyLabel).join(', ')}) needs a client credential: ` +
        `IDENTITY_CLIENT_KEY_FILE (a private key, preferred) or IDENTITY_CLIENT_SECRET_FILE.`,
      'IDENTITY_CLIENT_KEY_FILE',
    );
  }
  const audiences = [config.audience ?? []].flat();
  if (audiences.includes(clientId)) {
    throw new IdentityConfigError(
      `IDENTITY_AUDIENCE equals IDENTITY_CLIENT_ID. An ID token's audience is the client id, so ` +
        `with one value for both an ID token would pass this API's door as an access token. ` +
        `Register the API separately (an AD FS Web API identifier, an Entra API registration).`,
      'IDENTITY_AUDIENCE',
    );
  }
  const pkce = config.pkce ?? 'required';
  if (pkce !== 'required' && pkce !== 'off') {
    throw new IdentityConfigError(
      `IDENTITY_PKCE is 'required' (the default) or 'off' (AD FS 2016 only) — not '${pkce}'.`,
      'IDENTITY_PKCE',
    );
  }
  const scope = need(config.scope, 'scope', on);
  if (!/(^|\s)openid(\s|$)/.test(scope)) {
    throw new IdentityConfigError(
      `IDENTITY_SCOPE must include 'openid' (and this API's scope, so the access token is for it).`,
      'IDENTITY_SCOPE',
    );
  }
  const credential: OidcClientCredential =
    config.clientKeyFile !== undefined
      ? {
          kind: 'private-key',
          pem: readSecretFile(config.clientKeyFile, 'IDENTITY_CLIENT_KEY_FILE'),
        }
      : {
          kind: 'secret',
          secret: readSecretFile(
            config.clientSecretFile as string,
            'IDENTITY_CLIENT_SECRET_FILE',
          ).trim(),
        };
  const cookieKey =
    config.cookieKeyFile === undefined
      ? undefined
      : sealKeyOrRefuse(readRawFile(config.cookieKeyFile, 'IDENTITY_COOKIE_KEY_FILE'));
  return {
    publicUrl,
    clientId,
    credential,
    scope,
    pkce,
    ...(cookieKey !== undefined && { cookieKey }),
  };
}

/** The sign-in door for `oidc-token` browser sign-in, refused at boot if it could never work. */
export async function browserDoor(
  browser: BrowserSettings,
  config: IdentityConfig,
  boot: IdentityBootOptions,
  production: boolean,
  verifier: OidcIdentity,
): Promise<SignInDoor> {
  let redirect: RedirectSignIn;
  try {
    redirect = oidcSignIn({
      verifier,
      clientId: browser.clientId,
      credential: browser.credential,
      scope: browser.scope,
      pkce: browser.pkce,
      ...(config.resource !== undefined && { resource: config.resource }),
      ...(config.displayNameClaim !== undefined && { displayNameClaim: config.displayNameClaim }),
      ...(config.clockToleranceSeconds !== undefined && {
        clockToleranceSeconds: config.clockToleranceSeconds,
      }),
      allowLoopbackHttp: !production,
      ...(boot.openIdClient !== undefined && { backend: boot.openIdClient }),
    });
  } catch (err) {
    throw doorRefusal('oidc-token browser sign-in', err);
  }
  await readyOrRefuse(redirect, browser);
  try {
    return signInDoor({
      redirect,
      verify: verifier.verify,
      store: memorySignIns({
        ...(config.signInMax !== undefined && { max: config.signInMax }),
        idleMinutes: config.signInIdleMinutes ?? DEFAULT_IDLE_MINUTES.redirect,
      }),
      publicUrl: browser.publicUrl,
      production,
      ...(boot.crossSite !== undefined && { guard: boot.crossSite }),
      ...(config.signInHours !== undefined && { hours: config.signInHours }),
      ...(config.signInIdleMinutes !== undefined && { idleMinutes: config.signInIdleMinutes }),
      ...(browser.cookieKey !== undefined && { cookieKey: browser.cookieKey }),
    });
  } catch (err) {
    throw doorRefusal('oidc-token browser sign-in', err);
  }
}

/** Await the strategy's boot check; a failure becomes a refusal naming the key to fix. */
async function readyOrRefuse(redirect: RedirectSignIn, browser: BrowserSettings): Promise<void> {
  try {
    await redirect.ready?.();
  } catch (err) {
    if (err instanceof MissingOpenIdClientError) {
      throw new IdentityConfigError(
        'oidc-token browser sign-in needs the openid-client package: npm install openid-client.',
      );
    }
    if (err instanceof OidcSignInSetupError) {
      const text = err.message.replace(/^\[identity\] oidcSignIn: /, '').replace(/\.$/, '');
      if (err.setting === 'client-key') {
        throw new IdentityConfigError(
          `browser sign-in cannot start: ${text}. Check ${
            browser.credential.kind === 'private-key'
              ? 'IDENTITY_CLIENT_KEY_FILE'
              : 'IDENTITY_CLIENT_SECRET_FILE'
          }.`,
          browser.credential.kind === 'private-key'
            ? 'IDENTITY_CLIENT_KEY_FILE'
            : 'IDENTITY_CLIENT_SECRET_FILE',
        );
      }
      throw new IdentityConfigError(
        `browser sign-in cannot start: ${text}. Check IDENTITY_ISSUER (and IDENTITY_PKCE).`,
        'IDENTITY_ISSUER',
      );
    }
    throw new IdentityConfigError(
      `browser sign-in cannot start: ${err instanceof Error ? err.name : 'an unknown failure'}.`,
    );
  }
}

function need(value: string | undefined, field: string, on: readonly string[]): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new IdentityConfigError(
    `browser sign-in is half set (${on.map(keyLabel).join(', ')}): it also needs ` +
      `${keyLabel(field)}. IDENTITY_PUBLIC_URL, IDENTITY_CLIENT_ID and a client credential ` +
      `come together or not at all.`,
    `IDENTITY_${field.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`,
  );
}

function readRawFile(path: string, key: string): Buffer {
  try {
    return readFileSync(path);
  } catch {
    throw new IdentityConfigError(`${key} names a file that cannot be read.`, key);
  }
}

function readSecretFile(path: string, key: string): string {
  const text = readRawFile(path, key).toString('utf8');
  if (text.trim().length === 0) throw new IdentityConfigError(`${key} names an empty file.`, key);
  return text;
}

function sealKeyOrRefuse(bytes: Buffer): Buffer {
  try {
    return sealKeyFrom(bytes);
  } catch {
    throw new IdentityConfigError(
      `IDENTITY_COOKIE_KEY_FILE must hold 32 bytes (raw, or base64 / hex text). Make one with ` +
        `openssl rand -base64 32.`,
      'IDENTITY_COOKIE_KEY_FILE',
    );
  }
}
