/**
 * Sample 20: Permission-Gated Tools
 *
 * Defense-in-depth tool filtering — demonstrates gatedTools concept.
 * Tools can be filtered by permission before being registered with the agent.
 */
import { Agent, mock, defineTool } from 'agentfootprint';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async (args: { query: string }) => ({ content: 'Results for: ' + args.query }),
});

const adminTool = defineTool({
  id: 'delete-user',
  description: 'Delete a user account (admin only)',
  inputSchema: { type: 'object', properties: { userId: { type: 'string' } } },
  handler: async (args: { userId: string }) => ({ content: 'Deleted user: ' + args.userId }),
});

const codeTool = defineTool({
  id: 'run-code',
  description: 'Execute code in sandbox',
  inputSchema: { type: 'object', properties: { code: { type: 'string' } } },
  handler: async (_args: { code: string }) => ({ content: 'Output: 42' }),
});

export async function run(input: string) {
  // Simulate user permissions
  const userPermissions = new Set(['search', 'run-code']); // No admin!
  const allTools = [searchTool, adminTool, codeTool];

  // Filter tools by permission before registering
  const allowed = allTools.filter(t => userPermissions.has(t.id));
  const blocked = allTools.filter(t => !userPermissions.has(t.id)).map(t => ({ id: t.id, phase: 'resolve' }));

  const builder = Agent.create({
    provider: mock([
      { content: '', toolCalls: [{ id: 'c1', name: 'search', arguments: { query: 'AI news' } }] },
      { content: 'I searched for AI news. I cannot delete users as I do not have admin access.' },
    ]),
  }).system('You are a helpful assistant.');

  // Only register permitted tools
  for (const tool of allowed) builder.tool(tool);

  const runner = builder.maxIterations(5).build();
  const result = await runner.run(input);

  return { content: result.content, blocked, permissions: [...userPermissions] };
}

if (process.argv[1] === import.meta.filename) {
  run('Search for AI news.').then(console.log);
}
