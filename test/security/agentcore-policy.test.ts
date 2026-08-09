/**
 * agentCorePolicy — RETIRED in 9.4.0.
 *
 * Through 9.3.0 this adapter dispatched `EvaluatePolicyCommand` against
 * `@aws-sdk/client-bedrock-agentcore`. That command does not exist: AgentCore
 * has no data-plane authorization call, because policy is authored on the
 * control plane and enforced AT THE GATEWAY. The old suite was 40-odd green
 * tests, every one of them injecting `_client` or a fake `_sdk` past the SDK —
 * which is exactly how a phantom command stays green for two minor versions.
 *
 * What is under test now is the retirement itself, and the promise that came
 * with it: the export still exists, it refuses by name, and everything the
 * refusal points at still works.
 *
 * Nothing here reaches AWS. There is nothing left that could.
 */

import { describe, expect, it } from 'vitest';

import {
  agentCorePolicy,
  AgentCorePolicyRetiredError,
  PermissionPolicy,
  type AgentCorePolicyClientLike,
  type AgentCorePolicyEvaluation,
  type AgentCorePolicyOptions,
  type AgentCorePolicyUnavailable,
  type BedrockAgentCorePolicySdkModule,
} from '../../src/security/index.js';
import { gatedTools, staticTools } from '../../src/tool-providers/index.js';
import { Agent } from '../../src/core/Agent.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { Tool } from '../../src/core/tools.js';

const STORE = 'policy-store-1';

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

// ── unit — the refusal ──────────────────────────────────────────────

describe('agentCorePolicy — retired', () => {
  it('refuses at construction, by its own error type', () => {
    expect(() => agentCorePolicy({ policyStoreId: STORE })).toThrow(AgentCorePolicyRetiredError);
    expect(() => agentCorePolicy({ policyStoreId: STORE })).toThrow(/retired/i);
  });

  it('carries a machine-readable code beside the prose', () => {
    try {
      agentCorePolicy({ policyStoreId: STORE });
      expect.unreachable('the factory must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentCorePolicyRetiredError);
      expect((err as AgentCorePolicyRetiredError).code).toBe('ERR_AGENTCORE_POLICY_RETIRED');
      expect((err as Error).name).toBe('AgentCorePolicyRetiredError');
    }
  });

  it('refuses whatever options it is handed — there is no surviving arm', () => {
    const shapes: AgentCorePolicyOptions[] = [
      { policyStoreId: STORE },
      { policyStoreId: STORE, region: 'us-west-2' },
      { policyStoreId: STORE, onUnavailable: 'allow-with-warning' },
      { policyStoreId: STORE, cacheSize: 1, name: 'mine' },
      // Even the seams that used to bypass the SDK entirely: the adapter is
      // not "broken against AWS", it is retired, so an injected client is not
      // a way back in.
      { policyStoreId: STORE, _client: { evaluate: async () => ({ decision: 'ALLOW' }) } },
      { policyStoreId: STORE, _sdk: {} },
    ];
    for (const options of shapes) {
      expect(() => agentCorePolicy(options)).toThrow(AgentCorePolicyRetiredError);
    }
  });
});

// ── boundary — the message has to teach, not just refuse ────────────

describe('agentCorePolicy — what the refusal says', () => {
  const message = (() => {
    try {
      agentCorePolicy({ policyStoreId: STORE });
      return '';
    } catch (err) {
      return (err as Error).message;
    }
  })();

  it('names the command that never existed, and the package it was sought in', () => {
    expect(message).toContain('EvaluatePolicyCommand');
    expect(message).toContain('@aws-sdk/client-bedrock-agentcore');
  });

  it('names WHERE AgentCore policy is really enforced', () => {
    expect(message).toMatch(/enforced at the gateway/i);
  });

  it('names the local alternative, in code the reader can copy', () => {
    expect(message).toContain('PermissionPolicy.fromRoles');
    expect(message).toContain('permissionChecker');
    expect(message).toContain('.toolMiddleware()');
  });

  it('says how a Gateway denial actually arrives', () => {
    expect(message).toMatch(/MCP error/);
    expect(message).toContain('mcpClient');
  });
});

// ── property — the surface did not shrink ───────────────────────────

describe('agentCorePolicy — the export survived the retirement', () => {
  it('the factory and every type it used are still importable', () => {
    // A deletion would have failed this file at import time with a
    // module-resolution error explaining nothing. The types below are
    // referenced so the compiler proves they still resolve.
    const evaluation: AgentCorePolicyEvaluation = { decision: 'ALLOW' };
    const client: AgentCorePolicyClientLike = { evaluate: async () => evaluation };
    const mode: AgentCorePolicyUnavailable = 'deny';
    const sdk: BedrockAgentCorePolicySdkModule = {};
    expect(typeof agentCorePolicy).toBe('function');
    expect(evaluation.decision).toBe('ALLOW');
    expect(typeof client.evaluate).toBe('function');
    expect(mode).toBe('deny');
    expect(sdk.EvaluatePolicyCommand).toBeUndefined();
  });
});

// ── refusal is not the same as a hole: the port still works ─────────

describe('the PermissionChecker port the refusal points at', () => {
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
