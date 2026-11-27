import { expect, it } from 'vitest';
import { defineTool } from '../../../tools/tools.js';
import { buildSourceConsultation } from './sourceConsultation.js';

it('does not bind a skill-owned source from a request whose role view is unavailable', () => {
  const tool = defineTool({
    name: 'report',
    description: 'Read a local sample.',
    inputSchema: { type: 'object' },
    execute: () => 'done',
  });
  const claims = new Map([
    [tool.schema.name, [{ channel: 'skill' as const, id: 'reports', tool }]],
  ]);
  const deps = {
    resolve: () => ({ tool }),
    servedTools: {
      current: new Map(),
      currentImplementations: new Map([[tool.schema.name, tool]]),
      lastServed: new Map(),
    },
    toolClaimants: claims,
  };
  const request = { model: 'mock', messages: [], tools: [tool.schema] };
  const guarded = buildSourceConsultation({ ...deps, roleViewRequired: true });
  expect(guarded.capture({} as never, request, request)).toEqual([]);
  expect(guarded.capture({ hiddenSkillIds: ['reports'] } as never, request, request)).toEqual([]);
  expect(guarded.capture({ hiddenSkillIds: [] } as never, request, request)).toEqual([
    { wireName: 'report', tool },
  ]);
  expect(buildSourceConsultation(deps).capture({} as never, request, request)).toEqual([
    { wireName: 'report', tool },
  ]);
});
