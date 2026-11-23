import { expect, it } from 'vitest';
import { defineTool } from '../../tools/tools.js';
import type { ToolClaim } from '../agent/buildToolRegistry.js';
import { providerOmissions } from './providerOmissions.js';

const tool = (name: string) =>
  defineTool({
    name,
    description: 'Read a measurement',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'read',
  });

it('requires a visible claim for the same implementation when a skill owns the name', () => {
  const restricted = tool('monitor');
  const visible = tool('monitor');
  const claims = new Map<string, readonly ToolClaim[]>([
    [
      'monitor',
      [
        { channel: 'skill', id: 'restricted', tool: restricted },
        { channel: 'skill', id: 'visible', tool: visible },
      ],
    ],
  ]);
  const collector = providerOmissions(claims, ['restricted']);
  collector.observe({ name: 'monitor', tool: restricted });
  collector.observe({ name: 'monitor', tool: visible });
  expect(collector.result()).toEqual({
    rows: [{ name: 'monitor', tool: visible }],
    complete: true,
  });
  const unresolved = providerOmissions(claims, undefined);
  unresolved.observe({ name: 'monitor', tool: visible });
  expect(unresolved.result()).toBeUndefined();
});

it('filters restricted claims and repeats before applying the discovery bound', () => {
  const restricted = tool('private');
  const ordinary = tool('monitor');
  const collector = providerOmissions(
    new Map([['private', [{ channel: 'skill', id: 'closed', tool: restricted }]]]),
    ['closed'],
  );
  for (let i = 0; i < 2048; i++) {
    collector.observe({ name: 'private', tool: restricted });
    collector.observe({ name: 'monitor', tool: ordinary });
  }
  for (let i = 1; i < 1024; i++)
    collector.observe({ name: 'monitor-' + i, tool: tool('monitor-' + i) });
  expect(collector.result()?.rows).toHaveLength(1024);
  expect(collector.result()?.complete).toBe(true);
  collector.observe({ name: 'monitor-last', tool: tool('monitor-last') });
  expect(collector.result()?.rows).toHaveLength(1024);
  expect(collector.result()?.complete).toBe(false);
});
