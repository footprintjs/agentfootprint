import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../../../src/index.js';
import { validateCheckpoint } from '../../../../src/core/runCheckpoint.js';
import { defineSkill } from '../../../../src/injection-engine.js';
import { mock } from '../../../../src/llm-providers.js';

const skillId = 'inventory';
const stepTool = 'inspect_inventory';
const reason = 'The count is on file.';
const select = { toolCalls: [{ id: 'select-1', name: 'read_skill', args: { id: skillId } }] };
const skip = { toolCalls: [{ id: 'skip-1', name: 'skip_step', args: { reason } }] };
const complete = { toolCalls: [{ id: 'step-1', name: stepTool, args: {} }] };

function buildAgent(onSkip: 'advance' | 'hold', armed: boolean) {
  const step = defineTool<Record<string, never>, string>({
    name: stepTool,
    description: 'Inspect the inventory.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'Counted three items.',
  });
  const procedure = defineSkill({
    id: skillId,
    description: 'Check the inventory.',
    body: 'Follow the inventory procedure.',
    tools: [step],
    steps: [{ tool: stepTool, note: 'Count the items.' }],
    onSkip,
  });
  const builder = Agent.create({
    provider: mock({
      replies: [select, skip, ...(onSkip === 'hold' ? [complete] : []), 'Ready.'],
      chunkDelayMs: 0,
    }),
    model: 'mock',
  }).injection(procedure);
  return (armed ? builder.answerLayer() : builder.answerLayer(false)).build();
}

function stepWitnesses(ledger: readonly { kind: string }[] = []) {
  return ledger.filter((row) => row.kind === 'step-skipped');
}

describe('the committed skipped-step witness', () => {
  it('an advancing skip commits the step and call facts, and the checkpoint accepts the row', async () => {
    const agent = buildAgent('advance', true);
    await agent.run({ message: 'Check the inventory.' });

    const stored = JSON.parse(JSON.stringify(agent.checkpoint()));
    const rows = stepWitnesses(stored.findingsLedger);
    expect(rows).toEqual([
      {
        kind: 'step-skipped',
        turn: 1,
        iteration: 2,
        skillId,
        index: 1,
        total: 1,
        tool: stepTool,
        toolCallId: 'skip-1',
        policy: 'advance',
      },
    ]);
    expect(validateCheckpoint(stored).findingsLedger).toEqual(rows);
    expect(() =>
      validateCheckpoint({ ...stored, findingsLedger: [{ ...rows[0], policy: 'hold' }] }),
    ).toThrow(/step-skipped/);
    expect(() =>
      validateCheckpoint({ ...stored, findingsLedger: [{ ...rows[0], index: 2 }] }),
    ).toThrow(/step-skipped/);
  });

  it.each([
    ['hold', true],
    ['advance', false],
  ] as const)(
    'a skip under %s (answer layer armed: %s) files no witness',
    async (policy, armed) => {
      const agent = buildAgent(policy, armed);
      await agent.run({ message: 'Check the inventory.' });

      const checkpoint = agent.checkpoint();
      expect(
        checkpoint?.history.find((message) => message.toolCallId === 'skip-1')?.content,
      ).toContain(reason);
      expect(stepWitnesses(checkpoint?.findingsLedger)).toEqual([]);
    },
  );
});
