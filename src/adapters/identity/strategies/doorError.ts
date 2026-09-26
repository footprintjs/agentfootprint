/**
 * strategies/doorError — a sign-in door's construction refusal, re-raised as a
 * boot refusal naming the ENV key. The door names the option it refused
 * (`SignInDoorConfigError.option`); this maps it — never a regex over text.
 */

import { MemorySignInsConfigError, SignInDoorConfigError } from '../../../hosting/signin/errors.js';
import { IdentityConfigError } from './config.js';

const ENV_FOR_OPTION: Readonly<Record<string, string>> = {
  publicUrl: 'IDENTITY_PUBLIC_URL',
  hours: 'IDENTITY_SIGN_IN_HOURS',
  idleMinutes: 'IDENTITY_SIGN_IN_IDLE_MINUTES',
  max: 'IDENTITY_SIGN_IN_MAX',
  perAccount: 'IDENTITY_SIGN_IN_MAX',
  trustedProxies: 'IDENTITY_TRUSTED_PROXIES',
};

/** Re-raise a door/store construction refusal as an {@link IdentityConfigError}. */
export function doorRefusal(strategy: string, err: unknown): IdentityConfigError {
  if (err instanceof IdentityConfigError) return err;
  const option =
    err instanceof SignInDoorConfigError || err instanceof MemorySignInsConfigError
      ? err.option
      : undefined;
  const text =
    err instanceof Error ? err.message.replace(/^\[(hosting|identity)\] /, '') : String(err);
  return new IdentityConfigError(
    `${strategy} cannot start: ${text}`,
    option === undefined ? undefined : ENV_FOR_OPTION[option],
  );
}
