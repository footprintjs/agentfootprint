/**
 * hosting/signin/errors — the sign-in pieces' construction and capacity
 * refusals, each naming what is at fault.
 */

/** A sign-in door option that cannot be honoured — `option` names it. */
export class SignInDoorConfigError extends TypeError {
  readonly code = 'ERR_SIGN_IN_DOOR_CONFIG' as const;
  /** The option at fault (`publicUrl`, `hours`, `guard`, `trustedProxies`, …). */
  readonly option: string;

  constructor(option: string, sentence: string) {
    super(`[hosting] signInDoor: ${sentence}.`);
    this.name = 'SignInDoorConfigError';
    this.option = option;
  }
}

/** A `memorySignIns` option that cannot be honoured — `option` names it. */
export class MemorySignInsConfigError extends TypeError {
  readonly code = 'ERR_MEMORY_SIGN_INS_CONFIG' as const;
  readonly option: string;

  constructor(option: string, sentence: string) {
    super(`[hosting] memorySignIns: ${sentence}.`);
    this.name = 'MemorySignInsConfigError';
    this.option = option;
  }
}

/**
 * The sign-in store is full of LIVE sign-ins and will not evict another
 * person's to make room — the new sign-in is refused (the door answers 503)
 * instead of signing somebody else out.
 */
export class SignInStoreFullError extends Error {
  readonly code = 'ERR_SIGN_IN_STORE_FULL' as const;

  constructor(max: number) {
    super(
      `[hosting] the sign-in store holds ${max} live sign-ins, its cap. A new sign-in is ` +
        `refused rather than ending somebody else's; raise the cap or use a shared store.`,
    );
    this.name = 'SignInStoreFullError';
  }
}

/**
 * A password check that never reached its backend — the directory could not
 * be connected to, or its TLS handshake failed — so the password was never
 * sent and nobody's lockout counter moved. The door un-counts the attempt.
 * Any OTHER error from a check (a bind that timed out after it was sent) keeps
 * the attempt counted: the directory may have charged it (review idI57 S-6).
 */
export class PasswordCheckUnreachableError extends Error {
  readonly code = 'ERR_PASSWORD_CHECK_UNREACHABLE' as const;

  constructor(sentence: string, options?: { cause?: unknown }) {
    super(`[hosting] ${sentence}`, options);
    this.name = 'PasswordCheckUnreachableError';
  }
}
