/**
 * Type-level tests — the findings ledger's DECLARATIONS on state, options
 * and the checkpoint (9.101.0, step 2 of the findings-ledger program).
 *
 * Pattern: Test-as-specification (compile-time via `expectTypeOf`).
 * Role:    Pin the three public shapes so no name drifts before the serving
 *          steps land: `AgentOptions.findings`, `AgentState.findingsLedger`
 *          and `AgentRunCheckpoint.findingsLedger` — all optional, all
 *          absent by default, the checkpoint's and the state's the SAME
 *          `FindingsLedger` so a continued run re-seeds what it stored.
 */

import { describe, it, expectTypeOf } from 'vitest';
import type { AgentOptions, AgentState } from '../../../src/core/agent/types.js';
import type { AgentRunCheckpoint } from '../../../src/core/runCheckpoint.js';
import type { FindingsLedger, FindingsRow } from '../../../src/core/agent/findings/types.js';

describe('findings declarations — AgentOptions.findings', () => {
  it('is optional and carries only `serve` and `keepLedgerFacts`', () => {
    expectTypeOf<AgentOptions['findings']>().toEqualTypeOf<
      | {
          readonly serve?: 'ledger-and-facts' | 'ledger-only';
          readonly keepLedgerFacts?: number | false;
        }
      | undefined
    >();
  });

  it('an agent that never calls .findings() types the option as absent', () => {
    const opts: AgentOptions = {} as AgentOptions;
    expectTypeOf(opts.findings).toEqualTypeOf<AgentOptions['findings']>();
  });
});

describe('findings declarations — AgentState.findingsLedger', () => {
  it('is the optional FindingsLedger — one flat list of basis / standing / conflict rows', () => {
    expectTypeOf<AgentState['findingsLedger']>().toEqualTypeOf<FindingsLedger | undefined>();
    expectTypeOf<FindingsLedger>().toEqualTypeOf<readonly FindingsRow[]>();
    expectTypeOf<FindingsRow['kind']>().toEqualTypeOf<'basis' | 'standing' | 'conflict'>();
  });
});

describe('findings declarations — AgentRunCheckpoint.findingsLedger', () => {
  it('is the SAME FindingsLedger the state holds, optional, on version 1', () => {
    expectTypeOf<AgentRunCheckpoint['findingsLedger']>().toEqualTypeOf<
      AgentState['findingsLedger']
    >();
    expectTypeOf<AgentRunCheckpoint['version']>().toEqualTypeOf<1>();
  });
});
