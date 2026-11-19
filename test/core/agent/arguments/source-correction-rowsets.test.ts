import { describe, expect, it } from 'vitest';
import { Agent, defineTool, type AgentfootprintEvent } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import {
  VM,
  QUESTION,
  TOOL,
  proposal,
  quoted,
  batch,
  jsonCopy,
} from './sourceCorrectionHarness.js';

describe.each(['dynamic', 'dynamic-grouped'] as const)(
  'source correction preserves native named-rowset liveness in %s',
  (mode) => {
    it.each([false, true])(
      'accounts a held rowset only as no-result and retains an earlier finding: %s',
      async (earlier) => {
        const events: AgentfootprintEvent[] = [];
        const executions: Record<string, unknown>[] = [];
        const beforeRequest: { executions: number; rowsetChecks: number }[] = [];
        const tool = defineTool({
          name: TOOL,
          description: 'Read one synthetic VM through the native rowset-only contract.',
          inputSchema: {
            type: 'object',
            properties: { vm: { type: 'string' } },
            required: ['vm'],
          },
          askOrAssume: { vm: { ask: 'Which synthetic VM?' } },
          resultRowsets: [
            {
              key: 'disks',
              columns: { capacity: 'number' },
              source: { kind: 'inline', path: ['rows'] },
            },
          ],
          execute(args) {
            executions.push(jsonCopy(args));
            return { rows: [{ capacity: earlier && executions.length === 1 ? 'wrong-type' : 7 }] };
          },
        });
        expect(Object.hasOwn(tool, 'resultColumns')).toBe(false);
        const replies = [
          ...(earlier ? [batch(quoted('completed-before-hold'))] : []),
          batch(proposal('held-rowset', { vm: VM })),
          batch(quoted('corrected-rowset')),
          'Done.',
        ];
        const agent = Agent.create({
          model: 'mock',
          reactMode: mode,
          checkColumnTypes: 'warn',
          integrityPosture: 'dev',
          provider: mock({
            respond() {
              beforeRequest.push({
                executions: executions.length,
                rowsetChecks: events.filter(
                  (event) => event.type === 'agentfootprint.tools.rowset_checked',
                ).length,
              });
              return replies[beforeRequest.length - 1] ?? 'Unexpected extra request.';
            },
          }),
        })
          .tool(tool)
          .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
          .build();
        agent.on('*', (event) => events.push(jsonCopy(event)));
        try {
          const outcome: unknown = await agent.run(QUESTION).catch((error: unknown) => error);
          expect(outcome).toBe(
            earlier
              ? "Done.\n\n---\n\nNot sure — a tool's rows hold a different type than the tool declares."
              : 'Done.',
          );
          expect(executions).toEqual(Array.from({ length: earlier ? 2 : 1 }, () => ({ vm: VM })));
          expect(beforeRequest).toEqual([
            ...(earlier ? [{ executions: 0, rowsetChecks: 0 }] : []),
            { executions: earlier ? 1 : 0, rowsetChecks: earlier ? 1 : 0 },
            { executions: earlier ? 1 : 0, rowsetChecks: earlier ? 1 : 0 },
            { executions: earlier ? 2 : 1, rowsetChecks: earlier ? 2 : 1 },
          ]);
          const checks = events
            .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
            .map((event) => event.payload);
          expect(checks).toMatchObject([
            ...(earlier
              ? [
                  {
                    toolCallId: 'completed-before-hold',
                    rowset: 'disks',
                    disposition: 'checked-fail',
                  },
                ]
              : []),
            { toolCallId: 'corrected-rowset', rowset: 'disks', disposition: 'checked-pass' },
          ]);
          expect(checks).toHaveLength(earlier ? 2 : 1);
          const findings = events
            .filter((event) => event.type === 'agentfootprint.integrity.context_error')
            .map((event) => event.payload);
          expect(findings).toHaveLength(earlier ? 1 : 0);
          if (earlier)
            expect(findings[0]).toMatchObject({
              kind: 'column-type-mismatch',
              subjects: [{ kind: 'tool', id: TOOL }],
              rowset: 'disks',
              predicate: 'capacity',
            });
          if (earlier) expect(findings[0]?.message).toContain('completed-before-hold');
          const disposition = events.findLast(
            (event) => event.type === 'agentfootprint.integrity.disposition',
          );
          expect(disposition).toBeDefined();
          if (disposition?.type !== 'agentfootprint.integrity.disposition')
            throw new Error('Expected native disposition');
          for (const check of ['column-type-mismatch', 'missing-column'])
            expect(
              disposition.payload.rows.find((row) => row.check === check && row.seam === 'write'),
            ).toMatchObject({
              checked: earlier ? 2 : 1,
              findings: earlier && check === 'column-type-mismatch' ? 1 : 0,
              notApplicable: 2,
              unreachable: 0,
            });
        } finally {
          await agent.shutdown();
        }
      },
    );
  },
);
