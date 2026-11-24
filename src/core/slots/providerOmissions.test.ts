import { expect, it } from 'vitest';
import { defineTool, type Tool } from '../../tools/tools.js';
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
  collector.observe({ kind: 'ledger', name: 'monitor', tool: restricted });
  collector.observe({ kind: 'ledger', name: 'monitor', tool: visible });
  expect(collector.result()).toEqual({
    rows: [{ kind: 'ledger', name: 'monitor', tool: visible }],
    complete: true,
  });
  const unresolved = providerOmissions(claims, undefined);
  unresolved.observe({ kind: 'ledger', name: 'monitor', tool: visible });
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
    collector.observe({ kind: 'ledger', name: 'private', tool: restricted });
    collector.observe({ kind: 'ledger', name: 'monitor', tool: ordinary });
  }
  for (let i = 1; i < 1024; i++)
    collector.observe({ kind: 'ledger', name: 'monitor-' + i, tool: tool('monitor-' + i) });
  expect(collector.result()?.rows).toHaveLength(1024);
  expect(collector.result()?.complete).toBe(true);
  collector.observe({ kind: 'ledger', name: 'monitor-last', tool: tool('monitor-last') });
  expect(collector.result()?.rows).toHaveLength(1024);
  expect(collector.result()?.complete).toBe(false);
});

it('keeps each distinct decision in provider order and withholds an ambiguous registration', () => {
  const first = tool('first');
  const second = tool('second');
  const ambiguous = tool('alias');
  const claim = (tool: Tool, id: string): ToolClaim => ({
    channel: 'skill',
    id,
    tool,
  });
  const collector = providerOmissions(
    new Map([
      ['second', [claim(second, 'triage'), claim(second, 'other')]],
      ['alias', [claim(ambiguous, 'triage')]],
      ['also-alias', [claim(ambiguous, 'triage')]],
      ['first', [claim(first, 'triage')]],
    ]),
    [],
  );
  collector.observe({
    kind: 'skill-scope',
    skillId: 'triage',
    tools: [first, ambiguous, second, first],
  });
  collector.observe({ kind: 'skill-scope', skillId: 'other', tools: [second] });
  collector.observe({ kind: 'ledger', name: 'second', tool: second });
  expect(collector.result()).toEqual({
    complete: true,
    rows: [
      { kind: 'skill-scope', skillId: 'triage', name: 'first', tool: first },
      { kind: 'skill-scope', skillId: 'triage', name: 'second', tool: second },
      { kind: 'skill-scope', skillId: 'other', name: 'second', tool: second },
      { kind: 'ledger', name: 'second', tool: second },
    ],
  });
});
