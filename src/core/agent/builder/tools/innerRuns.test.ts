import { describe, expect, it } from 'vitest';
import {
  INNER_RUN_RECORDS,
  innerRunStore,
  type InnerRunRecord,
  type InnerRunStore,
} from '../../../innerRunRecords.js';
import type { Injection } from '../../../../injection-engine/types.js';
import { defineTool, type Tool, type ToolRegistryEntry } from '../../../../tools/tools.js';
import { collectInnerRuns } from './innerRuns.js';

const plainTool = (name: string) => defineTool({ name, description: name, execute: () => 'done' });
const keptTool = (name: string, store: InnerRunStore) => ({
  ...plainTool(name),
  [INNER_RUN_RECORDS]: store,
});
const entry = (tool: Tool): ToolRegistryEntry => ({ name: tool.schema.name, tool });
const skill = (id: string, tools: readonly Tool[]): Injection => ({
  id,
  flavor: 'skill',
  trigger: { kind: 'always' },
  inject: { tools },
});
const record = (toolCallId: string, toolName: string): InnerRunRecord => ({
  toolCallId,
  toolName,
  outcome: 'ok',
  steps: 1,
  recording: { snapshot: {} },
});

describe('inner-run collection', () => {
  it('keeps absence distinct from an empty retained lookup', () => {
    expect(collectInnerRuns([entry(plainTool('read'))], [skill('plain', [])])).toBeUndefined();

    const store = innerRunStore();
    expect(collectInnerRuns([entry(keptTool('read', store))], [])).toBe(store);
  });

  it('deduplicates one store shared by static and skill tools by reference', () => {
    const store = innerRunStore();
    const shared = keptTool('read', store);

    expect(
      collectInnerRuns([entry(shared)], [skill('first', [shared]), skill('second', [shared])]),
    ).toBe(store);
  });

  it('joins both sources in declaration order and keeps their live stores', () => {
    const staticStore = innerRunStore();
    const skillStore = innerRunStore();
    const staticRecord = record('same-call', 'static-tool');
    const skillRecord = record('same-call', 'skill-tool');
    staticStore.keep(staticRecord);
    skillStore.keep(skillRecord);

    const lookup = collectInnerRuns(
      [entry(keptTool('static-tool', staticStore))],
      [skill('with-records', [keptTool('skill-tool', skillStore)])],
    );

    expect(lookup?.get('same-call')).toBe(staticRecord);
    expect(lookup?.list().map((item) => item.toolName)).toEqual(['static-tool', 'skill-tool']);

    const later = record('later-call', 'skill-tool');
    skillStore.keep(later);
    expect(lookup?.get('later-call')).toBe(later);
  });
});
