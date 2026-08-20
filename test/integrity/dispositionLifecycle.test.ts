/**
 * The disposition ledger goes LIVE — every run answers "did the checkers
 * run, and what did they see?" (T9's run-lifecycle half).
 *
 * The failure this wires against is named in the ledger's own header: two
 * shipped checks in this codebase decayed into decoration — unhooked, green,
 * counted by nobody. Per run: registered checks note one disposition per
 * encounter; the run's end files ONE `integrity.disposition` event with the
 * rows; and under `integrityPosture: 'dev'` a canary proves each pure check
 * can still catch its own synthetic defect, with `assertAlive` throwing on a
 * run whose checkers demonstrably never ran.
 *
 * Test types (Convention 3): unit (beginIntegrityRun registration + canary) /
 * functional (the live loop: rows carry real dispositions; the shadowing park
 * shows checked-fail) / contract (dev posture completes healthy; synthetic
 * counts quarantined; one event per run).
 */

import { describe, expect, it } from 'vitest';
import {
  beginIntegrityRun,
  type IntegrityChecksPresent,
} from '../../src/integrity/disposition/lifecycle.js';
import { Agent, defineTool } from '../../src/index.js';
import { defineSkill, skillGraph } from '../../src/injection-engine.js';
import { mock } from '../../src/llm-providers.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';

// ---------------------------------------------------------------------------
// The lifecycle module, on its own
// ---------------------------------------------------------------------------

const ALL: IntegrityChecksPresent = { wire: true, composeInvariant: true, dangling: true };

describe('unit: beginIntegrityRun', () => {
  it('registers exactly the present checks — absence is not a row', () => {
    const ledger = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: false },
      'observe',
    );
    const rows = ledger.report();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ check: 'invariant-violation', seam: 'wire' });
  });

  it('dev posture mints AND catches one canary per check — the pure checks prove themselves', () => {
    const ledger = beginIntegrityRun(ALL, 'dev');
    for (const row of ledger.report()) {
      expect(row.synthetic).toBe(1);
      // Real counts untouched by the canary.
      expect(row.findings).toBe(0);
      expect(row.checked).toBe(0);
    }
    // All canaries caught → a healthy dev run does not throw.
    expect(() => ledger.assertAlive({ workExisted: false })).not.toThrow();
  });

  it('observe posture mints no canary', () => {
    const ledger = beginIntegrityRun(ALL, 'observe');
    for (const row of ledger.report()) expect(row.synthetic).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Through the live loop
// ---------------------------------------------------------------------------

const call = (id: string, name: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
});
const done = { content: 'done', toolCalls: [], stopReason: 'stop' as const };

const screen = () =>
  defineTool({
    name: 'screen_open',
    description: 's',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'ok',
  });

describe('functional: the run files its disposition rows', () => {
  it('a healthy default agent: one event, a wire row of checked-passes, nothing else', async () => {
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: mock({ replies: [call('c1', 'screen_open'), done] }),
      model: 'mock',
      maxIterations: 4,
    })
      .system('s')
      .tool(screen())
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });
    await agent.run('go');
    expect(events).toHaveLength(1);
    const rows = events[0]!.rows as CheckReport[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ check: 'invariant-violation', seam: 'wire', findings: 0 });
    expect(rows[0]!.checked).toBeGreaterThanOrEqual(2); // one per LLM call
    expect(events[0]!.workExisted).toBe(true);
  });

  it('the shadowing park files a compose row with a finding COUNTED, beside the event', async () => {
    // The provider-shadowing trap from invariantViolation.test.ts, verbatim
    // in shape: a parked map whose tool name a provider copy keeps serving.
    const zoneTool = defineTool({
      name: 'get_zone_info',
      description: 'z',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'zones',
    });
    const zoneAudit = defineSkill({
      id: 'zone-audit',
      description: 'a',
      body: 'Z',
      tools: [zoneTool],
    });
    const billing = defineSkill({ id: 'billing', description: 'b', body: 'B' });
    const graph = skillGraph()
      .entry(zoneAudit, { match: { keywords: ['zone'] } })
      .route(zoneAudit, billing)
      .build();
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          call('c1', 'screen_open'),
          call('c2', 'screen_open'),
          call('c3', 'screen_open'),
          call('c4', 'screen_open'),
          done,
        ],
      }),
      model: 'mock',
      maxIterations: 8,
    })
      .system('s')
      .tool(screen())
      .skillGraph(graph)
      .maps({ renewalGrace: 3 })
      .toolProvider({
        id: 'shadow-provider',
        list: () => [
          defineTool({
            name: 'get_zone_info',
            description: 'provider copy',
            inputSchema: { type: 'object', properties: {} },
            execute: () => 'provider zones',
          }),
        ],
      })
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });
    await agent.run('find the most recent zone redundancy run');
    expect(events).toHaveLength(1);
    const rows = events[0]!.rows as CheckReport[];
    const compose = rows.find((r) => r.seam === 'compose' && r.check === 'invariant-violation');
    expect(compose).toBeDefined();
    expect(compose!.findings).toBeGreaterThanOrEqual(1);
    expect(compose!.lastFiredAt).toBeDefined();
  });

  it('dev posture: a healthy run completes, canaries caught, synthetic counts quarantined', async () => {
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: mock({ replies: [done] }),
      model: 'mock',
      maxIterations: 3,
      integrityPosture: 'dev',
    })
      .system('s')
      .tool(screen())
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });
    await agent.run('go');
    expect(events).toHaveLength(1);
    expect(events[0]!.posture).toBe('dev');
    const rows = events[0]!.rows as CheckReport[];
    expect(rows[0]!.synthetic).toBe(1);
    expect(rows[0]!.findings).toBe(0);
  });
});
