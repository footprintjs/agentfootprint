/**
 * The external-ground door (9.72.0) — an app vouches for values the run
 * itself never served, and the choice-seam check counts them as ground.
 *
 * The driving case: a person clicked a row in the app's data panel, the app
 * VERIFIED the clicked cells against the artifact the panel renders, and the
 * model was told to act on that selection. The identifier it passes to an
 * armed tool came from a human's verified selection — not fabrication — but
 * the run served it nowhere, so without this door the check files a finding.
 *
 * The laws under test:
 *  (a) DECLARED, never ambient — the only door is `AgentOptions.externalGrounds`;
 *  (b) the record says WHICH source grounded a value —
 *      `agentfootprint.integrity.external_ground_used` carries the label;
 *  (c) absent or empty provider = byte-identical — the same run without the
 *      provider files exactly one finding;
 *  (d) a provider that throws or yields garbage never aborts a run.
 *
 * NEUTRALIZE-PROOF: drop the corpus join (the `external` fence in
 * `unsupportedArgumentsOf`) and the no-finding tests here go red.
 *
 * Test types (Convention 3): unit (the fence + hygiene) / functional (the
 * door through the real loop) / contract (the excusal record and the
 * disposition rows) / negative (garbage never throws).
 */

import { describe, expect, it } from 'vitest';
import {
  unsupportedArgumentsOf,
  type ArgumentChoice,
  type ChoiceCorpus,
  type ExternalGround,
} from '../../src/integrity/unsupported-argument/check.js';
import { Agent, defineTool, type ExternalGroundsProvider } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';

// ---------------------------------------------------------------------------
// The fence, on its own
// ---------------------------------------------------------------------------

const chose = (args: Record<string, unknown>): ArgumentChoice => ({
  toolName: 'backup_status',
  toolCallId: 'call-2',
  args,
  argumentsFrom: ['fleet_report'],
});

const corpus = (
  grounded: string[],
  external?: readonly ExternalGround[],
): ChoiceCorpus => ({
  grounded,
  assistant: [],
  ...(external !== undefined && { external }),
});

describe('unit: the external-ground fence', () => {
  it('a value present ONLY in an external ground files no finding and one excusal with its source', () => {
    const { findings, externalGroundings } = unsupportedArgumentsOf(
      [chose({ machine: 'srv-render-4471' })],
      corpus(['nothing useful here'], [{ value: 'srv-render-4471', source: 'viewer-selection' }]),
      2,
    );
    expect(findings).toEqual([]);
    expect(externalGroundings).toEqual([
      {
        toolName: 'backup_status',
        toolCallId: 'call-2',
        path: 'machine',
        value: 'srv-render-4471',
        source: 'viewer-selection',
      },
    ]);
  });

  it('the SAME corpus without the external entry files the finding — the entry is load-bearing', () => {
    const { findings, externalGroundings } = unsupportedArgumentsOf(
      [chose({ machine: 'srv-render-4471' })],
      corpus(['nothing useful here']),
      2,
    );
    expect(findings).toHaveLength(1);
    expect(externalGroundings).toEqual([]);
  });

  it('matching is substring and case-insensitive — the served fence’s own leniency', () => {
    const { findings, externalGroundings } = unsupportedArgumentsOf(
      [chose({ machine: 'SRV-RENDER-4471' })],
      corpus(['nothing'], [{ value: 'row: srv-render-4471 | eu-west', source: 'viewer-selection' }]),
      2,
    );
    expect(findings).toEqual([]);
    expect(externalGroundings).toHaveLength(1);
  });

  it('a value the RUN served needs no excuse — no excusal record for it', () => {
    const { findings, externalGroundings } = unsupportedArgumentsOf(
      [chose({ machine: 'callisto-02' })],
      corpus(
        ['FLEET: callisto-02 (online)'],
        [{ value: 'callisto-02', source: 'viewer-selection' }],
      ),
      2,
    );
    expect(findings).toEqual([]);
    // Served wins first: an excusal on the record always means the app's
    // assertion was the ONLY ground.
    expect(externalGroundings).toEqual([]);
  });

  it('garbage entries never throw and ground nothing — blank values, unlabeled sources, non-objects', () => {
    const junk = [
      null,
      42,
      'just-a-string',
      { value: '', source: 'viewer-selection' },
      { value: '   ', source: 'viewer-selection' },
      { value: 'srv-render-4471', source: '' },
      { value: 'srv-render-4471', source: '   ' },
      { value: 4471, source: 'viewer-selection' },
      { source: 'viewer-selection' },
      {},
    ] as unknown as readonly ExternalGround[];
    const { findings, externalGroundings } = unsupportedArgumentsOf(
      [chose({ machine: 'srv-render-4471' })],
      corpus(['nothing useful here'], junk),
      2,
    );
    // Every entry was unusable, so the value stands unserved: one finding.
    expect(findings).toHaveLength(1);
    expect(externalGroundings).toEqual([]);
  });

  it('a non-array external field is treated as absent, never a crash', () => {
    const { findings } = unsupportedArgumentsOf(
      [chose({ machine: 'srv-render-4471' })],
      {
        grounded: ['nothing'],
        assistant: [],
        external: 'not-an-array' as unknown as readonly ExternalGround[],
      },
      2,
    );
    expect(findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Through the live loop
// ---------------------------------------------------------------------------

const fleetReport = () =>
  defineTool({
    name: 'fleet_report',
    description: 'Lists the machines in the fleet by their real names.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'FLEET: callisto-02 (online), europa-03 (online)',
  });

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

const TASK = 'What is the backup status for the machine I selected?';

interface Captured {
  readonly findings: Array<Record<string, unknown>>;
  readonly excusals: Array<Record<string, unknown>>;
  readonly dispositions: Array<Record<string, unknown>>;
}

/** The viewer-selection turn: the model acts on 'srv-render-4471', which the
 *  RUN never serves — only the app's provider (when present) vouches for it. */
function selectionAgent(externalGrounds?: ExternalGroundsProvider): {
  agent: Agent;
  captured: Captured;
} {
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'backup_status', args: { machine: 'srv-render-4471' } }],
          stopReason: 'tool_use' as const,
        },
        { content: 'done', toolCalls: [], stopReason: 'stop' as const },
      ],
    }),
    model: 'mock',
    maxIterations: 6,
    ...(externalGrounds !== undefined && { externalGrounds }),
  })
    .system('You are a fleet triage assistant.')
    .tool(fleetReport())
    .tool(backupStatus())
    .build();
  const captured: Captured = { findings: [], excusals: [], dispositions: [] };
  agent.on('agentfootprint.integrity.context_error', (e) => {
    captured.findings.push(e.payload as unknown as Record<string, unknown>);
  });
  agent.on('agentfootprint.integrity.external_ground_used', (e) => {
    captured.excusals.push(e.payload as unknown as Record<string, unknown>);
  });
  agent.on('agentfootprint.integrity.disposition', (e) => {
    captured.dispositions.push(e.payload as unknown as Record<string, unknown>);
  });
  return { agent, captured };
}

const argumentFindings = (captured: Captured): Array<Record<string, unknown>> =>
  captured.findings.filter((f) => f.kind === 'unsupported-argument');

describe('functional: the door through the real loop', () => {
  it('a value present ONLY in externalGrounds files no finding, and the record shows the source', async () => {
    const { agent, captured } = selectionAgent(() => [
      { value: 'srv-render-4471', source: 'viewer-selection' },
    ]);
    await agent.run({ message: TASK });
    expect(argumentFindings(captured)).toEqual([]);
    expect(captured.excusals).toHaveLength(1);
    expect(captured.excusals[0]).toMatchObject({
      toolName: 'backup_status',
      path: 'machine',
      value: 'srv-render-4471',
      source: 'viewer-selection',
    });
    // The disposition row records a real comparison that PASSED.
    const rows = captured.dispositions[0]!.rows as CheckReport[];
    const row = rows.find((r) => r.check === 'unsupported-argument')!;
    expect(row.checked).toBeGreaterThanOrEqual(1);
    expect(row.findings).toBe(0);
  });

  it('the SAME run without the provider files exactly one unsupported-argument finding', async () => {
    const { agent, captured } = selectionAgent();
    await agent.run({ message: TASK });
    const found = argumentFindings(captured);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ seam: 'choice', predicate: 'machine' });
    expect(String(found[0]!.message)).toContain('srv-render-4471');
    expect(captured.excusals).toEqual([]);
  });
});

describe('negative: a misbehaving provider never touches the run', () => {
  it('a provider that THROWS contributes nothing and the run completes', async () => {
    const { agent, captured } = selectionAgent(() => {
      throw new Error('viewer state not ready');
    });
    const result = await agent.run({ message: TASK });
    expect(result).toBe('done');
    // Nothing grounded, so the honest verdict stands: one finding.
    expect(argumentFindings(captured)).toHaveLength(1);
    expect(captured.excusals).toEqual([]);
  });

  it('a provider yielding garbage contributes nothing and the run completes', async () => {
    const { agent, captured } = selectionAgent(
      (() => 'garbage') as unknown as ExternalGroundsProvider,
    );
    const result = await agent.run({ message: TASK });
    expect(result).toBe('done');
    expect(argumentFindings(captured)).toHaveLength(1);
  });

  it('a provider yielding an empty list is byte-identical to no provider', async () => {
    const { agent, captured } = selectionAgent(() => []);
    const result = await agent.run({ message: TASK });
    expect(result).toBe('done');
    expect(argumentFindings(captured)).toHaveLength(1);
    expect(captured.excusals).toEqual([]);
  });

  it('a non-function option is refused at construction, never mid-run', () => {
    expect(() =>
      Agent.create({
        provider: mock({ replies: [] }),
        model: 'mock',
        externalGrounds: 'viewer-selection' as unknown as ExternalGroundsProvider,
      }).build(),
    ).toThrow(/externalGrounds must be a function/);
  });
});
