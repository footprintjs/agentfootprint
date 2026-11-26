/**
 * Under `listed` a skill body is the `read_skill` result; for every honesty
 * reader it is the app's own text, exactly as the system-prompt body is under
 * `declared`. Differential: the same scripted run under both strategies gives
 * the same evidence checks, the same assessment reasons and the same answer
 * account.
 *
 * Test type: integration / differential.
 */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { defineSkill } from '../../../src/injection-engine.js';
import { accountForAnswer, assessAnswer, recordRun } from '../../../src/observe.js';
import { scriptedClient, type Body, type Step } from './harness.js';
import { towersFor } from '../../../src/core/agent/stages/toolCalls/evidence/towers.js';
import { groundedArgumentValues } from '../../../src/core/agent/findings/contingent.js';
import { resolveEvidenceGate } from '../../../src/core/agent/evidence/gate.js';

const BODY = 'SMB TRIAGE: check the share report first. The latency threshold is 4711 ms.';
const lookup = defineTool<Record<string, never>, string>({
  name: 'lookup',
  description: 'Look the share up.',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => 'finance share: latency 5200 ms',
});
const skill = () =>
  defineSkill({ id: 'smb-triage', description: 'Diagnose slow SMB shares.', body: BODY });

/**
 * Ids, clocks and record POSITIONS differ between two runs (the `declared` run
 * also emits a context event for its system-prompt body, so later events sit
 * one place further on), and so does the slot the delivery row sits in;
 * nothing else may.
 */
function normalise(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/toolu_\d+/g, 'toolu_N')
      .replace(
        /"(runId|conversationId|id|at|ts|timestamp|startedAt|endedAt|durationMs|ms|index|commitIdx)":("[^"]*"|\d+)/g,
        '"$1":"X"',
      )
      .replace(/\d{13}-\d{10}/g, 'RUN')
      // The delivery row is the slot that carried the body: the system prompt under
      // `declared`, the messages (its read_skill result) under `listed`.
      .replace(/sf-(system-prompt|messages)\/compose#\d+/g, 'context-slot'),
  );
}

async function runUnder(skillContext: 'listed' | 'declared', script: readonly Step[]) {
  const bodies: Body[] = [];
  const provider = anthropic({
    _client: scriptedClient('claude-haiku-5-5', bodies, script) as never,
  });
  const builder = Agent.create({
    provider,
    model: 'claude-haiku-5-5',
    maxIterations: 5,
    skillContext,
  })
    .system('You diagnose file-share problems.')
    .tool(lookup)
    .skill(skill()) as ReturnType<typeof Agent.create> & {
    namesAndNumbersFromEvidence: () => ReturnType<typeof Agent.create>;
  };
  const agent = builder.namesAndNumbersFromEvidence().build();
  const checks: unknown[] = [];
  agent.on('agentfootprint.agent.evidence_checked', (e) => checks.push(e.payload));
  const capture = recordRun(agent);
  const answer = await agent.run({ message: 'Why is the finance share slow?' });
  const saved = JSON.parse(JSON.stringify(capture.toRecording()));
  return {
    bodies,
    answer,
    checks: normalise(checks),
    reasons: normalise(assessAnswer(saved).reasons),
    account: normalise(accountForAnswer(saved)),
  };
}

describe('a listed body is the app’s text for every honesty reader', () => {
  for (const [name, script] of [
    [
      'a number found only in the body',
      [
        { tool: 'read_skill', input: { id: 'smb-triage' }, thinking: false },
        { text: 'Latency exceeds the 4711 ms threshold.', thinking: false },
      ],
    ],
    [
      'a number from a tool beside one from the body',
      [
        { tool: 'read_skill', input: { id: 'smb-triage' }, thinking: false },
        { tool: 'lookup', input: {}, thinking: false },
        { text: 'Latency is 5200 ms, above the 4711 ms threshold.', thinking: false },
      ],
    ],
    [
      'a number found nowhere',
      [
        { tool: 'read_skill', input: { id: 'smb-triage' }, thinking: false },
        { text: 'Latency is 9999 ms.', thinking: false },
      ],
    ],
  ] as const) {
    it(`${name}: the same checks, reasons and account as declared`, async () => {
      const declared = await runUnder('declared', script);
      const listed = await runUnder('listed', script);
      // The channel really differs: the body is a tool result under listed only.
      expect(JSON.stringify(listed.bodies.at(-1)!.messages)).toContain('4711');
      expect(JSON.stringify(declared.bodies.at(-1)!.messages)).not.toContain('4711');
      expect(listed.checks).toEqual(declared.checks);
      expect(listed.reasons).toEqual(declared.reasons);
      expect(listed.account).toEqual(declared.account);
      expect(listed.answer).toEqual(declared.answer);
    });
  }
});

describe('the dispatch moment (findings towers) reads a body as the app’s text too', () => {
  const read = {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'r1', name: 'read_skill', args: { id: 'smb-triage' } }],
  };
  const lookupCall = {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'tc-1', name: 'lookup', args: {} }],
  };
  const lookupResult = {
    role: 'tool',
    toolCallId: 'tc-1',
    toolName: 'lookup',
    content: 'finance share: latency 5200 ms',
  };
  const ledger = [
    {
      kind: 'standing',
      toolCallId: 'tc-1',
      standing: 'open',
      assertions: [],
      declaredOn: 'answer',
      iteration: 1,
    },
  ];
  /** A value the call carries: 4711 is only in the body, 5200 only in the set-aside lookup. */
  const grounded = (scope: unknown, gate: ReturnType<typeof resolveEvidenceGate>) => {
    const towers = towersFor(scope as never, true, gate);
    if (towers === undefined) throw new Error('expected towers');
    return groundedArgumentValues(
      { threshold: '4711 ms', latency: '5200 ms' },
      gate,
      towers.corpus,
      towers.exempt,
    ).map((row) => row.value);
  };

  it('listed (the body is the read_skill result) grounds exactly what declared (the body in the system prompt) grounds', () => {
    const gate = resolveEvidenceGate({});
    const listed = {
      turnNumber: 1,
      userMessage: 'Why is the finance share slow?',
      history: [
        { role: 'user', content: 'Why is the finance share slow?' },
        read,
        { role: 'tool', toolCallId: 'r1', toolName: 'read_skill', content: BODY },
        lookupCall,
        lookupResult,
      ],
      findingsLedger: ledger,
    };
    const declared = {
      ...listed,
      history: [
        listed.history[0],
        read,
        {
          role: 'tool',
          toolCallId: 'r1',
          toolName: 'read_skill',
          content: "Skill 'smb-triage' activated for the next iteration.",
        },
        lookupCall,
        lookupResult,
      ],
      systemPromptInjections: [
        {
          slot: 'system-prompt',
          source: 'skill',
          sourceId: 'smb-triage',
          rawContent: BODY,
          contentSummary: '',
          contentHash: '',
          reason: '',
        },
      ],
    };
    const listedGate = { ...gate, skillBodies: new Map([['smb-triage', BODY]]) };
    expect(grounded(listed, listedGate)).toEqual(grounded(declared, gate));
    // The body's own number is exempt app text, never a value a tool returned.
    expect(grounded(listed, listedGate).join(' ')).not.toContain('4711');
    expect(grounded(listed, listedGate).join(' ')).toContain('5200');
  });
});
