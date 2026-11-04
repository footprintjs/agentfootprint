/**
 * The ledger key for a handler built with no `currentRun` accessor — a
 * hand-composed dispatch loop in a test, never an Agent (which always wires
 * it).
 *
 * One shared bucket, stated rather than hidden: without a run id there is
 * nothing to tell two runs apart by, and the honest consequence is that such a
 * loop counts across them. It cannot leak anything — the ledger holds
 * fingerprints — and the only visible effect is a note arriving one call early.
 */
export const UNSCOPED_RUN = '#no-run-id';
