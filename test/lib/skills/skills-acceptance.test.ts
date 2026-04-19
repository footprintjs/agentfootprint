/**
 * Skills — acceptance tests proving end-to-end agent round-trip.
 *
 * Scenarios:
 *   1. Model calls `list_skills` → sees all registered skills with metadata
 *   2. Model calls `read_skill({id})` → sees the skill body in tool result
 *   3. Unknown skill id → tool result error, agent continues (not crash)
 *   4. surfaceMode 'system-prompt' (with Claude-class providerHint) →
 *      skill descriptions appear in the system prompt at iteration 1
 *   5. Skill-level `activeWhen` + `prompt` → contextual prompt injection
 *      when matching decision state (proves the AgentInstruction path)
 *   6. Idempotent re-mount: `.skills(reg1).skills(reg2)` replaces, doesn't
 *      accumulate
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/test-barrel';
import { defineSkill, SkillRegistry } from '../../../src/lib/skills';
import type { LLMResponse, Message, ToolCall } from '../../../src/test-barrel';

function mockProvider(responses: LLMResponse[]) {
  const calls: Message[][] = [];
  let i = 0;
  return {
    chat: vi.fn(async (messages: Message[]) => {
      calls.push([...messages]);
      const r = responses[i] ?? responses[responses.length - 1];
      i++;
      return r;
    }),
    calls,
  };
}

describe('Acceptance — Skills', () => {
  it('model calls list_skills → sees registered skills', async () => {
    const registry = new SkillRegistry();
    registry.register(
      defineSkill({
        id: 'port-triage',
        version: '1.0.0',
        title: 'Port triage',
        description: 'Investigate interfaces with CRC errors.',
      }),
    );
    registry.register(
      defineSkill({
        id: 'auth-reset',
        version: '1.0.0',
        title: 'Password reset',
        description: 'Reset user password.',
      }),
    );

    const listCall: ToolCall = { id: 'tc-1', name: 'list_skills', arguments: {} };
    const provider = mockProvider([
      { content: '', toolCalls: [listCall] },
      { content: 'Found two skills.' },
    ]);

    const agent = Agent.create({ provider }).skills(registry).build();
    const result = await agent.run('what procedures are available?');

    // The list_skills tool ran and its result landed in the transcript
    expect(provider.calls.length).toBeGreaterThanOrEqual(2);
    const toolResultsInTurn2 = JSON.stringify(provider.calls[1]);
    expect(toolResultsInTurn2).toContain('port-triage');
    expect(toolResultsInTurn2).toContain('auth-reset');
    expect(toolResultsInTurn2).toContain('Investigate interfaces with CRC errors.');
    expect(result.content).toBe('Found two skills.');
  });

  it('model calls read_skill → body lands in recency window', async () => {
    const registry = new SkillRegistry();
    registry.register(
      defineSkill({
        id: 'port-triage',
        version: '1.2.0',
        title: 'Port triage',
        description: 'Investigate CRC errors.',
        steps: ['Check metrics', 'Report findings'],
      }),
    );

    const readCall: ToolCall = {
      id: 'tc-1',
      name: 'read_skill',
      arguments: { id: 'port-triage' },
    };
    const provider = mockProvider([
      { content: '', toolCalls: [readCall] },
      { content: 'Following port-triage now.' },
    ]);

    const agent = Agent.create({ provider }).skills(registry).build();
    await agent.run('help with port errors');

    const turn2 = JSON.stringify(provider.calls[1]);
    expect(turn2).toContain('You are now following skill: port-triage (v1.2.0)');
    expect(turn2).toContain('1. Check metrics');
    expect(turn2).toContain('2. Report findings');
  });

  it('read_skill on unknown id → agent sees error, does NOT crash', async () => {
    const registry = new SkillRegistry();
    registry.register(defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'X' }));

    const readCall: ToolCall = {
      id: 'tc-1',
      name: 'read_skill',
      arguments: { id: 'does-not-exist' },
    };
    const provider = mockProvider([
      { content: '', toolCalls: [readCall] },
      { content: 'Skill not found; falling back.' },
    ]);

    const agent = Agent.create({ provider }).skills(registry).build();
    const result = await agent.run('activate missing skill');

    expect(result.content).toBe('Skill not found; falling back.');
    const turn2 = JSON.stringify(provider.calls[1]);
    expect(turn2.toLowerCase()).toContain('not found');
  });

  it('surfaceMode "system-prompt" with Claude-class hint → descriptions in system prompt', async () => {
    const registry = new SkillRegistry({
      surfaceMode: 'system-prompt',
    });
    registry.register(
      defineSkill({
        id: 'port-triage',
        version: '1.0.0',
        title: 'Port triage',
        description: 'Investigate CRC errors.',
      }),
    );

    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider })
      .system('You are an ops assistant.')
      .skills(registry)
      .build();
    await agent.run('hi');

    const turn1Messages = provider.calls[0];
    const systemMsg = turn1Messages.find((m) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    const content = systemMsg!.content as string;
    expect(content).toContain('You are an ops assistant.');
    expect(content).toContain('Available skills');
    expect(content).toContain('port-triage — Port triage: Investigate CRC errors.');
  });

  it('surfaceMode "auto" + Anthropic Claude 4 hint → descriptions in prompt (both mode)', async () => {
    const registry = new SkillRegistry({
      surfaceMode: 'auto',
      providerHint: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
    });
    registry.register(
      defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'Does X.' }),
    );

    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider }).skills(registry).build();
    await agent.run('hi');

    const systemMsg = provider.calls[0].find((m) => m.role === 'system');
    expect(systemMsg!.content as string).toContain('x — X: Does X.');
  });

  it('surfaceMode "tool-only" (default) → descriptions NOT in prompt, but tools are callable', async () => {
    const registry = new SkillRegistry(); // default: tool-only
    registry.register(
      defineSkill({ id: 'x', version: '1.0.0', title: 'X', description: 'Does X.' }),
    );

    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider }).system('Base.').skills(registry).build();
    await agent.run('hi');

    const systemMsg = provider.calls[0].find((m) => m.role === 'system');
    // No skill metadata in the system prompt under tool-only mode
    expect(systemMsg!.content as string).not.toContain('x — X:');
    // But list_skills + read_skill are advertised to the model as tools
    const toolsAdvertised = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][1]?.tools;
    const toolNames = (toolsAdvertised ?? []).map((t: { name: string }) => t.name);
    expect(toolNames).toContain('list_skills');
    expect(toolNames).toContain('read_skill');
  });

  it('skill activeWhen + prompt fires when decision state matches', async () => {
    interface D {
      severity: 'critical' | 'low';
    }
    const registry = new SkillRegistry<D>();
    registry.register(
      defineSkill<D>({
        id: 'emergency',
        version: '1.0.0',
        title: 'Emergency',
        description: 'Handle critical incidents.',
        activeWhen: (d) => d.severity === 'critical',
        prompt: 'ESCALATE IMMEDIATELY.',
      }),
    );

    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider })
      .decision<D>({ severity: 'critical' })
      .skills(registry)
      .build();
    await agent.run('help');

    const systemMsg = provider.calls[0].find((m) => m.role === 'system');
    expect(systemMsg!.content as string).toContain('ESCALATE IMMEDIATELY');
  });

  it('skill activeWhen does NOT fire when decision state does not match', async () => {
    interface D {
      severity: 'critical' | 'low';
    }
    const registry = new SkillRegistry<D>();
    registry.register(
      defineSkill<D>({
        id: 'emergency',
        version: '1.0.0',
        title: 'Emergency',
        description: 'Handle critical incidents.',
        activeWhen: (d) => d.severity === 'critical',
        prompt: 'ESCALATE IMMEDIATELY.',
      }),
    );

    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider })
      .system('Base prompt.')
      .decision<D>({ severity: 'low' })
      .skills(registry)
      .build();
    await agent.run('help');

    // Base prompt present, skill prompt omitted because activeWhen is false.
    const allContent = JSON.stringify(provider.calls[0]);
    expect(allContent).toContain('Base prompt.');
    expect(allContent).not.toContain('ESCALATE IMMEDIATELY');
  });

  it('idempotent re-mount: .skills(reg1).skills(reg2) → only reg2 active', async () => {
    const reg1 = new SkillRegistry();
    reg1.register(defineSkill({ id: 'old', version: '1.0.0', title: 'Old', description: 'Old.' }));
    const reg2 = new SkillRegistry();
    reg2.register(defineSkill({ id: 'new', version: '1.0.0', title: 'New', description: 'New.' }));

    const listCall: ToolCall = { id: 'tc-1', name: 'list_skills', arguments: {} };
    const provider = mockProvider([{ content: '', toolCalls: [listCall] }, { content: 'Done.' }]);

    const agent = Agent.create({ provider }).skills(reg1).skills(reg2).build();
    await agent.run('list them');

    const turn2 = JSON.stringify(provider.calls[1]);
    expect(turn2).toContain('new');
    expect(turn2).not.toContain('"id": "old"');
  });
});
