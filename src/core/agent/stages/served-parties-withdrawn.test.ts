import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool, isPaused, isInputPause, requestInput } from '../../../index.js';
import { defineSkill } from '../../../injection-engine.js';
import type { LLMRequest } from '../../../provider-contract/types.js';

const toolOf = (name: string, stamp: string, ran: string[]) =>
  defineTool({
    name,
    description: `${name} by ${stamp}`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      ran.push(`${name}:${stamp}`);
      return `${name} from ${stamp}`;
    },
  });

function scripted(plan: readonly (readonly string[])[]) {
  const requests: LLMRequest[] = [];
  let n = 0;
  return {
    requests,
    provider: {
      name: 'scripted',
      complete: async (req: LLMRequest) => {
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        const step = plan[n++];
        if (step === undefined || step.length === 0)
          return {
            content: 'done',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
        return {
          content: '',
          toolCalls: step.map((name, i) => ({ id: `c${n}-${i}`, name, args: {} })),
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use',
        };
      },
    },
  };
}

const toolMsgs = (req: LLMRequest | undefined) =>
  (req?.messages ?? [])
    .filter((m) => m.role === 'tool')
    .map((m) => `${m.toolCallId}: ${m.content}`);

describe('no pause: a provider withdraws a tool, then the model names it', () => {
  it('prints the tool result', async () => {
    const ran: string[] = [];
    const s = scripted([['gone'], ['gone'], []]);
    const agent = Agent.create({
      provider: s.provider as never,
      model: 'mock',
      reactMode: 'dynamic',
    })
      .tool(toolOf('other', 'static', ran))
      .toolProvider({
        id: 'fading',
        list: (ctx) => (ctx.iteration === 1 ? [toolOf('gone', 'provider', ran)] : []),
      })
      .build();
    const out = await agent.run({ message: 'go' });
    expect(out).toBe('done');
    expect(ran).toEqual(['gone:provider']);
    expect(toolMsgs(s.requests.at(-1)).at(-1)).toContain('Unknown tool');
  });
});

describe('SAME resume: last-served memory across a pause', () => {
  for (const mode of ['same', 'fresh'] as const) {
    it(`withdrawn provider name, inactive skill holder, called off-wire after a ${mode} resume`, async () => {
      const ran: string[] = [];
      const make = () => {
        const s = scripted(
          mode === 'same'
            ? [['shared'], ['pauser'], ['shared'], []]
            : [['shared'], ['pauser'], ['shared'], []],
        );
        return s;
      };
      const s = make();
      const pauser = defineTool({
        name: 'pauser',
        description: 'asks',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          requestInput({
            id: 'y',
            question: 'Which?',
            fields: [{ id: 'y', type: 'string', required: true }],
          }),
      });
      const build = (provider: unknown) =>
        Agent.create({ provider: provider as never, model: 'mock', reactMode: 'dynamic' })
          .tool(pauser)
          .toolProvider({
            id: 'fading',
            list: (ctx) => (ctx.iteration <= 2 ? [toolOf('shared', 'provider', ran)] : []),
          })
          .skill(
            defineSkill({
              id: 'desk-idle',
              description: 'never activated',
              body: 'IDLE',
              tools: [toolOf('shared', 'skill-inactive', ran)] as never,
            }),
          )
          .toolsFromActiveSkill()
          .build();
      const agent = build(s.provider);
      const paused = await agent.run({ message: 'go' });
      if (!isInputPause(paused)) throw new Error('expected input pause: ' + JSON.stringify(paused));
      const resumer = mode === 'same' ? agent : build(s.provider);
      const out = await resumer.resume(paused.checkpoint, {
        requestId: paused.awaitingInput.requestId,
        values: { y: 'a' },
      });
      expect(out).toBe('done');
      expect(ran).toEqual(['shared:provider']);
      expect(toolMsgs(s.requests.at(-1)).at(-1)).toContain('offered');
    });
  }
});
