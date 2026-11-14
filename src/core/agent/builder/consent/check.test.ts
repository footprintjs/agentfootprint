import { describe, expect, it, vi } from 'vitest';
import type { Injection } from '../../../../injection-engine/types.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';
import { defineTool, type Tool, type ToolRegistryEntry } from '../../../../tools/tools.js';
import { assertCheckInHasADeclaringTool } from './check.js';

const plainTool = () => defineTool({ name: 'read', description: 'Read', execute: () => 'done' });
const declaringTool = () =>
  defineTool({
    name: 'write',
    description: 'Write',
    checkIn: () => false,
    execute: () => 'done',
  });
const entry = (tool: Tool): ToolRegistryEntry => ({ name: tool.schema.name, tool });

describe('consent configuration has a declaring tool', () => {
  it('leaves an unconfigured gate alone', () => {
    expect(() => assertCheckInHasADeclaringTool(false, [], [], undefined)).not.toThrow();
  });

  it('refuses configured consent when neither source declares it', () => {
    expect(() => assertCheckInHasADeclaringTool(true, [entry(plainTool())], [], undefined)).toThrow(
      /no registered tool declares `checkIn`/,
    );
  });

  it('counts a static declaration without evaluating its predicate', () => {
    const tool = declaringTool();
    const predicate = vi.fn(() => false);
    const declared = { ...tool, checkIn: predicate };

    expect(() =>
      assertCheckInHasADeclaringTool(true, [entry(declared)], [], undefined),
    ).not.toThrow();
    expect(predicate).not.toHaveBeenCalled();
  });

  it('counts a declaration supplied by a skill', () => {
    const skill: Injection = {
      id: 'approval',
      flavor: 'skill',
      trigger: { kind: 'always' },
      inject: { tools: [declaringTool()] },
    };

    expect(() => assertCheckInHasADeclaringTool(true, [], [skill], undefined)).not.toThrow();
  });

  it('does not discover a provider whose run-time declarations are unknown', () => {
    const list = vi.fn(() => []);
    const provider: ToolProvider = { id: 'discovered', list };

    expect(() => assertCheckInHasADeclaringTool(true, [], [], provider)).not.toThrow();
    expect(list).not.toHaveBeenCalled();
  });
});
