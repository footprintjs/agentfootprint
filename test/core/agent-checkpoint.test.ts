/**
 * `agent.checkpoint()` — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The method reads the run's OWN recording and appends the answer the run
 * returned. Both halves are load-bearing and each has its own failure mode:
 *
 *   • Drop the recording half and a resumed conversation loses its tool round
 *     trips.
 *   • Drop the answer half and the agent forgets its own replies — nothing
 *     writes the final assistant turn back into `scope.history`, because the
 *     loop only appends assistant turns that carry tool calls.
 *
 * The second one is the dangerous one: an agent that forgets what it said still
 * answers fluently, so nothing looks wrong until someone reads a transcript.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';

function terseAgent(
  provider: ReturnType<typeof mock>,
  tools: Parameters<typeof defineTool>[0][] = [],
) {
  let builder = Agent.create({ provider, model: 'test-model', maxIterations: 3 }).system('terse');
  for (const tool of tools) builder = builder.tool(tool as never);
  return builder.build();
}

describe('agent.checkpoint()', () => {
  it('is undefined before any run', () => {
    expect(terseAgent(mock({ reply: 'x' })).checkpoint()).toBeUndefined();
  });

  it('captures a single-turn conversation, answer included', async () => {
    const agent = terseAgent(mock({ reply: 'Blue.' }));
    await agent.run({ message: 'What colour is the sky?' });
    const conversation = agent.checkpoint()!;
    expect(conversation.version).toBe(1);
    expect(conversation.history).toEqual([
      { role: 'user', content: 'What colour is the sky?' },
      { role: 'assistant', content: 'Blue.' },
    ]);
    expect(conversation.originalInput).toEqual({ message: 'What colour is the sky?' });
    expect(conversation.runId).toMatch(/\S/);
  });

  it('keeps the tool round trip AND the final answer', async () => {
    const lookup = defineTool<{ id: string }, string>({
      name: 'lookup',
      description: 'look something up',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: ({ id }) => `record ${id}: ok`,
    });
    const agent = terseAgent(
      mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'lookup', args: { id: '42' } }] },
          { content: 'Record 42 is ok.' },
        ],
      }),
      [lookup as never],
    );
    await agent.run({ message: 'check 42' });
    const history = agent.checkpoint()!.history;
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(history[3]).toEqual({ role: 'assistant', content: 'Record 42 is ok.' });
    expect(history[2]?.content).toBe('record 42: ok');
  });

  it('describes the LATEST run, not an earlier one', async () => {
    const agent = terseAgent(mock({ replies: [{ content: 'first' }, { content: 'second' }] }));
    await agent.run({ message: 'one' });
    const after1 = agent.checkpoint()!;
    await agent.run({ message: 'two' });
    const after2 = agent.checkpoint()!;
    expect(after1.history).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'first' },
    ]);
    expect(after2.history).toEqual([
      { role: 'user', content: 'two' },
      { role: 'assistant', content: 'second' },
    ]);
    expect(after2.runId).not.toBe(after1.runId);
  });

  it('feeds straight back into resumeOnError — the whole point', async () => {
    const first = terseAgent(mock({ reply: 'Your name is Ada.' }));
    await first.run({ message: 'My name is Ada.' });
    const stored = first.checkpoint()!;

    const second = terseAgent(mock({ reply: 'Ada.' }));
    await second.resumeOnError({
      ...stored,
      history: [...stored.history, { role: 'user', content: 'What is my name?' }],
      originalInput: { message: 'What is my name?' },
    });
    const continued = second.checkpoint()!;
    expect(continued.history.map((m) => m.content)).toEqual([
      'My name is Ada.',
      'Your name is Ada.',
      'What is my name?',
      'Ada.',
    ]);
  });

  // ── property: it hands out a copy, not the live heap ──
  it('returns a detached copy — mutating it cannot corrupt the run', async () => {
    const agent = terseAgent(mock({ reply: 'Blue.' }));
    await agent.run({ message: 'What colour is the sky?' });
    const conversation = agent.checkpoint()!;
    (conversation.history as { content: string }[])[0]!.content = 'TAMPERED';
    const again = agent.checkpoint()!;
    expect(again.history[0]?.content).toBe('What colour is the sky?');
  });

  it('survives the trip to a store and back', async () => {
    const agent = terseAgent(mock({ reply: 'Blue.' }));
    await agent.run({ message: 'hello' });
    const conversation = agent.checkpoint()!;
    expect(structuredClone(conversation)).toEqual(conversation);
    expect(JSON.parse(JSON.stringify(conversation))).toEqual(conversation);
  });

  // ── scenario: honest about what it cannot represent ──
  it('after a PAUSE, holds the conversation as of the pause and no answer', async () => {
    const approve = defineTool<Record<string, never>, string>({
      name: 'ask_first',
      description: 'ask a person',
      parameters: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'ok?' }),
    });
    const agent = terseAgent(
      mock({ replies: [{ toolCalls: [{ id: 't1', name: 'ask_first', args: {} }] }] }),
      [approve as never],
    );
    await agent.run({ message: 'go' });
    const conversation = agent.checkpoint()!;
    // Exactly what the run committed, with NOTHING appended: no answer was
    // produced, so none is invented. (The last turn is the assistant asking for
    // the tool — that one is real and the loop did write it.)
    const recorded = (agent.getLastSnapshot()!.sharedState as { history: unknown[] }).history;
    expect(conversation.history).toEqual(recorded);
    expect(conversation.history.at(-1)).toMatchObject({ role: 'assistant' });
    expect(conversation.history.at(-1)).toHaveProperty('toolCalls');
  });

  it('after a FAILED run, does not hand back the previous run’s answer', async () => {
    let calls = 0;
    const flaky = {
      name: 'flaky',
      complete: () =>
        ++calls === 1
          ? Promise.resolve({
              content: 'good answer',
              toolCalls: [],
              usage: { input: 1, output: 1 },
            })
          : Promise.reject(new Error('vendor is down')),
    };
    const agent = Agent.create({ provider: flaky, model: 'test-model', maxIterations: 2 })
      .system('terse')
      .build();
    await agent.run({ message: 'first' });
    expect(agent.checkpoint()!.history.at(-1)).toEqual({
      role: 'assistant',
      content: 'good answer',
    });

    await expect(agent.run({ message: 'second' })).rejects.toThrow();
    const afterFailure = agent.checkpoint()!;
    expect(afterFailure.history.at(-1)).not.toEqual({
      role: 'assistant',
      content: 'good answer',
    });
  });

  // ── performance / ROI: it captures nothing during the run ──
  it('changes nothing about the run — same commit log whether or not it is called', async () => {
    const withCall = terseAgent(mock({ reply: 'Blue.' }));
    await withCall.run({ message: 'hello' });
    withCall.checkpoint();
    const withoutCall = terseAgent(mock({ reply: 'Blue.' }));
    await withoutCall.run({ message: 'hello' });

    const a = withCall.getLastSnapshot()!;
    const b = withoutCall.getLastSnapshot()!;
    expect(a.commitLog.length).toBe(b.commitLog.length);
    expect(a.commitLog.map((c) => c.stageId)).toEqual(b.commitLog.map((c) => c.stageId));
  });
});
