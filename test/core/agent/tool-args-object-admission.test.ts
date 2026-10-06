/** JSON-owned argument keys exercise the shared validator through its consumers. */
import { describe, expect, it, vi } from 'vitest';

import { Agent, ask, checkInApproved, defineTool, isPaused } from '../../../src/index.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { bearer } from '../../../src/identity.js';
import type { McpSdkServer } from '../../../src/lib/mcp/types.js';
import { mock } from '../../../src/providers.js';
import { mcpServe } from '../../../src/tool-providers/index.js';

type Door = 'Agent' | 'same-agent resume' | 'fresh-agent resume' | 'ctx.tools.call' | 'MCP serve';
const doors: Door[] = [
  'Agent',
  'same-agent resume',
  'fresh-agent resume',
  'ctx.tools.call',
  'MCP serve',
];
const CALL_ID = 'object-admission-call';
const TOOL_NAME = 'read_item';
const RESULT = 'item read';
const CANARY = 'private-argument-canary';

const cases = [
  {
    label: 'a JSON-owned constructor outside the declared properties',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    args: () => JSON.parse(`{"text":"requested item","constructor":"${CANARY}"}`),
    path: 'constructor',
  },
  {
    label: 'an extra argument when a closed object omits properties',
    inputSchema: { type: 'object', additionalProperties: false },
    args: () => JSON.parse(`{"extra":"${CANARY}"}`),
    path: 'extra',
  },
];

async function dispatch(
  door: Door,
  inputSchema: Record<string, unknown>,
  args: Record<string, unknown>,
) {
  const execute = vi.fn((_args: Record<string, unknown>) => RESULT);
  const getCredential = vi.fn(async () => ({
    status: 'issued' as const,
    credential: bearer('synthetic-object-admission-credential'),
  }));
  const credentials = { id: 'test-vault', getCredential };
  const tool = defineTool({
    name: TOOL_NAME,
    description: 'Read a requested item',
    inputSchema,
    needs: { credential: 'items' },
    execute,
  });
  const events: AgentfootprintEvent[] = [];
  const results: string[] = [];

  if (door === 'MCP serve') {
    const handlers = new Map<string, Parameters<McpSdkServer['setRequestHandler']>[1]>();
    const server: McpSdkServer = {
      setRequestHandler(schema, handler) {
        handlers.set((schema as { method: string }).method, handler);
      },
      connect: async () => {},
      close: async () => {},
    };
    const handle = await mcpServe([tool], { _server: server, credentials });
    try {
      const call = handlers.get('tools/call');
      if (call === undefined) throw new Error('MCP call handler was not registered');
      const result = (await call({ params: { name: TOOL_NAME, arguments: args } }, {})) as {
        content: { text: string }[];
        isError?: boolean;
      };
      results.push(result.content[0]?.text ?? '');
      return { execute, getCredential, events, results, isError: result.isError };
    } finally {
      await handle.close();
    }
  }

  const resume = door === 'same-agent resume' || door === 'fresh-agent resume';
  const build = () => {
    const builder = Agent.create({
      provider: mock({
        respond: (request) => {
          const result = request.messages.find((message) => message.role === 'tool');
          if (result) {
            results.push(String(result.content));
            return { content: 'done' };
          }
          return {
            toolCalls: [
              {
                id: CALL_ID,
                name: door === 'ctx.tools.call' ? 'compose' : TOOL_NAME,
                args: door === 'ctx.tools.call' ? {} : args,
              },
            ],
          };
        },
      }),
      model: 'mock',
      credentials,
    }).tool(tool);
    if (door === 'ctx.tools.call') {
      builder.tool(
        defineTool({
          name: 'compose',
          description: 'Read through the agent-owned inner dispatch',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          execute: async (_args, ctx) => {
            if (ctx.tools === undefined) throw new Error('Inner dispatch is unavailable');
            return await ctx.tools.call(TOOL_NAME, args);
          },
        }),
      );
    }
    if (resume) {
      builder.toolMiddleware({
        name: 'review',
        onToolCall: () => ask({ question: 'Approve this call?' }),
      });
    }
    const agent = builder.build();
    agent.on('*', (event) => events.push(event));
    return agent;
  };
  const agent = build();
  const initial = await agent.run({ message: 'Read the requested item' });
  if (resume) {
    if (!isPaused(initial)) throw new Error('Expected a middleware pause');
    expect(execute).not.toHaveBeenCalled();
    expect(getCredential).not.toHaveBeenCalled();
    const resumed = door === 'fresh-agent resume' ? build() : agent;
    // JSON-owned keys survive persistence; inherited properties are not a transport contract.
    const checkpoint = JSON.parse(JSON.stringify(initial.checkpoint));
    await expect(resumed.resume(checkpoint, checkInApproved({ by: 'reviewer' }))).resolves.toBe(
      'done',
    );
  } else {
    expect(initial).toBe('done');
  }
  return { execute, getCredential, events, results, isError: undefined };
}

describe.each(doors)('%s — own-property object admission', (door) => {
  it.each(cases)('refuses $label before credentials or target execution', async (testCase) => {
    const state = await dispatch(door, testCase.inputSchema, testCase.args());
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.getCredential).not.toHaveBeenCalled();
    expect(state.results).toHaveLength(1);
    expect(state.results[0]).toContain(`Invalid arguments for tool '${TOOL_NAME}'`);
    expect(state.results[0]).toContain(`'${testCase.path}': expected no additional properties`);
    expect(state.results[0]).not.toContain(CANARY);
    expect(state.events.some((event) => event.type === 'agentfootprint.credential.requested')).toBe(
      false,
    );
    if (door === 'MCP serve') expect(state.isError).toBe(true);
    if (door !== 'MCP serve' && door !== 'ctx.tools.call') {
      expect(
        state.events.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
      ).toMatchObject([
        { payload: { toolName: TOOL_NAME, toolCallId: CALL_ID, iteration: 1, enforced: true } },
      ]);
    }
  });

  it('executes an explicitly declared own constructor argument unchanged', async () => {
    const args = JSON.parse('{"constructor":"declared value"}');
    const state = await dispatch(
      door,
      {
        type: 'object',
        properties: { constructor: { type: 'string' } },
        required: ['constructor'],
        additionalProperties: false,
      },
      args,
    );
    expect(state.execute).toHaveBeenCalledOnce();
    const received = state.execute.mock.calls[0]?.[0];
    expect(received).toEqual(args);
    expect(Object.prototype.hasOwnProperty.call(received, 'constructor')).toBe(true);
    expect(state.getCredential).toHaveBeenCalledOnce();
    expect(state.results).toEqual([RESULT]);
    expect(state.isError).toBeUndefined();
    expect(
      state.events.filter((event) => event.type === 'agentfootprint.validation.args_invalid'),
    ).toEqual([]);
  });
});
