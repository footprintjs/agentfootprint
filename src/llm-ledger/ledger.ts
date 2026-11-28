/**
 * llm-ledger/ledger — `createLedger`: the host's side and the agent's side of one ledger.
 *
 * Pattern: a facade. Every call is one short run (`calls.ts`), queued per session (`queue.ts`).
 *          The agent's calls are bound to one session and take no session argument.
 * Role:    the one entry point this folder offers; the doors (MCP, the command line) are a later
 *          pull request and call only this.
 * Emits:   N/A.
 *
 * Every reply is `{ ok: true, … }` or `{ ok: false, refused: <word> }` (`store` beside
 * `store-refused`). Rules are registered once, here: the three built-ins and the host's
 * (`rules/port.ts`); a rule that cannot be registered throws `LedgerRuleError`. A session opened
 * without `rules` runs the built-ins (chosen here).
 */
import type { RedactionPolicy } from 'footprintjs';

import { runCall } from './calls.js';
import type { LedgerConfirm } from './calls.js';
import type { LedgerCallKind } from './stages.js';
import { cited } from './rules/cited.js';
import { registerRules, ruleKey } from './rules/port.js';
import type { LedgerRule } from './rules/port.js';
import { timeWindow } from './rules/timeWindow.js';
import { createTimeWindowCoverage } from './rules/timeWindowCoverage.js';
import { traceableValues } from './rules/traceableValues.js';
import { sessionQueue } from './queue.js';
import type { LedgerServed } from './serve.js';
import { mintSessionId } from './session.js';
import type { LedgerStore } from './store.js';

/** What `createLedger` takes. */
export interface LedgerOptions {
  readonly store: LedgerStore;
  /** Host rules, beside the built-ins. */
  readonly rules?: readonly LedgerRule[];
  /** Given: every executor gets it, and every served string is masked unless it is a known kind. */
  readonly redaction?: RedactionPolicy;
  /** The person channel for sessions opened with `confirm: true`. */
  readonly confirm?: LedgerConfirm;
  /** The host's clock, RFC 3339 UTC. */
  readonly clock?: () => string;
  /** Each run's snapshot, for audits. */
  readonly runs?: (record: { readonly call: LedgerCallKind; readonly snapshot: unknown }) => void;
}

/** The host's calls. */
export interface LedgerHost {
  open(input?: unknown): Promise<LedgerServed>;
  record(session: string, input: unknown): Promise<LedgerServed>;
  supply(session: string, input: unknown): Promise<LedgerServed>;
  deliver(session: string, input: unknown): Promise<LedgerServed>;
  report(session: string): Promise<LedgerServed>;
}

/** The agent's calls, bound to one session. */
export interface LedgerAgent {
  note(input: unknown): Promise<LedgerServed>;
  withdraw(input: unknown): Promise<LedgerServed>;
  ask(input?: unknown): Promise<LedgerServed>;
  submit(input: unknown): Promise<LedgerServed>;
}

/** One ledger. */
export interface Ledger {
  readonly host: LedgerHost;
  agentFor(session: string): LedgerAgent;
}

/** The built-in rules, in the order a session runs them. */
export const BUILT_IN_RULES: readonly LedgerRule[] = Object.freeze([
  cited,
  traceableValues,
  timeWindow,
]);

/** A ledger over `options.store`. */
export function createLedger(options: LedgerOptions): Ledger {
  const rules = registerRules([...BUILT_IN_RULES, createTimeWindowCoverage()], options.rules ?? []);
  const ctx = {
    store: options.store,
    rules,
    builtInKeys: BUILT_IN_RULES.map(ruleKey),
    ...(options.redaction === undefined ? {} : { redaction: options.redaction }),
    ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
    clock: options.clock ?? (() => new Date().toISOString()),
    ...(options.runs === undefined ? {} : { runs: options.runs }),
  };
  const queue = sessionQueue();
  const busy = (): LedgerServed => ({ ok: false, refused: 'busy' });
  const call = (kind: LedgerCallKind, session: string, input: unknown) =>
    queue.run(session, () => runCall(ctx, kind, session, input), busy);
  return Object.freeze({
    host: Object.freeze({
      open: (input: unknown = {}) => {
        const session = mintSessionId();
        return call('open', session, input);
      },
      record: (session: string, input: unknown) => call('record', session, input),
      supply: (session: string, input: unknown) => call('supply', session, input),
      deliver: (session: string, input: unknown) => call('deliver', session, input),
      report: (session: string) => call('report', session, {}),
    }),
    agentFor: (session: string) =>
      Object.freeze({
        note: (input: unknown) => call('note', session, input),
        withdraw: (input: unknown) => call('withdraw', session, input),
        ask: (input: unknown = {}) => call('ask', session, input),
        submit: (input: unknown) => call('submit', session, input),
      }),
  });
}
