import { createRecordGraph } from 'foottrace/cause';
import { expect, it, vi } from 'vitest';

import { Agent, inMemoryArtifacts } from '../../index.js';
import { mock } from '../../llm-providers.js';
import { readLogAddress } from '../../recorders/observability/recordingParts/invocations.js';
import * as savedReader from '../../recorders/observability/recordingParts/open.js';
import type {
  SavedInvocation,
  SavedRecording,
} from '../../recorders/observability/recordingParts/open.js';
import { inProcessHost } from '../../../test/hosting/testHost.js';
import { memorySessions } from '../memorySessions.js';
import { standingAgent } from '../standingAgent.js';
import type { HostedCompletedAgentTurn } from './completedTurn.js';

const unknownChild = { gaps: ['subflow-evidence-unavailable'] };
const { nodeId } = createRecordGraph([]);

async function readFixtureNode(
  saved: SavedRecording,
  turn: HostedCompletedAgentTurn,
  invocation: SavedInvocation,
) {
  const raw = await saved.readInvocation(invocation.key);
  if (raw.status !== 'ready') throw Error('Expected a saved invocation for the fixture');
  const scope = (raw.result as { treeContext?: { logAddress?: unknown; history?: unknown[] } })
    ?.treeContext;
  const address = readLogAddress(scope?.logAddress);
  const last = scope?.history?.at(-1) as { runtimeStageId?: string } | undefined;
  if (!address || !last?.runtimeStageId) throw Error('Expected an addressed saved child');
  return turn.node(nodeId(address, { runtimeStageId: last.runtimeStageId }), address);
}

it.each([true, { layout: 'whole', packed: true }, { layout: 'parts', packed: true }] as const)(
  'opens one admitted saved child through the real host without loading sibling invocations (%j)',
  async (recordings) => {
    const agent = Agent.create({
      provider: mock({ reply: 'Done.' }),
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), recordings },
    }).build();
    const host = inProcessHost();
    const request = { sessionId: 'child-recording', headers: { authorization: 'Bearer fixture' } };
    let completed: HostedCompletedAgentTurn | undefined;
    const door = await standingAgent({
      agent,
      sessions: memorySessions(),
      host,
      identity: { verify: async () => ({ userId: 'child-owner' }) },
      onCompletedTurn: (turn) => {
        completed = turn;
      },
    });
    const open = savedReader.openSavedRecording;
    let original: SavedRecording | undefined;
    let mode: 'complete' | 'incomplete' | 'absent' | 'withheld' | 'changed' = 'complete';
    let selectedKey: string | undefined;
    const invocationsRead = vi.fn<(key: string) => void>();
    const spy = vi.spyOn(savedReader, 'openSavedRecording').mockImplementation(async (...args) => {
      const saved = await open(...args);
      if (saved.status !== 'ready') return saved;
      original = saved;
      return {
        ...saved,
        complete: saved.complete && mode !== 'incomplete' && mode !== 'withheld',
        invocations:
          mode === 'absent'
            ? saved.invocations.filter(({ key }) => key !== selectedKey)
            : saved.invocations,
        async readRoot(options) {
          const root = await saved.readRoot(options);
          if (mode !== 'withheld' || root.status !== 'ready') return root;
          return {
            status: 'ready',
            recording: {
              ...root.recording,
              snapshot: {
                ...root.recording.snapshot,
                subflowEvidenceGap: 'retained-child-evidence-withheld',
              },
            },
          };
        },
        async readInvocation(key, options) {
          invocationsRead(key);
          if (mode === 'changed') return { status: 'unavailable', reason: 'part-changed' };
          return saved.readInvocation(key, options);
        },
      };
    });

    try {
      await host.deliver({ input: 'Evidence', ...request });
      if (!completed) throw Error('Expected completed turn');
      const live = await completed.forRequest(() => request);
      const saved = await completed.forRequest(() => request, 'saved');
      if (!live || !saved) throw Error('Expected both authorized sources');
      const rootNode = completed.node('root-node');
      const root = await agent.why(rootNode, saved);
      expect(root).toEqual(await agent.why(rootNode, live));
      expect(invocationsRead).not.toHaveBeenCalled();

      const fixture = original;
      if (!fixture?.complete) throw Error('Expected structurally complete saved recording');
      const [pick, sibling] = fixture.invocations.filter((item) => item.recorded);
      if (!pick || !sibling) throw Error('Expected at least two native child occurrences');
      selectedKey = pick.key;
      const node = await readFixtureNode(fixture, completed, pick);
      const siblingNode = await readFixtureNode(fixture, completed, sibling);

      const savedReport = await agent.why(node, saved);
      expect(savedReport).toEqual(await agent.why(node, live));
      expect(savedReport).toMatchObject({
        runId: completed.runId,
        gaps: expect.arrayContaining(['cause-incomplete']),
      });
      expect(invocationsRead).toHaveBeenCalledExactlyOnceWith(pick.key);

      invocationsRead.mockClear();
      mode = 'incomplete';
      // The matching index row, root, part and child address are still available.
      expect(await agent.why(node, saved)).toEqual(unknownChild);
      expect(await agent.why(rootNode, saved)).toEqual(root);
      expect(invocationsRead).not.toHaveBeenCalled();

      mode = 'absent';
      const absent = await agent.why(node, saved);
      mode = 'withheld';
      const withheld = await agent.why(node, saved);
      expect(absent).toEqual(unknownChild);
      expect(JSON.stringify(withheld)).toBe(JSON.stringify(absent));
      expect(invocationsRead).not.toHaveBeenCalled();

      mode = 'complete';
      const wrongAncestor = {
        ...node,
        logAddress: {
          ...node.logAddress,
          drillPath: ['unrelated#0', ...node.logAddress.drillPath],
        },
      };
      expect(await agent.why(wrongAncestor, saved)).toEqual(unknownChild);
      expect(invocationsRead).not.toHaveBeenCalled();

      mode = 'changed';
      expect(await agent.why(node, saved)).toEqual(unknownChild);
      expect(invocationsRead).toHaveBeenCalledExactlyOnceWith(pick.key);

      invocationsRead.mockClear();
      mode = 'complete';
      expect(await agent.why(siblingNode, saved)).toEqual(await agent.why(siblingNode, live));
      expect(invocationsRead).toHaveBeenCalledExactlyOnceWith(sibling.key);
    } finally {
      spy.mockRestore();
      await door.close();
    }
  },
);
