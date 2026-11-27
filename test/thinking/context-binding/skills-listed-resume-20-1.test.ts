import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../../src/index.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { defineSkill } from '../../../src/injection-engine.js';
import { UnsafeThinkingReplayError } from '../../../src/providers.js';
import { scriptedClient, type Body } from './harness.js';

const ORIGINAL_BODY = 'AA-BODY-MARK steps for aa; threshold 4711 ms.';
const REVISED_BODY = 'AA-BODY-MARK instructions revised after the pause.';
const ANSWER = 'The check is complete.';

const tool = (name: string, description: string) =>
  defineTool<Record<string, unknown>, string>({
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => `${name} ran ok`,
  });

function resume(fixture: 'bound' | 'unknown', model: string, bodies: Body[], body = ORIGINAL_BODY) {
  const checkpoint = JSON.parse(
    readFileSync(new URL(`./fixtures/skills-listed-20-1/${fixture}.json`, import.meta.url), 'utf8'),
  ) as Parameters<Agent['resume']>[0];
  const provider = anthropic({
    _client: scriptedClient(model, bodies, [{ tool: 't1' }, { text: ANSWER }]) as never,
  });
  const agent = Agent.create({ provider, model, maxIterations: 8 })
    .system('S.')
    .tool(tool('t1', 'The t1 tool.'))
    .skill(
      defineSkill({
        id: 'aa',
        description: 'aa skill',
        body,
        tools: [tool('aa_tool', 'x')],
        autoActivate: 'currentSkill',
      }),
    )
    .build();
  return agent.resume(checkpoint, 'finance');
}

describe('a checkpoint saved on AgentFootprint 20.1.0 in listed mode', () => {
  it.each([
    ['bound', 'claude-haiku-5-5'],
    ['unknown', 'my-gateway-alias'],
  ] as const)('%s resumes with exactly one delivered body per request', async (fixture, model) => {
    const bodies: Body[] = [];

    await expect(resume(fixture, model, bodies)).resolves.toBe(ANSWER);

    expect(bodies).toHaveLength(2);
    for (const request of bodies) {
      expect(JSON.stringify(request.system)).not.toContain(ORIGINAL_BODY);
      expect(JSON.stringify(request.messages).split(ORIGINAL_BODY)).toHaveLength(2);
    }
  });

  it('serves the registered body in the system prompt when older text differs', async () => {
    const bodies: Body[] = [];

    await expect(resume('unknown', 'my-gateway-alias', bodies, REVISED_BODY)).resolves.toBe(ANSWER);

    expect(bodies).toHaveLength(2);
    for (const request of bodies) expect(JSON.stringify(request.system)).toContain(REVISED_BODY);
  });

  it('refuses a changed prefix before transport when the saved turn lacks a context baseline', async () => {
    const bodies: Body[] = [];
    const result = resume('bound', 'claude-haiku-5-5', bodies, REVISED_BODY);

    await expect(result).rejects.toBeInstanceOf(UnsafeThinkingReplayError);
    await expect(result).rejects.toMatchObject({ reason: 'prefix-changed' });
    expect(bodies).toHaveLength(0);
  });
});
