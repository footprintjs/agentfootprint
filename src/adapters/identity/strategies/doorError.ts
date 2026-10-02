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

/**
 * `IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER` as the door's `limits` fragment —
 * absent when unset (the default: an address is only delayed), refused at boot
 * when 0 (a refusal after no failures would refuse everybody).
 */
export function addressRefusalLimits(
  value: number | undefined,
): { readonly refuseAddressAfter: number } | undefined {
  if (value === undefined) return undefined;
  if (value < 1) {
    throw new IdentityConfigError(
      'IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER is the number of failed sign-ins from one address ' +
        'after which it is refused, at least 1. Leave it unset to only delay (the default).',
      'IDENTITY_SIGN_IN_ADDRESS_REFUSE_AFTER',
    );
  }
  return { refuseAddressAfter: value };
}
