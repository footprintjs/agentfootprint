/** Shared, fixed work allowance for one prose observation. Size limits alone
 * cannot bound overlapping names across many native reads and answer fields. */
export interface ProseWorkBudget {
  readonly charge: (units: number) => void;
}

/** Internal control flow, translated to the existing input-limit observation. */
export class ProseWorkLimit extends Error {}

/** Tokens visited and characters prepared/compared share the same allowance.
 * The runtime shares one instance across all fields; pure callers default to
 * one per text. There is no process cache or application-configurable bypass. */
export function createProseWorkBudget(): ProseWorkBudget {
  let remaining = 8_000_000;
  return {
    charge(units) {
      if (remaining < 0 || units > remaining) {
        remaining = -1;
        throw new ProseWorkLimit();
      }
      remaining -= units;
    },
  };
}
