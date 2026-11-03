/**
 * The ledger-fact hold's default ceiling (9.102.0): how many fact turns the
 * window holds beyond `keepRecentTurns` when `.findings()` and a window
 * strategy are both configured and nobody named a number. Resolved in the
 * constructor, ONCE, and threaded to `buildWindowStage` as a plain number —
 * the stage applies no default of its own (absent = unarmed = no hold), so a
 * reader has one place to look. `window/options.ts ·
 * DEFAULT_KEEP_LAST_TOOL_RESULTS` is the pin's twin of this constant.
 */
const DEFAULT_KEEP_LEDGER_FACTS = 4;

/**
 * Validate the `keepLedgerFacts` dial — `window/options.ts ·
 * requireKeepLastToolResults`'s twin: the same rule, the same moment.
 * Refused at construction, never mid-run.
 */
export function requireKeepLedgerFacts(value: unknown, label: string): void {
  if (value === false) return;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(
      `${label}: keepLedgerFacts must be a whole number >= 0, or false, got ` +
        `${String(value)}. It is how many fact turns the window holds beyond ` +
        `keepRecentTurns under .findings(); 0 and false both switch the hold off.`,
    );
  }
}

/** `false` → `0`; a number as named; nothing named → the default. */
export function resolveKeepLedgerFacts(named: number | false | undefined): number {
  if (named === false) return 0;
  return named ?? DEFAULT_KEEP_LEDGER_FACTS;
}
