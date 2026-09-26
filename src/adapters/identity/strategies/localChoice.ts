/**
 * strategies/localChoice — the `local-password` strategy, built from config.
 *
 * Development, tests and a demo box only: it is REFUSED in production (Q3). A
 * password list in an environment variable is not a production identity
 * store, and a company that has a directory should sign people in through it.
 *
 * What it builds: the password list (`localPasswords` — hashed entries only),
 * a bounded in-memory sign-in store, and the sign-in door around them. The
 * door's guard is built from the host's own lists (`boot.crossSite`), and the
 * public URL must pass them — one source for allowed hosts and origins.
 */

import { memorySignIns } from '../../../hosting/signin/memorySignIns.js';
import { signInDoor, type SignInDoor } from '../../../hosting/signin/door.js';
import { LocalPasswordConfigError, localPasswords } from '../localPassword.js';
import { IdentityConfigError, type IdentityConfig } from './config.js';
import type { IdentityBootOptions, IdentityChoice } from './choose.js';
import { keyLabel } from './vocabulary.js';

/** Build the `local-password` choice, or refuse to boot naming the key. */
export function localPasswordChoice(
  config: IdentityConfig,
  boot: IdentityBootOptions,
  production: boolean,
): IdentityChoice {
  if (production) {
    throw new IdentityConfigError(
      `IDENTITY_STRATEGY is 'local-password', and this is production. A password list in the ` +
        `environment is not a production identity store: sign people in through your identity ` +
        `provider (oidc-token). local-password is for development, tests and demos.`,
      'IDENTITY_STRATEGY',
    );
  }
  const users = required(
    config.localUsers,
    'localUsers',
    `'name:scrypt$…' entries, comma separated`,
  );
  const publicUrl = required(
    config.publicUrl,
    'publicUrl',
    `the URL people open the app at — it decides the sign-in cookie (http only on localhost)`,
  );
  let passwords;
  try {
    passwords = localPasswords(users);
  } catch (err) {
    if (err instanceof LocalPasswordConfigError) {
      throw new IdentityConfigError(
        `${keyLabel('localUsers')}: ${err.message.replace(/^\[identity\] /, '')}`,
        'IDENTITY_LOCAL_USERS',
      );
    }
    throw err;
  }
  const door = buildDoor(config, boot, publicUrl, passwords);
  return {
    strategy: 'local-password',
    mode: 'password',
    identity: door.identity,
    signInDoor: door,
    hostSignIn: door.hostSignIn,
    banner: [
      `identity: strategy local-password — ${passwords.names.length} configured name(s); DEVELOPMENT ONLY (production refuses it)`,
      'identity: user ids are the configured names, matched exactly; renaming someone orphans their conversations',
      ...door.banner,
    ],
  };
}

function buildDoor(
  config: IdentityConfig,
  boot: IdentityBootOptions,
  publicUrl: string,
  passwords: ReturnType<typeof localPasswords>,
): SignInDoor {
  try {
    return signInDoor({
      passwords,
      store: memorySignIns({ ...(config.signInMax !== undefined && { max: config.signInMax }) }),
      publicUrl,
      production: false,
      ...(boot.crossSite !== undefined && { guard: boot.crossSite }),
      ...(config.signInHours !== undefined && { hours: config.signInHours }),
      ...(config.signInIdleMinutes !== undefined && { idleMinutes: config.signInIdleMinutes }),
      ...(config.trustedProxies !== undefined && { trustedProxies: config.trustedProxies }),
    });
  } catch (err) {
    const text = err instanceof Error ? err.message.replace(/^\[hosting\] /, '') : String(err);
    const key = /publicUrl|public URL/.test(text)
      ? 'IDENTITY_PUBLIC_URL'
      : /hours/.test(text)
      ? 'IDENTITY_SIGN_IN_HOURS'
      : /idleMinutes/.test(text)
      ? 'IDENTITY_SIGN_IN_IDLE_MINUTES'
      : /max/.test(text)
      ? 'IDENTITY_SIGN_IN_MAX'
      : undefined;
    throw new IdentityConfigError(`local-password cannot start: ${text}`, key);
  }
}

function required(value: string | undefined, field: string, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IdentityConfigError(
      `local-password needs ${keyLabel(field)}: ${what}.`,
      field === 'localUsers' ? 'IDENTITY_LOCAL_USERS' : 'IDENTITY_PUBLIC_URL',
    );
  }
  return value;
}
