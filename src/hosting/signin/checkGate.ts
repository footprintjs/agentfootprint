/**
 * hosting/signin/checkGate — a door-wide cap on concurrent password checks.
 *
 * A password check is slow on purpose (scrypt holds 128 MiB and a thread for a
 * sizeable fraction of a second; a directory bind is a network round trip). An
 * unauthenticated burst of parallel logins would otherwise queue hundreds of
 * them and starve the process's shared thread pool — file I/O, DNS, zlib — for
 * everybody. So at most `concurrent` checks run at once, at most `queue` wait,
 * and anything beyond is refused at once (503 with `Retry-After`).
 */

export interface CheckGateOptions {
  /** Checks running at once. Default 4. */
  readonly concurrent?: number;
  /** Checks waiting for a slot. Default 32. */
  readonly queue?: number;
}

export interface CheckGate {
  /** Run `check` when a slot is free; `undefined` when the queue is already full. */
  run<T>(check: () => Promise<T>): Promise<{ readonly value: T } | undefined>;
  readonly concurrent: number;
}

export function checkGate(options: CheckGateOptions = {}): CheckGate {
  const concurrent = whole(options.concurrent ?? 4, 'concurrent', 1);
  const queue = whole(options.queue ?? 32, 'queue', 0);
  let running = 0;
  const waiting: (() => void)[] = [];

  const release = (): void => {
    const next = waiting.shift();
    if (next !== undefined) next();
    else running -= 1;
  };

  return {
    concurrent,
    async run(check) {
      if (running >= concurrent) {
        if (waiting.length >= queue) return undefined;
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        running += 1;
      }
      try {
        return { value: await check() };
      } finally {
        release();
      }
    },
  };
}

function whole(value: number, name: string, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new TypeError(`[hosting] signInDoor checks.${name} is a whole number, ${min} or more.`);
  }
  return value;
}
