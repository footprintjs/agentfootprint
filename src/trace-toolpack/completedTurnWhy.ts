import type { TraversedEdge } from 'foottrace/cause';

import {
  type CompletedAgentTurn,
  type CompletedTurnNode,
  readCompletedTurn,
} from '../core/agent/turnEvidence/completedTurnHandle.js';
import { boundTurnEvidence } from '../core/agent/turnEvidence/completedTurnBudget.js';
import { captureOwn } from './causeCapture.js';
import { causeLimits } from './causeLimits.js';
import { projectCauseBasis } from './causeProjection.js';
import { readCauseOfNode } from './causeReader.js';
import { indexCauseStages } from './storedCauseProjection.js';

const limits = causeLimits({
  includeBackward: true,
  impact: { maxNodes: 1, maxDepth: 0, maxEdges: 1, maxCalls: 1 },
});

/** Read backward evidence only from the Agent turn held by a host-issued handle. */
export async function explainCompletedTurn(
  owner: object,
  node: CompletedTurnNode,
  handle: CompletedAgentTurn | undefined,
) {
  if (node === undefined || typeof node.id !== 'string' || node.id.length === 0)
    return { gaps: ['turn-unavailable'] };
  const admitted = await readCompletedTurn(owner, handle, node);
  if (admitted.status !== 'ready') return { gaps: [admitted.status] };
  const { snapshot, terminal } = admitted.turn;
  const runId = terminal.meta.runId;
  const missingChannels = ['unchanged-writes-not-collected', 'skipped-writers-not-collected'];
  const unavailable = (reason: string) =>
    boundTurnEvidence({ runId, facts: [], gaps: [reason, ...missingChannels] });
  const deadline = performance.now() + limits.timeoutMs;
  try {
    const { nodes } = indexCauseStages(captureOwn(snapshot, 'executionTree'));
    const basis = projectCauseBasis(snapshot, nodes);
    if (basis === undefined) return unavailable('cause-not-collected');
    if (basis === 'truncated') return unavailable('cause-truncated');

    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) return unavailable('cause-timeout');
    const finding = await readCauseOfNode(basis.graph, node.id, limits, remaining);
    const backward = finding.backward;
    const facts =
      backward?.edges.map(({ from, to, kind, attribution, evidence }: TraversedEdge) => ({
        from,
        to,
        kind,
        attribution,
        evidence,
      })) ?? [];
    const gaps = new Set((backward?.gaps ?? finding.gaps).map(({ code }) => String(code)));
    if (
      backward === undefined ||
      backward.confidence === 'incomplete' ||
      basis.capture.status !== 'admitted'
    )
      gaps.add('cause-incomplete');
    return boundTurnEvidence({ runId, facts, gaps: [...gaps, ...missingChannels] });
  } catch {
    return unavailable('cause-not-collected');
  }
}
