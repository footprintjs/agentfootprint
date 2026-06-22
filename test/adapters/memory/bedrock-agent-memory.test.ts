/**
 * BedrockAgentMemory — read-only reader of Bedrock Agents' auto session-summary memory.
 *
 *  1. Behaviour via a mock `BedrockAgentMemoryLikeClient`.
 *  2. SDK-shim guard via a mock SDK module (`_sdk`) — pins the REAL commands
 *     (`GetAgentMemoryCommand` with `memoryType: 'SESSION_SUMMARY'`, `DeleteAgentMemoryCommand`).
 */

import { describe, expect, it } from 'vitest';

import { BedrockAgentMemory } from '../../../src/adapters/memory/bedrockAgentMemory.js';
import type {
  BedrockAgentMemoryLikeClient,
  BedrockAgentSummary,
} from '../../../src/adapters/memory/bedrockAgentMemory.js';

class MockClient implements BedrockAgentMemoryLikeClient {
  deleted: { memoryId: string; sessionId?: string }[] = [];
  constructor(private readonly pages: { summaries: BedrockAgentSummary[]; nextToken?: string }[]) {}
  async getSessionSummaries(input: { memoryId: string; nextToken?: string }) {
    const idx = input.nextToken ? parseInt(input.nextToken, 10) : 0;
    return this.pages[idx] ?? { summaries: [] };
  }
  async deleteMemory(input: { memoryId: string; sessionId?: string }) {
    this.deleted.push({
      memoryId: input.memoryId,
      ...(input.sessionId && { sessionId: input.sessionId }),
    });
  }
}

const sum = (sessionId: string, summaryText: string): BedrockAgentSummary => ({
  sessionId,
  summaryText,
});

describe('BedrockAgentMemory — reader', () => {
  it('throws without agentId / agentAliasId', () => {
    expect(() => new BedrockAgentMemory({ agentId: '', agentAliasId: 'a' })).toThrow(
      /agentId.*agentAliasId/,
    );
    expect(() => new BedrockAgentMemory({ agentId: 'a', agentAliasId: '' })).toThrow(
      /agentId.*agentAliasId/,
    );
  });

  it('readSummaries paginates across nextToken', async () => {
    const client = new MockClient([
      { summaries: [sum('s1', 'first'), sum('s2', 'second')], nextToken: '1' },
      { summaries: [sum('s3', 'third')] },
    ]);
    const mem = new BedrockAgentMemory({ agentId: 'ag', agentAliasId: 'al', _client: client });
    const all = await mem.readSummaries('user-42');
    expect(all.map((s) => s.summaryText)).toEqual(['first', 'second', 'third']);
  });

  it('readText concatenates the summaries', async () => {
    const client = new MockClient([{ summaries: [sum('s1', 'A'), sum('s2', 'B')] }]);
    const mem = new BedrockAgentMemory({ agentId: 'ag', agentAliasId: 'al', _client: client });
    expect(await mem.readText('u')).toBe('A\n\nB');
  });

  it('forget calls deleteMemory (optionally per session)', async () => {
    const client = new MockClient([]);
    const mem = new BedrockAgentMemory({ agentId: 'ag', agentAliasId: 'al', _client: client });
    await mem.forget('u');
    await mem.forget('u', 'sess-9');
    expect(client.deleted).toEqual([{ memoryId: 'u' }, { memoryId: 'u', sessionId: 'sess-9' }]);
  });
});

describe('BedrockAgentMemory — SDK shim guard (REAL commands)', () => {
  function spySdk(getResponse: unknown) {
    const sent: { cmd: string; input: Record<string, unknown> }[] = [];
    const cmd = (name: string) =>
      class {
        static cmdName = name;
        input: Record<string, unknown>;
        constructor(input: Record<string, unknown>) {
          this.input = input;
        }
      };
    const sdk = {
      BedrockAgentRuntimeClient: class {
        constructor(public config: { region?: string }) {}
        async send(c: { constructor: { cmdName: string }; input: Record<string, unknown> }) {
          sent.push({ cmd: c.constructor.cmdName, input: c.input });
          return c.constructor.cmdName === 'GetAgentMemory' ? getResponse : {};
        }
      },
      GetAgentMemoryCommand: cmd('GetAgentMemory'),
      DeleteAgentMemoryCommand: cmd('DeleteAgentMemory'),
    };
    return { sdk, sent };
  }

  it('readSummaries → GetAgentMemoryCommand with memoryType SESSION_SUMMARY + agent ids', async () => {
    const { sdk, sent } = spySdk({
      memoryContents: [{ sessionSummary: { sessionId: 's1', summaryText: 'hi' } }],
    });
    const mem = new BedrockAgentMemory({
      agentId: 'ag',
      agentAliasId: 'al',
      region: 'us-west-2',
      _sdk: sdk as never,
    });
    const out = await mem.readSummaries('user-42');
    expect(out).toEqual([{ sessionId: 's1', summaryText: 'hi' }]);
    const get = sent.find((s) => s.cmd === 'GetAgentMemory');
    expect(get).toBeDefined();
    expect(get!.input.agentId).toBe('ag');
    expect(get!.input.agentAliasId).toBe('al');
    expect(get!.input.memoryType).toBe('SESSION_SUMMARY');
    expect(get!.input.memoryId).toBe('user-42');
  });

  it('forget → DeleteAgentMemoryCommand', async () => {
    const { sdk, sent } = spySdk({});
    const mem = new BedrockAgentMemory({ agentId: 'ag', agentAliasId: 'al', _sdk: sdk as never });
    await mem.forget('u', 'sess-1');
    const del = sent.find((s) => s.cmd === 'DeleteAgentMemory');
    expect(del).toBeDefined();
    expect(del!.input).toMatchObject({
      agentId: 'ag',
      agentAliasId: 'al',
      memoryId: 'u',
      sessionId: 'sess-1',
    });
  });

  it('throws a clear error when the SDK lacks the client', () => {
    expect(
      () => new BedrockAgentMemory({ agentId: 'a', agentAliasId: 'b', _sdk: {} as never }),
    ).toThrow(/BedrockAgentRuntimeClient/);
  });
});
