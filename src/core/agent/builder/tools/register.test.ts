import { describe, expect, it } from 'vitest';
import type { RecipeSource } from '../../../../recipes/provenance.js';
import type { Tool } from '../../../../tools/tools.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';
import { registerTool, type ToolRegistrationPort } from './register.js';
import { setToolProvider, type ToolProviderPort } from './provider.js';

describe('builder tool declarations', () => {
  it('retains the tool and records provenance after registration on the actual receiver', () => {
    const source: RecipeSource = { kind: 'recipe', stack: [{ id: 'tool-set', version: '1.0.0' }] };
    const receiver: ToolRegistrationPort = {
      registry: [],
      toolSources: new Map(),
      duplicateRefusal() {
        return 'duplicate from the live receiver';
      },
      currentSource() {
        expect(this).toBe(receiver);
        expect(this.registry).toHaveLength(1);
        return source;
      },
    };
    const tool: Tool<{ query: string }, string> = {
      schema: { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
      execute: ({ query }) => query,
    };
    expect(registerTool(receiver, tool, receiver)).toBe(receiver);
    expect(receiver.registry[0].tool).toBe(tool);
    expect(receiver.toolSources.get('search')).toBe(source);
    expect(() => registerTool(receiver, tool, receiver)).toThrow(
      'duplicate from the live receiver',
    );
    expect(receiver.registry).toHaveLength(1);
  });

  it('declares one tool provider without discovering any tools', () => {
    const receiver: ToolProviderPort = {};
    const provider: ToolProvider = {
      list: () => {
        throw new Error('must not discover');
      },
    };
    expect(setToolProvider(receiver, provider, receiver)).toBe(receiver);
    expect(receiver.toolProviderRef).toBe(provider);
    expect(() => setToolProvider(receiver, provider, receiver)).toThrow('already set');
  });
});
