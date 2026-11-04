import { describe, expect, it } from 'vitest';
import { Agent, defineTool, isInputPause, requestInput } from '../../../src/index.js';
import { defineSkill } from '../../../src/injection-engine.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';

function scripted(plan: readonly (readonly { id: string; name: string }[])[]) {
  const requests: LLMRequest[] = [];
  let n = 0;
  return {
    requests,
    provider: {
      name: 'scripted',
      complete: async (req: LLMRequest) => {
        requests.push(JSON.parse(JSON.stringify(req)));
        const step = plan[n++];
        if (step === undefined || step.length === 0)
          return { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
        return {
          content: '',
          toolCalls: step.map((c) => ({ id: c.id, name: c.name, args: {} })),
          usage: { input: 1, output: 1 },
        };
      },
    },
  };
}
const t = (name: string, label: string, ran: string[]) =>
  defineTool({
    name,
    description: `${name} by ${label}`,
    inputSchema: { type: 'object', properties: {} },
    execute: () => {
      ran.push(`${name}:${label}`);
      return `${name} from ${label}`;
    },
  });
const pauser = defineTool({
  name: 'pauser',
  description: 'asks',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    requestInput({ id: 'y', question: 'q', fields: [{ id: 'y', type: 'string', required: true }] }),
});

describe.each(['classic', 'dynamic', 'dynamic-grouped'] as const)('%s', (reactMode) => {
  describe.each(['same', 'fresh'] as const)('%s resume', (mode) => {
    it('later calls after a resume', async () => {
      const ran: string[] = [];
      const off: string[] = [];
      const s = scripted([
        [{ id: 'p', name: 'pauser' }],
        [
          { id: 'k1', name: 'a' },
          { id: 'k2', name: 'b' },
          { id: 'k3', name: 'contested' },
        ],
        [],
      ]);
      const build = () => {
        const agent = Agent.create({ provider: s.provider as never, model: 'mock', reactMode })
          .tool(pauser)
          .tool(t('a', 'static', ran))
          .toolProvider({
            id: 'cat',
            list: () => [t('b', 'provider', ran), t('contested', 'provider', ran)],
          })
          .skill(
            defineSkill({
              id: 'idle',
              description: 'idle',
              body: 'I',
              tools: [t('contested', 'skill-inactive', ran)] as never,
            }),
          )
          .toolsFromActiveSkill()
          .build();
        agent.on('agentfootprint.tools.answered_off_wire', (e: any) =>
          off.push(`${e.payload.toolName}->${e.payload.answeredBy}`),
        );
        return agent;
      };
      const first = build();
      const p: any = await first.run({ message: 'go' });
      expect(isInputPause(p)).toBe(true);
      const again = mode === 'same' ? first : build();
      const r = await again.resume(structuredClone(p.checkpoint), {
        requestId: p.awaitingInput.requestId,
        values: { y: 'v' },
      });
      const tools = s.requests
        .at(-1)
        ?.messages.filter((m) => m.role === 'tool')
        .map((m) => `${m.toolCallId}: ${String(m.content).slice(0, 90)}`)
        .slice(1);
      expect(r).toBe('done');
      expect(ran).toEqual(['a:static', 'b:provider', 'contested:provider']);
      expect(off).toEqual([]);
      expect(tools?.join(' ')).not.toContain('not available');
    });
  });
});
