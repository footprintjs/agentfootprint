import { expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  checkInApproved,
  isPaused,
  ask,
  allow,
  askHuman,
  Sequence,
} from '../../../index.js';
import { defineSkill } from '../../../injection-engine.js';
import { bearer } from '../../../identity.js';
import type { LLMRequest } from '../../../provider-contract/types.js';

function script(plan: readonly (readonly string[])[]) {
  const requests: LLMRequest[] = [];
  let turn = 0;
  return {
    requests,
    provider: {
      name: 'scripted',
      complete: async (request: LLMRequest) => {
        requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
        const names = plan[turn++] ?? [];
        return {
          content: names.length === 0 ? 'done' : '',
          toolCalls: names.map((name, index) => ({ id: `${turn}-${index}`, name, args: {} })),
          usage: { input: 1, output: 1 },
        };
      },
    },
  };
}
const ordinary = (name: string, ran: string[]) =>
  defineTool({
    name,
    description: name,
    inputSchema: { type: 'object' },
    execute: () => {
      ran.push(name);
      return 'ran';
    },
  });

for (const mounted of [false, true]) {
  for (const mode of ['same', 'fresh'] as const) {
    for (const door of ['check-in', 'middleware', 'credential'] as const) {
      for (const source of ['off-wire', 'overflow'] as const) {
        it(`${
          mounted ? 'mounted' : 'direct'
        } ${mode} ${door} keeps the original paused call and sibling parties for ${source}`, async () => {
          const ran: string[] = [],
            s = script([['target', 'sibling'], ['sibling'], []]);
          const vault = { ready: false };
          const credentials = {
            id: 'fixture',
            getCredential: async () =>
              vault.ready
                ? { status: 'issued' as const, credential: bearer('synthetic') }
                : {
                    status: 'authorization-required' as const,
                    authorizationUrl: 'https://example.test/authorize',
                    sessionId: 'fixture',
                  },
          };
          const target = defineTool({
            name: 'target',
            description: 'Target',
            inputSchema: { type: 'object' },
            ...(door === 'check-in' && { checkIn: 'always' as const }),
            ...(door === 'credential' && {
              needs: { credential: 'fixture', mode: 'user' as const },
            }),
            execute: () => {
              ran.push('target');
              return 'ran';
            },
          });
          const sibling = ordinary('sibling', ran);
          const build = () => {
            let b = Agent.create({
              provider: s.provider,
              model: 'mock',
              reactMode: 'dynamic',
              ...(door === 'credential' && { credentials }),
            });
            b =
              source === 'off-wire'
                ? b
                    .skill(
                      defineSkill({
                        id: 'idle',
                        description: 'Idle',
                        body: 'Idle',
                        tools: [target, sibling],
                      }),
                    )
                    .toolsFromActiveSkill()
                : b.tools([
                    target,
                    sibling,
                    ...Array.from({ length: 1100 }, (_, index) => ordinary(`other-${index}`, ran)),
                  ]);
            if (door === 'middleware')
              b = b.toolMiddleware({
                name: 'gate',
                onToolCall: (call) =>
                  call.toolName === 'target' ? ask({ question: 'Continue?' }) : allow(),
              });
            return b.build();
          };
          const make = () =>
            mounted ? Sequence.create().step('member', build()).build() : build();
          const first = make(),
            paused = await first.run('go');
          if (!isPaused(paused)) throw new Error('Expected gated pause');
          const path = paused.checkpoint.subflowPath;
          const leaf =
            path.length === 0
              ? paused.checkpoint.sharedState
              : paused.checkpoint.subflowStates![path.at(-1)!];
          expect((leaf as Record<string, unknown>).servedToolParties).toMatchObject({
            bound: [{ index: 0 }, { index: 1 }],
          });
          const current = mode === 'same' ? first : make();
          vault.ready = true;
          const answer =
            door === 'credential'
              ? 'authorized'
              : checkInApproved({
                  request: door === 'check-in' ? paused.checkIn! : paused.ask!,
                  by: 'fixture',
                });
          await expect(current.resume(paused.checkpoint, answer)).resolves.toBe('done');
          expect(ran).toEqual(['target', 'sibling']);
          expect(
            s.requests[1]!.messages.find((message) => message.toolName === 'sibling')?.content,
          ).toContain('without executing the calls that followed');
        });
      }
    }
  }
}

it('truncated history never turns a dropped provider name into a unique inactive-skill holder', async () => {
  const ran: string[] = [],
    s = script([['noop'], ['gate'], ['x'], []]);
  const agent = Agent.create({ provider: s.provider, model: 'mock', reactMode: 'dynamic' })
    .tools([
      ordinary('noop', ran),
      defineTool({
        name: 'gate',
        description: 'Gate',
        inputSchema: { type: 'object' },
        checkIn: 'always',
        execute: () => 'gate',
      }),
    ])
    .skill(
      defineSkill({ id: 'idle', description: 'Idle', body: 'Idle', tools: [ordinary('x', ran)] }),
    )
    .toolsFromActiveSkill()
    .toolProvider({
      id: 'provider',
      list: (context) =>
        context.iteration === 1
          ? [ordinary('x', ran)]
          : Array.from({ length: 1100 }, (_, index) => ordinary(`other-${index}`, ran)),
    })
    .build();
  const paused = await agent.run('go');
  if (!isPaused(paused)) throw new Error('Expected pause');
  await expect(
    agent.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn!, by: 'fixture' })),
  ).resolves.toBe('done');
  expect(ran).toEqual(['noop']);
  expect(
    s.requests.at(-1)!.messages.find((message) => message.toolName === 'x')?.content,
  ).toContain('contract');
});

for (const door of ['argument', 'check-in', 'middleware', 'credential'] as const) {
  it(`${door} accepts a 2000-character provider ID without losing consent or execution`, async () => {
    const ran: string[] = [],
      s = script([['target'], []]),
      vault = { ready: false };
    const credentials = {
      id: 'fixture',
      getCredential: async () =>
        vault.ready
          ? { status: 'issued' as const, credential: bearer('synthetic') }
          : {
              status: 'authorization-required' as const,
              authorizationUrl: 'https://example.test/authorize',
              sessionId: 'fixture',
            },
    };
    let b = Agent.create({
      provider: s.provider,
      model: 'mock',
      reactMode: 'dynamic',
      ...(door === 'credential' && { credentials }),
    }).toolProvider({
      id: 'P'.repeat(2000),
      list: () => [
        defineTool({
          name: 'target',
          description: 'Target',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          ...(door === 'argument' && { askOrAssume: { q: { ask: 'Which value?' } } }),
          ...(door === 'check-in' && { checkIn: 'always' as const }),
          ...(door === 'credential' && { needs: { credential: 'fixture', mode: 'user' as const } }),
          execute: () => {
            ran.push('target');
            return 'ran';
          },
        }),
      ],
    });
    if (door === 'argument') b = b.inputsLayer();
    if (door === 'middleware')
      b = b.toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'Continue?' }) });
    const agent = b.build(),
      paused = await agent.run('go');
    if (!isPaused(paused)) throw new Error('Expected pause');
    if (door !== 'argument')
      expect(paused.checkpoint.sharedState.pausedToolParty).toEqual({
        channel: 'provider',
        id: 'P'.repeat(2000),
      });
    vault.ready = true;
    const answer =
      door === 'argument'
        ? { requestId: paused.awaitingInput!.requestId, values: { f1: 'yes' } }
        : door === 'credential'
        ? 'authorized'
        : checkInApproved({
            request: door === 'check-in' ? paused.checkIn! : paused.ask!,
            by: 'fixture',
          });
    await expect(agent.resume(paused.checkpoint, answer)).resolves.toBe('done');
    expect(ran).toEqual(['target']);
  });
}

it.each([false, true])(
  'classic resume advertises exactly its retained positive offer, truncated=%s',
  async (overflow) => {
    const ran: string[] = [],
      s = script([['pauser'], ['tool-0'], []]);
    const agent = Agent.create({ provider: s.provider, model: 'mock', reactMode: 'classic' })
      .tools([
        ...Array.from({ length: overflow ? 1100 : 2 }, (_, index) =>
          ordinary(`tool-${index}`, ran),
        ),
        defineTool({
          name: 'pauser',
          description: 'Pause',
          inputSchema: { type: 'object' },
          execute: () => askHuman({ question: 'Continue?' }),
        }),
      ])
      .build();
    const paused = await agent.run('go');
    if (!isPaused(paused)) throw new Error('Expected pause');
    await agent.resume(paused.checkpoint, 'yes');
    if (overflow) expect(s.requests[1]!.tools!.some((tool) => tool.name === 'tool-0')).toBe(false);
    else expect(s.requests[1]!.tools).toEqual(s.requests[0]!.tools);
  },
);

it.each(['argument', 'check-in'] as const)(
  '%s keeps raw long tool names and call IDs while its private proof stays finite',
  async (door) => {
    const name = 'tool-' + 'n'.repeat(2000),
      id = 'call-' + 'i'.repeat(2000);
    let messages = 0,
      ran = 0;
    const agent = Agent.create({
      provider: {
        name: 'scripted',
        complete: async () => {
          messages++;
          return messages === 1
            ? { content: '', toolCalls: [{ id, name, args: {} }], usage: { input: 1, output: 1 } }
            : { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
        },
      },
      model: 'mock',
    })
      .tool(
        defineTool({
          name,
          description: 'Long name',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
          ...(door === 'argument'
            ? { askOrAssume: { q: { ask: 'Which value?' } } }
            : { checkIn: 'always' as const }),
          execute: () => {
            ran++;
            return 'ran';
          },
        }),
      )
      .build();
    const paused = await agent.run('go');
    if (!isPaused(paused)) throw new Error('Expected pause');
    const encoded = JSON.stringify(paused.checkpoint.sharedState.servedToolParties);
    expect(encoded.length).toBeLessThan(2000);
    const answer =
      door === 'argument'
        ? { requestId: paused.awaitingInput!.requestId, values: { f1: 'yes' } }
        : checkInApproved({ request: paused.checkIn!, by: 'fixture' });
    await expect(agent.resume(paused.checkpoint, answer)).resolves.toBe('done');
    expect(ran).toBe(1);
  },
);

it('a changed finite selected-party proof cannot override the raw approved party', async () => {
  const ran: string[] = [],
    s = script([['target'], []]);
  const agent = Agent.create({ provider: s.provider, model: 'mock' })
    .tool(
      defineTool({
        name: 'target',
        description: 'Target',
        inputSchema: { type: 'object' },
        checkIn: 'always',
        execute: () => {
          ran.push('target');
          return 'ran';
        },
      }),
    )
    .build();
  const paused = await agent.run('go');
  if (!isPaused(paused)) throw new Error('Expected pause');
  const bad = structuredClone(paused.checkpoint);
  (bad.sharedState.servedToolParties as { bound: { party: unknown }[] }).bound[0]!.party = {
    channel: 'provider',
    id: 'replacement',
  };
  const answer = checkInApproved({ request: paused.checkIn!, by: 'fixture' });
  await expect(agent.resume(bad, answer)).rejects.toThrow('saved tool ownership carrier');
  expect(ran).toEqual([]);
  await expect(agent.resume(paused.checkpoint, answer)).resolves.toBe('done');
  expect(ran).toEqual(['target']);
});
