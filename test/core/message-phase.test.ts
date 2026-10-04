import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  allow,
  deny,
  MessageDeniedError,
  type LLMProvider,
  type MessageMiddleware,
} from '../../src/index.js';

const answer = 'synthetic provider answer';

function setup(reactMode: 'classic' | 'dynamic' | 'dynamic-grouped' = 'classic') {
  let providerCalls = 0;
  const response = {
    content: answer,
    toolCalls: [],
    usage: { input: 1, output: 2 },
    stopReason: 'end_turn',
  };
  const provider: LLMProvider = {
    name: 'message-phase-test',
    async complete() {
      providerCalls++;
      return response;
    },
    async *stream() {
      providerCalls++;
      yield { content: answer, tokenIndex: 0, done: false };
      yield { content: '', tokenIndex: 1, done: true, response };
    },
  };
  const builder = Agent.create({ provider, model: 'mock', reactMode });
  const register = builder.messageMiddleware.bind(builder);
  const registered: MessageMiddleware[] = [];
  // A decorator of the public registration method can observe the actual rules.
  vi.spyOn(builder, 'messageMiddleware').mockImplementation(
    (...middleware: readonly MessageMiddleware[]) => {
      registered.push(...middleware);
      return register(...middleware);
    },
  );
  return { builder, registered, providerCalls: () => providerCalls };
}

function observe(agent: Agent) {
  const tokens: string[] = [];
  const ends: unknown[] = [];
  const turns: string[] = [];
  agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
  agent.on('agentfootprint.stream.llm_end', (event) => ends.push(event.payload));
  agent.on('agentfootprint.agent.turn_end', (event) => turns.push(event.payload.finalContent));
  return { tokens, ends, turns };
}

describe('declared message phases', () => {
  for (const phase of ['input', 'output'] as const) {
    it(`freezes only the library-owned ${phase} wrapper`, () => {
      const { builder, registered } = setup();
      const original: MessageMiddleware = { name: 'caller-owned', onMessage: () => allow() };
      builder.act({ [phase]: [original] });
      const wrapper = registered[0];
      expect(wrapper).not.toBe(original);
      expect(Object.isFrozen(original)).toBe(false);
      expect(Object.isFrozen(wrapper)).toBe(true);
      expect(Reflect.set(wrapper, 'onMessage', () => deny('replacement'))).toBe(false);
      expect(Reflect.deleteProperty(wrapper, 'onMessage')).toBe(false);
    });
  }

  it('keeps the caller-owned callback mutable and honors it at execution time', async () => {
    const { builder, providerCalls } = setup();
    const phases: string[] = [];
    const original: MessageMiddleware = { name: 'caller-owned', onMessage: () => allow() };
    builder.act({ input: [original] });
    const agent = builder.build();
    const changed = Reflect.set(original, 'onMessage', (message: { phase: string }) => {
      phases.push(message.phase);
      return deny('changed input rule');
    });
    await expect(agent.run('hello')).rejects.toBeInstanceOf(MessageDeniedError);
    expect(changed).toBe(true);
    expect(Object.isFrozen(original)).toBe(false);
    expect(phases).toEqual(['input']);
    expect(providerCalls()).toBe(0);
  });

  for (const when of ['before build', 'after build'] as const) {
    it(`cannot replace an input-only guard ${when}`, async () => {
      const { builder, registered } = setup();
      const phases: string[] = [];
      const original: MessageMiddleware = {
        name: 'input-only',
        onMessage(message) {
          phases.push(message.phase);
          return allow();
        },
      };
      builder.act({ input: [original] });
      let agent: Agent | undefined = when === 'after build' ? builder.build() : undefined;
      const changed = Reflect.set(registered[0], 'onMessage', (message: { phase: string }) =>
        message.phase === 'output' ? deny('injected output rule') : allow(),
      );
      agent ??= builder.build();
      const seen = observe(agent);
      // Execute before checking the descriptor, so a stale declaration is a runtime witness.
      expect(await agent.run('hello')).toBe(answer);
      expect(changed).toBe(false);
      expect(phases).toEqual(['input']);
      expect(seen.tokens).toEqual([answer]);
      expect(seen.turns).toEqual([answer]);
      expect(seen.ends).toEqual([expect.objectContaining({ content: answer })]);
      expect(seen.ends[0]).not.toHaveProperty('contentWithheld');
    });
  }

  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    it(`always governs a caller-owned rule declared for both phases (${reactMode})`, async () => {
      const { builder, registered } = setup(reactMode);
      const phases: string[] = [];
      const original: MessageMiddleware = { name: 'both-phases', onMessage: () => allow() };
      builder.act({ input: [original], output: [original] });
      const agent = builder.build();
      const changed = Reflect.set(original, 'onMessage', (message: { phase: string }) => {
        phases.push(message.phase);
        return message.phase === 'output' ? deny('blocked output') : allow();
      });
      const seen = observe(agent);
      await expect(agent.run('hello')).rejects.toBeInstanceOf(MessageDeniedError);
      expect(registered).toEqual([original]);
      expect(registered[0]).toBe(original);
      expect(changed).toBe(true);
      expect(Object.isFrozen(original)).toBe(false);
      expect(phases).toEqual(['input', 'output']);
      expect(seen.tokens).toEqual([]);
      expect(seen.turns).toEqual([]);
      expect(seen.ends).toEqual([expect.objectContaining({ content: '', contentWithheld: true })]);
    });
  }
});
