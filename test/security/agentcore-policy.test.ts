/** The removed policy shim stays absent; the supported authorization seam still works. */
import { describe, expect, it } from 'vitest';

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as security from '../../src/doors/security.js';
import { PermissionPolicy } from '../../src/security/index.js';
import { gatedTools, staticTools } from '../../src/tool-providers/index.js';
import { Agent } from '../../src/core/Agent.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { Tool } from '../../src/core/tools.js';

function scripted(...responses: LLMResponse[]): LLMProvider {
  let index = 0;
  return { name: 'mock', complete: async () => responses[Math.min(index++, responses.length - 1)] };
}

function reply(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 10, output: 5 },
    stopReason: toolCalls.length ? 'tool_use' : 'stop',
  };
}

function tool(name: string): Tool {
  return {
    schema: { name, description: name, inputSchema: { type: 'object' } },
    execute: () => `${name} ran`,
  };
}

describe('removed agentCorePolicy adapter', () => {
  it('exports neither a callable stub nor its retired error', () => {
    expect(security).not.toHaveProperty('agentCorePolicy');
    expect(security).not.toHaveProperty('AgentCorePolicyRetiredError');
  });

  it('leaves no private shim behind', () => {
    expect(existsSync(join(__dirname, '../../src/adapters/security/agentcore.ts'))).toBe(false);
  });
});

describe('the supported PermissionChecker port', () => {
  it('PermissionPolicy.fromRoles denies a tool call end to end, unchanged', async () => {
    let ran = false;
    const policy = PermissionPolicy.fromRoles(
      { readonly: ['lookup'], admin: ['lookup', 'refund'] },
      'readonly',
    );
    const agent = Agent.create({
      provider: scripted(reply('', [{ id: 't1', name: 'refund', args: {} }]), reply('understood')),
      model: 'mock',
      permissionChecker: policy,
    })
      .system('')
      .tool({
        schema: { name: 'refund', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          ran = true;
          return 'refunded';
        },
      })
      .build();

    const decisions: string[] = [];
    agent.on('agentfootprint.permission.check', (event) => {
      decisions.push((event as { payload: { result: string } }).payload.result);
    });
    await agent.run({ message: 'refund it' });
    expect(ran).toBe(false);
    expect(decisions).toEqual(['deny']);
  });

  it('and it still composes with gatedTools — different layers, neither knows the other', async () => {
    const policy = PermissionPolicy.fromRoles({ readonly: ['lookup', 'refund'] }, 'readonly');
    const provider = gatedTools(staticTools([tool('lookup'), tool('refund')]), (name) =>
      name.startsWith('look'),
    );
    const agent = Agent.create({
      provider: scripted(reply('', [{ id: 't1', name: 'lookup', args: {} }]), reply('done')),
      model: 'mock',
      permissionChecker: policy,
    })
      .system('')
      .toolProvider(provider)
      .build();

    const checked: string[] = [];
    agent.on('agentfootprint.permission.check', (event) => {
      checked.push((event as { payload: { target?: string } }).payload.target ?? '');
    });
    await agent.run({ message: 'look it up' });
    expect(checked).toEqual(['lookup']);
  });
});
