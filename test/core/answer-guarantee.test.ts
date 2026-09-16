/**
 * `answerGuarantee` — the delivered answer names how its shape was secured.
 *
 * Test types: Contract (three agents, three words: no schema → 'none'; a
 * parsed schema → 'checked'; the forced synthetic tool → 'tool-forced') ·
 * Law (written on the turn the Route decider picks final, absent before —
 * the writer on the record is the route stage).
 */
import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/index.js';
import { recordRun } from '../../src/observe.js';
import { mock } from '../../src/llm-providers.js';
import { SCHEMA_TOOL_NAME } from '../../src/core/agent/outputEnforcement.js';

const parser = {
  parse: (v: unknown) => v,
  safeParse: (v: unknown) => ({ ok: true as const, value: v }),
};

async function guaranteeOf(agent: ReturnType<typeof Agent.create> extends infer B ? any : never) {
  const rec = recordRun(agent);
  await agent.run({ message: 'q' });
  const recording = rec.toRecording();
  rec.stop();
  const state = recording.snapshot.sharedState as { answerGuarantee?: string };
  const writers = (
    recording.snapshot.commitLog as { runtimeStageId: string; trace: { path: string }[] }[]
  )
    .filter((b) => b.trace.some((r) => r.path === 'answerGuarantee'))
    .map((b) => b.runtimeStageId);
  return { guarantee: state.answerGuarantee, writers };
}

describe('answerGuarantee', () => {
  it("free text: 'none'", async () => {
    const agent = Agent.create({
      provider: mock({ replies: [{ content: 'hi' }] }),
      model: 'mock',
    }).build();
    const { guarantee, writers } = await guaranteeOf(agent);
    expect(guarantee).toBe('none');
    expect(writers.length).toBe(1);
    expect(writers[0]).toMatch(/route/);
  });

  it("an output schema parsed after generation: 'checked'", async () => {
    const agent = Agent.create({
      provider: mock({ replies: [{ content: '{"ok":true}' }] }),
      model: 'mock',
    })
      .outputSchema(parser)
      .build();
    expect((await guaranteeOf(agent)).guarantee).toBe('checked');
  });

  it("the forced synthetic tool: 'tool-forced'", async () => {
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'c1', name: SCHEMA_TOOL_NAME, args: { ok: true } }] }],
      }),
      model: 'mock',
    })
      .outputSchema(parser, {
        strategy: 'tool-forced',
        jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      })
      .build();
    expect((await guaranteeOf(agent)).guarantee).toBe('tool-forced');
  });
});
