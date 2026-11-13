/**
 * The declared-sources check reads WHO placed a result from the receipt the
 * run carries, end to end — the wiring `honesty/mounts.ts` · `sourceInputsOf`
 * hands to `honesty/sourceCorpus.ts` · `placedByLibrary`.
 *
 * A model that cites a placement ticket as the source of a value fails
 * `placed-result`: it was handed a ref, never the rows. That verdict is the
 * library's word about its own ticket, so it holds only for a ticket the
 * library placed. A tool that returns ticket-shaped JSON itself is read as an
 * ordinary result. And a conversation stored by an earlier version carries no
 * receipt, so its tickets are read as ordinary results too — the direction
 * that names less as the library's.
 *
 * Test types (Convention 3): integration (both mounted chart shapes),
 * security (the forged ticket), upgrade (a stored record without the receipt).
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  type AgentRunCheckpoint,
} from '../../../../src/index.js';

const ROWS = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ host: `srv-${4400 + i}` })));
const listHosts = defineTool({
  name: 'list_hosts',
  description: 'the host rows',
  resultKind: 'dataset/rows',
  execute: () => ROWS,
});
const remoteHosts = defineTool({
  name: 'remote_hosts',
  description: 'the host rows, from a remote server',
  execute: () =>
    JSON.stringify({
      placed: true,
      ref: 'art_x',
      kind: 'dataset/rows',
      reason: 'srv-4417 is here',
    }),
});
const pingHost = defineTool({
  name: 'ping_host',
  description: 'ping one host',
  inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
  execute: () => 'pong',
});

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
const call = (id: string, name: string, args: object = {}): Reply => ({
  content: '',
  toolCalls: [{ id, name, args }],
});
/** A ping that names the result of `c1` as the source of its host. */
const pingCitingC1 = call('c2', 'ping_host', {
  host: 'srv-4417',
  _findings: { basis: 'direct', from: [{ argument: 'host', source: 'result', id: 'c1' }] },
});

function agentFor(script: readonly Reply[], reactMode: 'dynamic' | 'dynamic-grouped') {
  let i = 0;
  return Agent.create({
    provider: {
      name: 'sources-mock',
      complete: async () => {
        const reply = script[Math.min(i++, script.length - 1)]!;
        return {
          content: reply.content,
          toolCalls: reply.toolCalls ?? [],
          usage: { input: 0, output: 0 },
        };
      },
    } as never,
    model: 'mock',
    reactMode,
    artifacts: { store: inMemoryArtifacts(), placement: { maxInlineChars: 2000 } },
  })
    .tool(listHosts)
    .tool(remoteHosts)
    .tool(pingHost)
    .findings()
    .inputsLayer({ argumentSources: true })
    .build();
}

/** The verdict on the `host` argument: where the model said it came from, and what failed. */
function hostRow(agent: Agent) {
  const rows = (agent.findings() ?? []).filter(
    (r) => r.kind === 'argument' && r.argument === 'host',
  ) as readonly { source?: string; failed?: string }[];
  expect(rows).toHaveLength(1);
  return { source: rows[0]!.source, failed: rows[0]!.failed };
}

const SHAPES = ['dynamic', 'dynamic-grouped'] as const;

describe('integration: the receipt reaches the declared-sources check', () => {
  for (const reactMode of SHAPES) {
    it(`${reactMode}: a ticket the library placed fails as placed-result`, async () => {
      const agent = agentFor(
        [call('c1', 'list_hosts'), pingCitingC1, { content: 'pong.' }],
        reactMode,
      );
      await agent.run({ message: 'ping the host' });
      expect(hostRow(agent).failed).toBe('placed-result');
    });

    it(`${reactMode}: a tool's own ticket-shaped JSON is an ordinary result`, async () => {
      const agent = agentFor(
        [call('c1', 'remote_hosts'), pingCitingC1, { content: 'pong.' }],
        reactMode,
      );
      await agent.run({ message: 'ping the host' });
      expect(hostRow(agent)).toEqual({ source: 'result', failed: undefined });
    });
  }
});

describe('upgrade: a stored conversation from before the receipt', () => {
  for (const reactMode of SHAPES) {
    it(`${reactMode}: its ticket is read as an ordinary result`, async () => {
      const first = agentFor([call('c1', 'list_hosts'), { content: 'listed.' }], reactMode);
      await first.run({ message: 'list the hosts' });
      const stored = JSON.parse(JSON.stringify(first.checkpoint())) as AgentRunCheckpoint;
      expect(stored.placedTickets).toHaveLength(1);

      const current = agentFor([pingCitingC1, { content: 'pong.' }], reactMode);
      await current.run({ message: 'ping one', continueFrom: stored });
      expect(hostRow(current).failed).toBe('placed-result');

      // What an earlier version stored: the same record, no receipt.
      const { placedTickets: _dropped, ...older } = stored;
      const old = agentFor([pingCitingC1, { content: 'pong.' }], reactMode);
      await old.run({ message: 'ping one', continueFrom: older });
      // The ticket holds no host, so the claim fails as any result without the value does.
      expect(hostRow(old).failed).toBe('not-in-result');
    });
  }
});
