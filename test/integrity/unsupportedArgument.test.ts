/**
 * unsupported-argument at the CHOICE seam — the model acted on a value
 * nothing served (the fifth and last Context Integrity check).
 *
 * The recorded failure this exists for: on turn 2 of a triage conversation
 * the window had dropped the user message carrying the true entity id and
 * kept the assistant's own rendered answer. Asked for "the status for that
 * machine", the model resolved the reference out of its OWN prior prose,
 * grabbed a truncated job-name fragment as if it were a machine name, called
 * the lookup tool with it, got an honest "nothing found", and reported that a
 * protected machine had no backup record. Every shipped rail passed honestly:
 * the coverage envelope, the absence envelope and the evidence gate all held,
 * because every value in the answer really was grounded. The defect was the
 * REFERENT, bound wrong at the argument — the one seam with no check.
 *
 * The fences are the check's honesty, and each one is a test below: non-string
 * arguments are never checked, values under four characters are never checked,
 * a value served anywhere in the frame passes, a value the tool's own schema
 * declares as an enum passes, and the two remaining states — grounded only in
 * the model's own prose, and grounded nowhere at all — file findings with
 * DIFFERENT messages, because they call for different fixes.
 *
 * Test types (Convention 3): unit (the rule, every fence, both messages, the
 * schema-enum reader) / functional (the live loop: a self-referenced argument
 * files ONE finding at seam 'choice'; a user-supplied one is silent) /
 * regression (identity dedup across re-detection; an undeclared agent runs
 * zero-delta) / contract (the disposition rows land).
 */

import { describe, expect, it } from 'vitest';
import {
  declaredEnumValuesOf,
  unsupportedArgumentsOf,
  type ArgumentChoice,
  type ChoiceCorpus,
} from '../../src/integrity/unsupported-argument/check.js';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';

// ---------------------------------------------------------------------------
// The check, on its own
// ---------------------------------------------------------------------------

/** One armed call — `backup_status` declares that its arguments come from `fleet_report`. */
const chose = (
  args: Record<string, unknown>,
  extra: Partial<ArgumentChoice> = {},
): ArgumentChoice => ({
  toolName: 'backup_status',
  toolCallId: 'call-2',
  args,
  argumentsFrom: ['fleet_report'],
  ...extra,
});

const corpus = (grounded: string[], assistant: string[] = []): ChoiceCorpus => ({
  grounded,
  assistant,
});

describe('unit: unsupportedArgumentsOf — the rule', () => {
  it('a value whose only ground is the model’s own earlier prose files a finding', () => {
    const found = unsupportedArgumentsOf(
      [chose({ machine: '4417-ganymede' })],
      corpus(
        ['You are a fleet triage assistant.', 'What is the backup status for that machine?'],
        ['The nightly job bkp-4417-ganymede-tier2 finished at 02:14.'],
      ),
      2,
    ).findings;
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.kind).toBe('unsupported-argument');
    expect(f.seam).toBe('choice');
    expect(f.epoch).toBe(2);
    expect(f.subjects).toEqual([{ kind: 'tool', id: 'backup_status' }]);
    // The dot-path IS the identity discriminator (see contextErrorIdentity).
    expect(f.predicate).toBe('machine');
    expect(f.witnesses).toHaveLength(2);
    expect(f.witnesses[0]!.value).toBe('4417-ganymede');
    expect(f.witnesses[0]!.provenance).toContain('call-2');
    // The second witness describes the CORPUS, so a reader can see what was
    // searched before the value was called unserved.
    expect(f.witnesses[1]!.provenance).toContain('served string');
    expect(f.witnesses[1]!.provenance).toContain('assistant turn');
    // The message names the defect AND the honest fix: re-fetch the ground.
    expect(f.message).toContain('backup_status');
    expect(f.message).toContain('4417-ganymede');
    expect(f.message).toContain('fleet_report');
    expect(f.message).toMatch(/own earlier answer|own earlier prose/i);
  });

  it('a value grounded NOWHERE gets a different message from a self-referenced one', () => {
    const nowhere = unsupportedArgumentsOf(
      [chose({ machine: 'ganymede-99' })],
      corpus(['You are a fleet triage assistant.', 'Check that machine please.'], ['Checking.']),
      2,
    ).findings[0]!;
    const selfOnly = unsupportedArgumentsOf(
      [chose({ machine: 'ganymede-99' })],
      corpus(['You are a fleet triage assistant.'], ['I looked at ganymede-99 earlier.']),
      2,
    ).findings[0]!;
    expect(nowhere.kind).toBe('unsupported-argument');
    expect(selfOnly.kind).toBe('unsupported-argument');
    expect(nowhere.message).not.toBe(selfOnly.message);
    // Nowhere: nothing in the window served it at all.
    expect(nowhere.message).toMatch(/nowhere/i);
    expect(nowhere.message).toContain('tool result');
    // Self-reference: rendered text is not evidence.
    expect(selfOnly.message).toMatch(/own earlier answer|own earlier prose/i);
  });

  it('one finding per offending argument, each carrying its own dot-path', () => {
    const found = unsupportedArgumentsOf(
      [chose({ machine: 'ganymede-99', region: 'sector-77' })],
      corpus(['nothing useful here']),
      2,
    ).findings;
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.predicate).sort()).toEqual(['machine', 'region']);
  });

  it('nested objects and arrays are walked; the path is the dot-path to the leaf', () => {
    const found = unsupportedArgumentsOf(
      [chose({ filter: { hosts: ['ganymede-99'] } })],
      corpus(['nothing useful here']),
      2,
    ).findings;
    expect(found).toHaveLength(1);
    expect(found[0]!.predicate).toBe('filter.hosts.0');
  });

  it('no armed calls means no work — an empty list is an empty answer', () => {
    expect(unsupportedArgumentsOf([], corpus(['anything']), 2).findings).toEqual([]);
  });
});

describe('unit: the fences', () => {
  it('FENCE — a non-string argument is never checked', () => {
    // Numbers, booleans and null are not identifier-shaped; substring
    // grounding over them would accuse every literal the model computed.
    expect(
      unsupportedArgumentsOf(
        [chose({ count: 4417, latest: true, note: null, missing: undefined })],
        corpus(['nothing useful here']),
        2,
      ).findings,
    ).toEqual([]);
  });

  it('FENCE — a value shorter than four characters is never checked', () => {
    // Below four characters substring matching is noise: 'ok', 'a1' and 'up'
    // land inside unrelated words in any corpus, in both directions.
    expect(
      unsupportedArgumentsOf([chose({ mode: 'up', tier: 'a1 ' })], corpus(['x']), 2).findings,
    ).toEqual([]);
  });

  it('FENCE — a value served anywhere in the frame passes, case-insensitively', () => {
    expect(
      unsupportedArgumentsOf(
        [chose({ machine: 'Ganymede-01' })],
        corpus(['status for ganymede-01 please']),
        2,
      ).findings,
    ).toEqual([]);
  });

  it('FENCE — a value inside a TOOL RESULT passes (results are ground)', () => {
    expect(
      unsupportedArgumentsOf(
        [chose({ machine: 'ganymede-01' })],
        corpus(['You are a triage assistant.', 'FLEET: ganymede-01, callisto-02']),
        2,
      ).findings,
    ).toEqual([]);
  });

  it('FENCE — a value the tool’s own inputSchema declares as an enum passes', () => {
    const declared = declaredEnumValuesOf({
      type: 'object',
      properties: { window: { type: 'string', enum: ['nightly', 'weekly'] } },
    });
    expect(
      unsupportedArgumentsOf(
        [chose({ window: 'nightly' }, { declaredEnums: declared })],
        corpus(['nothing useful here']),
        2,
      ).findings,
    ).toEqual([]);
  });

  it('FENCE — the declared enum is matched case-insensitively too', () => {
    expect(
      unsupportedArgumentsOf(
        [chose({ window: 'NIGHTLY' }, { declaredEnums: new Set(['nightly']) })],
        corpus(['nothing useful here']),
        2,
      ).findings,
    ).toEqual([]);
  });

  it('FENCE — an absent schema means no enum fence, never a crash', () => {
    expect(declaredEnumValuesOf(undefined).size).toBe(0);
    expect(
      unsupportedArgumentsOf([chose({ window: 'nightly' })], corpus(['nothing here']), 2).findings,
    ).toHaveLength(1);
  });

  it('the quoted value is capped so one long argument cannot flood the message', () => {
    const long = `ganymede-${'x'.repeat(400)}`;
    const found = unsupportedArgumentsOf(
      [chose({ machine: long })],
      corpus(['nothing']),
      2,
    ).findings;
    expect(found).toHaveLength(1);
    expect(found[0]!.message.length).toBeLessThan(600);
    expect(found[0]!.message).toContain('…');
    // The witness keeps the value whole — the cap is a display rule only.
    expect(found[0]!.witnesses[0]!.value).toBe(long);
  });
});

describe('unit: declaredEnumValuesOf', () => {
  it('collects enum values declared at any depth of the schema', () => {
    const values = declaredEnumValuesOf({
      type: 'object',
      properties: {
        window: { type: 'string', enum: ['nightly', 'weekly'] },
        filter: {
          type: 'object',
          properties: { tier: { type: 'string', enum: ['gold', 'silver'] } },
        },
        hosts: { type: 'array', items: { type: 'string', enum: ['a-host'] } },
      },
    });
    expect([...values].sort()).toEqual(['a-host', 'gold', 'nightly', 'silver', 'weekly']);
  });

  it('ignores non-string enum members and non-object schemas', () => {
    expect([...declaredEnumValuesOf({ enum: [1, true, 'keep'] })]).toEqual(['keep']);
    expect(declaredEnumValuesOf('not a schema').size).toBe(0);
    expect(declaredEnumValuesOf(null).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Through the live loop
// ---------------------------------------------------------------------------

/**
 * The anonymised triage turn, as a runnable agent. `fleet_report` serves the
 * real machine names; `backup_status` declares that its arguments come from
 * `fleet_report` — the ONE declaration that arms both compose-seam
 * dangling-reference and this choice-seam check.
 */
const fleetReport = () =>
  defineTool({
    name: 'fleet_report',
    description: 'Lists the machines in the fleet by their real names.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'FLEET: callisto-02 (online), europa-03 (online)',
  });

const backupStatus = (armed: boolean) =>
  defineTool({
    name: 'backup_status',
    description: 'Reads the backup record for one machine.',
    inputSchema: {
      type: 'object',
      properties: { machine: { type: 'string' } },
      required: ['machine'],
    },
    execute: () => 'no backup record found',
    ...(armed && { argumentsFrom: ['fleet_report'] }),
  });

/** The assistant turn that renders a job name the model later mines for an id. */
const RENDERED_ANSWER = 'The nightly job bkp-4417-ganymede-tier2 finished at 02:14.';
const TASK = 'What is the backup status for that machine?';

interface Captured {
  readonly findings: Array<Record<string, unknown>>;
  readonly dispositions: Array<Record<string, unknown>>;
}

function triageAgent(opts: {
  armed: boolean;
  /** The value the model puts in `machine` on the armed call. */
  machine: string;
  /** Repeat the offending call, to exercise identity dedup. */
  repeat?: boolean;
}): { agent: Agent; captured: Captured } {
  const bad = {
    content: '',
    toolCalls: [{ id: 'c2', name: 'backup_status', args: { machine: opts.machine } }],
    stopReason: 'tool_use' as const,
  };
  const agent = Agent.create({
    provider: mock({
      replies: [
        // Turn 1: the model both renders prose AND calls the grounding tool,
        // so the rendered text lands in history as an ASSISTANT message.
        {
          content: RENDERED_ANSWER,
          toolCalls: [{ id: 'c1', name: 'fleet_report', args: {} }],
          stopReason: 'tool_use' as const,
        },
        bad,
        ...(opts.repeat === true ? [bad] : []),
        { content: 'done', toolCalls: [], stopReason: 'stop' as const },
      ],
    }),
    model: 'mock',
    maxIterations: 8,
  })
    .system('You are a fleet triage assistant.')
    .tool(fleetReport())
    .tool(backupStatus(opts.armed))
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

describe('functional: the choice seam through the real loop', () => {
  it('an id mined from the model’s own prior answer files ONE finding at seam choice', async () => {
    const { agent, captured } = triageAgent({ armed: true, machine: '4417-ganymede' });
    await agent.run({ message: TASK });
    const found = argumentFindings(captured);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ seam: 'choice', predicate: 'machine' });
    expect(String(found[0]!.message)).toContain('backup_status');
    expect(String(found[0]!.message)).toContain('4417-ganymede');
    expect(String(found[0]!.message)).toContain('fleet_report');
  });

  it('the same argument taken from the USER’s own message is silent', async () => {
    const { agent, captured } = triageAgent({ armed: true, machine: 'callisto-02' });
    await agent.run({ message: `${TASK} I mean callisto-02.` });
    expect(argumentFindings(captured)).toEqual([]);
  });

  it('an argument served by a TOOL RESULT is silent — results are ground', async () => {
    const { agent, captured } = triageAgent({ armed: true, machine: 'europa-03' });
    await agent.run({ message: TASK });
    expect(argumentFindings(captured)).toEqual([]);
  });
});

describe('regression: one defect, one event — and zero-delta without the declaration', () => {
  it('the same bad argument re-chosen on a later iteration stays ONE finding', async () => {
    const { agent, captured } = triageAgent({
      armed: true,
      machine: '4417-ganymede',
      repeat: true,
    });
    await agent.run({ message: TASK });
    expect(argumentFindings(captured)).toHaveLength(1);
  });

  it('a tool that declares no argumentsFrom is never this check’s subject', async () => {
    const { agent, captured } = triageAgent({ armed: false, machine: '4417-ganymede' });
    await agent.run({ message: TASK });
    expect(argumentFindings(captured)).toEqual([]);
    // …and the ledger shows the honest reason: registered, no subject this
    // run. Nothing beyond the lifecycle's own registration row.
    const rows = captured.dispositions[0]!.rows as CheckReport[];
    expect(rows.find((r) => r.check === 'unsupported-argument')).toMatchObject({
      seam: 'choice',
      checked: 0,
      findings: 0,
      notApplicable: 1,
    });
  });
});

describe('contract: the disposition rows land', () => {
  it('an armed run records the encounter, the finding and when it fired', async () => {
    const { agent, captured } = triageAgent({ armed: true, machine: '4417-ganymede' });
    await agent.run({ message: TASK });
    expect(captured.dispositions).toHaveLength(1);
    const rows = captured.dispositions[0]!.rows as CheckReport[];
    const row = rows.find((r) => r.check === 'unsupported-argument')!;
    expect(row.seam).toBe('choice');
    expect(row.checked).toBeGreaterThanOrEqual(1);
    expect(row.findings).toBe(1);
    expect(row.lastFiredAt).toBeDefined();
    // Calls with no armed tool are stated, never silent.
    expect(row.notApplicable).toBeGreaterThanOrEqual(1);
  });

  it('a clean armed run records checked-pass — the checker ran and agreed', async () => {
    const { agent, captured } = triageAgent({ armed: true, machine: 'callisto-02' });
    await agent.run({ message: `${TASK} I mean callisto-02.` });
    const rows = captured.dispositions[0]!.rows as CheckReport[];
    const row = rows.find((r) => r.check === 'unsupported-argument')!;
    expect(row.checked).toBeGreaterThanOrEqual(1);
    expect(row.findings).toBe(0);
    expect(row.lastFiredAt).toBeUndefined();
  });
});
