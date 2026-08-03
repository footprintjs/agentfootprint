/**
 * agentCorePolicy — a remote policy engine behind the PermissionChecker port.
 *
 * **Contract-mapped and injection-tested.** Every AWS interaction below goes
 * through the `_client` seam, and the SDK shim is exercised with a fake `_sdk`
 * module. Nothing here reaches AWS and nothing pretends to; real-cloud
 * verification lands with a field deployment. What IS really verified is the
 * behaviour that would hurt you if it were wrong: fail-closed on an unreachable
 * engine, the deny reason reaching the model as data, one evaluation per turn,
 * and composing with `gatedTools` without either knowing about the other.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  agentCorePolicy,
  type AgentCorePolicyClientLike,
  type AgentCorePolicyEvaluation,
  type BedrockAgentCorePolicySdkModule,
} from '../../src/security/index.js';
import { gatedTools, staticTools } from '../../src/tool-providers/index.js';
import { Agent } from '../../src/core/Agent.js';
import type { LLMProvider, LLMResponse, PermissionRequest } from '../../src/adapters/types.js';
import type { Tool } from '../../src/core/tools.js';

// ── Fixtures ────────────────────────────────────────────────────────

const STORE = 'policy-store-1';

function client(
  answer: (input: { action: string; principal: string }) => AgentCorePolicyEvaluation,
): AgentCorePolicyClientLike & { readonly calls: { action: string; principal: string }[] } {
  const calls: { action: string; principal: string }[] = [];
  return {
    calls,
    async evaluate(input) {
      calls.push({ action: input.action, principal: input.principal });
      return answer(input);
    },
  };
}

function request(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    capability: 'tool_call',
    actor: 'agent',
    target: 'refund',
    iteration: 1,
    ...over,
  };
}

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

// ── unit ────────────────────────────────────────────────────────────

describe('agentCorePolicy — unit', () => {
  it('satisfies the PermissionChecker port and names itself', () => {
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      _client: client(() => ({ decision: 'ALLOW' })),
    });
    expect(policy.name).toBe('agentCorePolicy');
    expect(typeof policy.check).toBe('function');
  });

  it('takes a custom name, so two stores are distinguishable on events', () => {
    expect(
      agentCorePolicy({
        policyStoreId: STORE,
        name: 'refund-policy',
        _client: client(() => ({ decision: 'ALLOW' })),
      }).name,
    ).toBe('refund-policy');
  });

  it('refuses to be built without a policy store, at construction', () => {
    expect(() => agentCorePolicy({ policyStoreId: '' })).toThrow(/policyStoreId/);
  });

  it('building it loads no AWS SDK — the require is lazy', () => {
    // No `_client`, no `_sdk`, and no throw: nothing is resolved until a check
    // actually needs to evaluate.
    expect(() => agentCorePolicy({ policyStoreId: STORE })).not.toThrow();
  });
});

// ── scenario: what the engine says, and what the agent gets ─────────

describe('agentCorePolicy — decisions', () => {
  it('ALLOW allows, and carries the deciding policy id for the audit trail', async () => {
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      _client: client(() => ({ decision: 'ALLOW', policyId: 'p-42' })),
    });
    expect(await policy.check(request())).toMatchObject({ result: 'allow', policyRuleId: 'p-42' });
  });

  it('DENY denies, and the REASON rides to the model as data', async () => {
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      _client: client(() => ({ decision: 'DENY', reason: 'refunds need a supervisor' })),
    });
    const decision = await policy.check(request());
    expect(decision.result).toBe('deny');
    // tellLLM is what the model actually sees, so it can re-decide with the
    // refusal in front of it instead of the run dying.
    expect(decision.tellLLM).toContain('refunds need a supervisor');
    expect(decision.rationale).toContain('refunds need a supervisor');
  });

  it('is case- and whitespace-insensitive about the verdict', async () => {
    for (const decision of ['allow', 'Allow', ' ALLOW ']) {
      const policy = agentCorePolicy({
        policyStoreId: STORE,
        _client: client(() => ({ decision })),
      });
      expect((await policy.check(request())).result).toBe('allow');
    }
  });

  it.each(['DENY', 'INDETERMINATE', 'ALLOW_WITH_CONDITIONS', '', 'maybe'])(
    'treats an unrecognised verdict (%s) as a denial',
    async (decision) => {
      // A verdict this adapter does not recognise is not a permission. Anything
      // else means a future API value silently becomes an allow.
      const policy = agentCorePolicy({
        policyStoreId: STORE,
        _client: client(() => ({ decision })),
      });
      expect((await policy.check(request())).result).toBe('deny');
    },
  );

  it('denies with a generic message when the engine gives no reason', async () => {
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      _client: client(() => ({ decision: 'DENY' })),
    });
    const decision = await policy.check(request());
    expect(decision.tellLLM).toContain('refund');
    expect(decision.reason).toBe('policy:denied');
  });

  it('sends the tool as the action and the capability as the resource', async () => {
    const evaluations: Record<string, unknown>[] = [];
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      _client: {
        async evaluate(input) {
          evaluations.push({ ...input });
          return { decision: 'ALLOW' };
        },
      },
    });
    await policy.check(request({ target: 'issue_refund', context: { amount: 100 } }));
    expect(evaluations[0]).toMatchObject({
      policyStoreId: STORE,
      action: 'issue_refund',
      resource: 'tool_call',
    });
    expect((evaluations[0].context as { arguments: unknown }).arguments).toEqual({ amount: 100 });
  });

  it('falls back to the capability when there is no tool name', async () => {
    const seam = client(() => ({ decision: 'ALLOW' }));
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: seam });
    await policy.check(request({ capability: 'memory_write', target: undefined }));
    expect(seam.calls[0].action).toBe('memory_write');
  });
});

// ── security: fail closed ───────────────────────────────────────────

describe('agentCorePolicy — an engine that cannot answer', () => {
  const unreachable: AgentCorePolicyClientLike = {
    evaluate: async () => {
      throw new Error('ECONNREFUSED policy endpoint');
    },
  };

  it('denies by default — a policy engine that did not answer did not say yes', async () => {
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: unreachable });
    const decision = await policy.check(request());
    expect(decision.result).toBe('deny');
    expect(decision.reason).toBe('policy:unavailable');
    expect(decision.rationale).toContain('ECONNREFUSED');
  });

  it('does NOT tell the model the policy engine is down', async () => {
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: unreachable });
    const decision = await policy.check(request());
    // An outage is an operator's fact. Handing it to a model invites it to
    // argue with the outage instead of accepting the refusal.
    expect(decision.tellLLM).not.toContain('ECONNREFUSED');
    expect(decision.tellLLM).toContain('not available right now');
  });

  it("'allow-with-warning' allows, and says out loud that nothing authorized it", async () => {
    const warnings: string[] = [];
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      onUnavailable: 'allow-with-warning',
      onWarning: (message) => warnings.push(message),
      _client: unreachable,
    });
    const decision = await policy.check(request());
    expect(decision.result).toBe('allow');
    expect(warnings[0]).toContain('NOT authorized by policy');
  });

  it("'allow-with-warning' never rescues an EXPLICIT denial", async () => {
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      onUnavailable: 'allow-with-warning',
      onWarning: () => undefined,
      _client: client(() => ({ decision: 'DENY', reason: 'nope' })),
    });
    // The option is about a failure to CHECK, never about the answer.
    expect((await policy.check(request())).result).toBe('deny');
  });

  it('warns through console by default, so an allow-on-failure is never silent', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      onUnavailable: 'allow-with-warning',
      _client: unreachable,
    });
    await policy.check(request());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a missing SDK denies rather than allowing — fail-closed reaches setup errors too', async () => {
    // No `_client`, no `_sdk`: resolving the client throws inside check(), and
    // the fail-closed path has to catch that as surely as a network error.
    const policy = agentCorePolicy({ policyStoreId: STORE, _sdk: {} });
    expect((await policy.check(request())).result).toBe('deny');
  });
});

// ── performance: one evaluation per (tool, principal) per turn ──────

describe('agentCorePolicy — caching', () => {
  const identity = { principal: 'ada', tenant: 'acme', conversationId: 'c-1' };

  it('evaluates once for the same tool and principal within one turn', async () => {
    const seam = client(() => ({ decision: 'ALLOW' }));
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: seam });
    await policy.check(request({ identity, iteration: 1 }));
    await policy.check(request({ identity, iteration: 1 }));
    await policy.check(request({ identity, iteration: 1 }));
    expect(seam.calls).toHaveLength(1);
  });

  it('re-asks on the NEXT turn, so a policy change lands within the run', async () => {
    let verdict = 'ALLOW';
    const seam = client(() => ({ decision: verdict }));
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: seam });
    expect((await policy.check(request({ identity, iteration: 1 }))).result).toBe('allow');
    verdict = 'DENY';
    expect((await policy.check(request({ identity, iteration: 2 }))).result).toBe('deny');
    expect(seam.calls).toHaveLength(2);
  });

  it('never hands one principal the decision made for another', async () => {
    const seam = client(({ principal }) => ({ decision: principal === 'ada' ? 'ALLOW' : 'DENY' }));
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: seam });
    expect((await policy.check(request({ identity }))).result).toBe('allow');
    expect(
      (await policy.check(request({ identity: { ...identity, principal: 'bob' } }))).result,
    ).toBe('deny');
  });

  it('keys on the tool, so allowing one does not allow the next', async () => {
    const seam = client(({ action }) => ({ decision: action === 'lookup' ? 'ALLOW' : 'DENY' }));
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: seam });
    expect((await policy.check(request({ identity, target: 'lookup' }))).result).toBe('allow');
    expect((await policy.check(request({ identity, target: 'refund' }))).result).toBe('deny');
  });

  it('separates conversations, so two sessions never share a verdict', async () => {
    const seam = client(() => ({ decision: 'ALLOW' }));
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: seam });
    await policy.check(request({ identity }));
    await policy.check(request({ identity: { ...identity, conversationId: 'c-2' } }));
    expect(seam.calls).toHaveLength(2);
  });

  it('is bounded — a long-running agent cannot grow the cache without limit', async () => {
    const seam = client(() => ({ decision: 'ALLOW' }));
    const policy = agentCorePolicy({ policyStoreId: STORE, cacheSize: 2, _client: seam });
    for (const iteration of [1, 2, 3]) await policy.check(request({ identity, iteration }));
    // Turn 1 was evicted, so asking again costs a real evaluation.
    await policy.check(request({ identity, iteration: 1 }));
    expect(seam.calls).toHaveLength(4);
  });

  it('uses a custom principal resolver when one is given', async () => {
    const seam = client(() => ({ decision: 'ALLOW' }));
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      principalFor: (id) => `${id?.tenant ?? '-'}:${id?.principal ?? '-'}`,
      _client: seam,
    });
    await policy.check(request({ identity }));
    expect(seam.calls[0].principal).toBe('acme:ada');
  });

  it("defaults an anonymous run's principal to the agent itself", async () => {
    const seam = client(() => ({ decision: 'ALLOW' }));
    await agentCorePolicy({ policyStoreId: STORE, _client: seam }).check(request());
    expect(seam.calls[0].principal).toBe('agent');
  });
});

// ── integration: it composes with what is already in the box ────────

describe('agentCorePolicy — composition', () => {
  it('runs as an Agent permissionChecker: denied tools do not execute', async () => {
    let ran = false;
    const agent = Agent.create({
      provider: scripted(reply('', [{ id: 't1', name: 'refund', args: {} }]), reply('understood')),
      model: 'mock',
      permissionChecker: agentCorePolicy({
        policyStoreId: STORE,
        _client: client(() => ({ decision: 'DENY', reason: 'needs a supervisor' })),
      }),
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

  it('the denial reason reaches the model in its own conversation', async () => {
    const agent = Agent.create({
      provider: scripted(reply('', [{ id: 't1', name: 'refund', args: {} }]), reply('understood')),
      model: 'mock',
      permissionChecker: agentCorePolicy({
        policyStoreId: STORE,
        _client: client(() => ({ decision: 'DENY', reason: 'needs a supervisor' })),
      }),
    })
      .system('')
      .tool({
        schema: { name: 'refund', description: '', inputSchema: { type: 'object' } },
        execute: () => 'refunded',
      })
      .build();

    await agent.run({ message: 'refund it' });
    // The refusal is DATA in the transcript, which is what lets the model
    // recover instead of the run ending.
    const transcript = JSON.stringify(agent.checkpoint()?.history ?? []);
    expect(transcript).toContain('needs a supervisor');
  });

  it('composes with gatedTools unchanged — different layers, neither knows the other', async () => {
    const seam = client(() => ({ decision: 'ALLOW' }));
    const policy = agentCorePolicy({ policyStoreId: STORE, _client: seam });
    // The gate decides what the model is SHOWN; the checker decides what
    // actually RUNS. `gatedTools` keeps its plain sync predicate and is not
    // aware a remote policy exists.
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

    await agent.run({ message: 'look it up' });
    // Hidden tools are never evaluated — the model cannot call what it cannot
    // see — so the only evaluation is for the tool the gate let through.
    expect(seam.calls.map((call) => call.action)).toEqual(['lookup']);
  });
});

// ── the SDK mapping, with a fake SDK module ─────────────────────────

describe('agentCorePolicy — the SDK mapping', () => {
  function fakeSdk(result: unknown) {
    const sent: Record<string, unknown>[] = [];
    const module: BedrockAgentCorePolicySdkModule = {
      BedrockAgentCoreClient: class {
        constructor(readonly config: { region?: string }) {}
        async send(cmd: unknown): Promise<unknown> {
          sent.push((cmd as { input: Record<string, unknown> }).input);
          return result;
        }
      } as unknown as BedrockAgentCorePolicySdkModule['BedrockAgentCoreClient'],
      EvaluatePolicyCommand: class {
        constructor(readonly input: Record<string, unknown>) {}
      } as never,
    };
    return { module, sent };
  }

  it('maps a check onto one evaluate command with the fields it was given', async () => {
    const { module, sent } = fakeSdk({ decision: 'ALLOW', policyId: 'p-1' });
    const policy = agentCorePolicy({ policyStoreId: STORE, region: 'us-west-2', _sdk: module });
    expect((await policy.check(request({ target: 'refund' }))).result).toBe('allow');
    expect(sent[0]).toMatchObject({
      policyStoreId: STORE,
      action: 'refund',
      resource: 'tool_call',
    });
  });

  it('a response with no decision field is a denial, not an allow', async () => {
    const { module } = fakeSdk({ somethingElse: true });
    const policy = agentCorePolicy({ policyStoreId: STORE, _sdk: module });
    expect((await policy.check(request())).result).toBe('deny');
  });

  it('names the missing SDK command instead of failing obscurely', async () => {
    const { module } = fakeSdk({ decision: 'ALLOW' });
    const policy = agentCorePolicy({
      policyStoreId: STORE,
      _sdk: { BedrockAgentCoreClient: module.BedrockAgentCoreClient! },
    });
    const decision = await policy.check(request());
    expect(decision.result).toBe('deny');
    expect(decision.rationale).toContain('EvaluatePolicyCommand');
  });
});
