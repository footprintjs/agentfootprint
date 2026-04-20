/**
 * Permission-gated tools — filter the tool list by user permissions
 * BEFORE the LLM sees it. Defense-in-depth: the LLM can't hallucinate
 * a call to a tool it never knew existed.
 */

import { Agent, mock, defineTool } from 'agentfootprint';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'security/01-gated-tools',
  title: 'Permission-gated tools',
  group: 'security',
  description: 'Filter tools by permission before the LLM sees the tool list.',
  defaultInput: 'Search for AI news.',
  providerSlots: ['default'],
  tags: ['security', 'gating', 'permissions'],
};

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async (args: { query: string }) => ({ content: `Results for: ${args.query}` }),
});

const adminTool = defineTool({
  id: 'delete-user',
  description: 'Delete a user account (admin only)',
  inputSchema: { type: 'object', properties: { userId: { type: 'string' } } },
  handler: async (args: { userId: string }) => ({ content: `Deleted user: ${args.userId}` }),
});

const codeTool = defineTool({
  id: 'run-code',
  description: 'Execute code in sandbox',
  inputSchema: { type: 'object', properties: { code: { type: 'string' } } },
  handler: async (_args: { code: string }) => ({ content: 'Output: 42' }),
});

const defaultMock = (): LLMProvider =>
  mock([
    { content: '', toolCalls: [{ id: 'c1', name: 'search', arguments: { query: 'AI news' } }] },
    { content: 'I searched for AI news. I cannot delete users as I do not have admin access.' },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const userPermissions = new Set(['search', 'run-code']); // no admin
  const allTools = [searchTool, adminTool, codeTool];

  const allowed = allTools.filter((t) => userPermissions.has(t.id));
  const blocked = allTools
    .filter((t) => !userPermissions.has(t.id))
    .map((t) => ({ id: t.id, phase: 'resolve' }));

  const builder = Agent.create({ provider: provider ?? defaultMock() }).system(
    'You are a helpful assistant.',
  );
  for (const tool of allowed) builder.tool(tool);

  const runner = builder.maxIterations(5).build();
  const result = await runner.run(input);

  return {
    content: result.content,
    blocked,
    permissions: [...userPermissions],
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
