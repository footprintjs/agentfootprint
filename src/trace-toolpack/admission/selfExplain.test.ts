import { describe, expect, it } from 'vitest';
import { Agent, allow, defineTool, deny } from '../../index.js';
import { mock } from '../../llm-providers.js';
import { TRACE_WITHHELD } from './marker.js';

const sourceText = 'Skyline scheduling draft.';
const admittedText = 'A Tuesday meeting.';

describe('trace admission in a live self-explain binding', () => {
  it.each(['withheld', 'rewritten'] as const)(
    'admits follow-up trace evidence for a %s result',
    async (disposition) => {
      const overviewReplies: string[] = [];
      const provider = mock({
        respond(request) {
          const latestUser = [...request.messages]
            .reverse()
            .find((message) => message.role === 'user');
          const last = request.messages.at(-1);
          const lastToolText = last?.role === 'tool' ? String(last.content) : '';
          if (latestUser?.content === 'Explain the previous turn.') {
            if (request.tools?.some((tool) => tool.name === 'run_overview')) {
              if (lastToolText.includes('TRACE RUN OVERVIEW')) {
                overviewReplies.push(lastToolText);
                return 'I reviewed the previous turn.';
              }
              return { toolCalls: [{ id: 'overview', name: 'run_overview', args: {} }] };
            }
            return {
              toolCalls: [{ id: 'unlock', name: 'read_skill', args: { id: 'self-explain' } }],
            };
          }
          return lastToolText.length > 0
            ? 'The schedule is prepared.'
            : { toolCalls: [{ id: 'schedule', name: 'schedule_note', args: {} }] };
        },
      });
      const agent = Agent.create({ provider, model: 'mock', maxIterations: 6 })
        .tool(
          defineTool({
            name: 'schedule_note',
            description: 'Read a synthetic schedule note.',
            inputSchema: { type: 'object', properties: {} },
            execute: () => sourceText,
          }),
        )
        .toolMiddleware({
          name: 'schedule-view',
          onToolResult: (call) =>
            call.toolName !== 'schedule_note'
              ? allow()
              : disposition === 'withheld'
              ? deny('The draft is unavailable.')
              : allow(admittedText),
        })
        .selfExplain()
        .build();

      await agent.run({ message: 'Prepare the schedule.' });
      await agent.run({ message: 'Explain the previous turn.' });

      expect(overviewReplies).toHaveLength(1);
      expect(overviewReplies[0]).toContain(TRACE_WITHHELD);
      expect(overviewReplies[0]).not.toContain(sourceText);
    },
  );
});
