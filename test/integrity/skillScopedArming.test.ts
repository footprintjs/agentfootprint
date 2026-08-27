/**
 * The harvest sees skill-scoped tools — the field bug a consumer's MCP
 * parity work surfaced (9.72.0).
 *
 * The defect: the `toolGrounding` harvest in `Agent.buildChart` read only the
 * STATIC `.tool()` registry, so an app whose `argumentsFrom` tools all ride
 * skills (delivered when a skill activates) never armed the choice-seam pair.
 * Its disposition rows read {checked: 0, notApplicable: 1} forever while the
 * app's own comments believed the checks ran — the exact green-that-checked-
 * nothing shape the disposition ledger exists to make impossible.
 *
 * The fix harvests from the FULL declared catalog (`registryByName`): a skill
 * tool's DECLARATION is known at chart build even though the tool reaches the
 * model only after its skill activates, so arming is computable up front.
 * These tests run the scoped shape end to end — every `argumentsFrom` tool
 * skill-carried with `autoActivate: 'currentSkill'`, none in the static
 * registry — and demand armed checks, a real finding, and honest rows.
 *
 * NEUTRALIZE-PROOF: revert the harvest to the static registry and every test
 * here goes red — zero findings, {checked: 0, notApplicable: 1} rows.
 *
 * Test types (Convention 3): regression (the blind harvest) / functional
 * (a fabricated value files the finding through the real loop) / contract
 * (the disposition rows prove the checks were ARMED, not merely registered).
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { defineSkill } from '../../src/injection-engine.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';

const TASK = 'What is the backup status for that machine?';

/** The ground tool — serves the real machine names. Skill-carried. */
const fleetReport = () =>
  defineTool({
    name: 'fleet_report',
    description: 'Lists the machines in the fleet by their real names.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'FLEET: callisto-02 (online), europa-03 (online)',
  });

/** The armed tool — declares its arguments come from fleet_report. Skill-carried. */
const backupStatus = () =>
  defineTool({
    name: 'backup_status',
    description: 'Reads the backup record for one machine.',
    inputSchema: {
      type: 'object',
      properties: { machine: { type: 'string' } },
      required: ['machine'],
    },
    execute: () => 'no backup record found',
    argumentsFrom: ['fleet_report'],
  });

interface Captured {
  readonly findings: Array<Record<string, unknown>>;
  readonly dispositions: Array<Record<string, unknown>>;
}

/**
 * An agent whose ONLY tools are skill-scoped: no `.tool()` registrations at
 * all, both query tools carried by one `autoActivate: 'currentSkill'` skill —
 * the exact shape of the consumer app that hit the blindness.
 */
function scopedTriageAgent(opts: { machine: string }): { agent: Agent; captured: Captured } {
  const skill = defineSkill({
    id: 'fleet-triage',
    description: 'Fleet triage: list machines, read backup records.',
    body: 'Use fleet_report to learn the real machine names before acting on one.',
    autoActivate: 'currentSkill',
    tools: [fleetReport(), backupStatus()],
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        // Turn 1: the model loads the skill — only now do its tools surface.
        {
          content: '',
          toolCalls: [{ id: 'r1', name: 'read_skill', args: { id: 'fleet-triage' } }],
          stopReason: 'tool_use' as const,
        },
        // Turn 2: the ground is fetched, so its result is in the frame.
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'fleet_report', args: {} }],
          stopReason: 'tool_use' as const,
        },
        // Turn 3: the armed call — `machine` is whatever the scenario chose.
        {
          content: '',
          toolCalls: [{ id: 'c2', name: 'backup_status', args: { machine: opts.machine } }],
          stopReason: 'tool_use' as const,
        },
        { content: 'done', toolCalls: [], stopReason: 'stop' as const },
      ],
    }),
    model: 'mock',
    maxIterations: 8,
  })
    .system('You are a fleet triage assistant.')
    .skill(skill)
    .build();
  const captured: Captured = { findings: [], dispositions: [] };
  agent.on('agentfootprint.integrity.context_error', (e) => {
    captured.findings.push(e.payload as unknown as Record<string, unknown>);
  });
  agent.on('agentfootprint.integrity.disposition', (e) => {
    captured.dispositions.push(e.payload as unknown as Record<string, unknown>);
  });
  return { agent, captured };
}

const argumentFindings = (captured: Captured): Array<Record<string, unknown>> =>
  captured.findings.filter((f) => f.kind === 'unsupported-argument');

const rowOf = (captured: Captured, check: string): CheckReport | undefined =>
  (captured.dispositions[0]?.rows as CheckReport[] | undefined)?.find((r) => r.check === check);

describe('regression: skill-scoped argumentsFrom tools ARM the choice-seam checks', () => {
  it('a fabricated value on a skill-scoped armed tool files ONE finding at seam choice', async () => {
    // 'zx-9999-phantom' appears nowhere: not in the prompt, the user message,
    // the skill body, or any tool result — the model invented it.
    const { agent, captured } = scopedTriageAgent({ machine: 'zx-9999-phantom' });
    await agent.run({ message: TASK });
    const found = argumentFindings(captured);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ seam: 'choice', predicate: 'machine' });
    expect(String(found[0]!.message)).toContain('backup_status');
    expect(String(found[0]!.message)).toContain('zx-9999-phantom');
    expect(String(found[0]!.message)).toContain('fleet_report');
  });

  it('a value served by the skill-scoped ground tool is silent — the check runs AND agrees', async () => {
    const { agent, captured } = scopedTriageAgent({ machine: 'callisto-02' });
    await agent.run({ message: TASK });
    expect(argumentFindings(captured)).toEqual([]);
    // The row proves the pass was a COMPARISON, not an unarmed shrug.
    const row = rowOf(captured, 'unsupported-argument')!;
    expect(row.checked).toBeGreaterThanOrEqual(1);
    expect(row.findings).toBe(0);
  });
});

describe('contract: the disposition ledger proves arming, not mere registration', () => {
  it('the unsupported-argument row shows a real encounter — never {checked: 0, notApplicable: 1} forever', async () => {
    const { agent, captured } = scopedTriageAgent({ machine: 'zx-9999-phantom' });
    await agent.run({ message: TASK });
    const row = rowOf(captured, 'unsupported-argument')!;
    expect(row.seam).toBe('choice');
    // The blind-harvest shape was exactly {checked: 0, findings: 0,
    // notApplicable: 1} — the lifecycle's immediate unarmed stamp, and
    // nothing else, run after run.
    expect(row.checked).toBeGreaterThanOrEqual(1);
    expect(row.findings).toBe(1);
    expect(row.lastFiredAt).toBeDefined();
  });

  it('the dangling-reference row shows the check RAN per call — the same declaration arms both seams', async () => {
    const { agent, captured } = scopedTriageAgent({ machine: 'callisto-02' });
    await agent.run({ message: TASK });
    const row = rowOf(captured, 'dangling-reference')!;
    expect(row.seam).toBe('compose');
    // Nothing was dropped this run, so each pass honestly files
    // not-applicable — but PER CALL (4 completes), not the single lifecycle
    // stamp an unarmed run files. >= 2 is the tell.
    expect(row.notApplicable).toBeGreaterThanOrEqual(2);
  });
});
