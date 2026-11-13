import type { At, ItemOf, PayloadOf } from '../vocabulary.js';
import type { TryInsteadToolPayload } from '../../../../events/payloads.js';
import { bool, charsMarker, listOf, num, oneOf, shapeOf, str } from '../../auditBounding.js';
import {
  boundComposition,
  boundCoverageItem,
  boundInProgressItem,
  boundPeriod,
  boundProvenance,
} from '../pieces/coverage.js';
import { boundScriptsVerdict } from '../pieces/scripts.js';
import { boundSemantics } from '../pieces/semantics.js';
import { boundWitness } from '../pieces/decisions.js';
import { eventShape } from '../vocabulary.js';
import { seenToolName } from '../../auditKeptByContract.js';

export function contentShapes(toolRan: (name: string) => boolean) {
  return {
    // ── The seven a tool, the model or the person writes into ──────────
    'agentfootprint.tools.absent': eventShape<'agentfootprint.tools.absent'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      lookedFor: charsMarker,
      checked: listOf(boundCoverageItem),
      notChecked: listOf(boundCoverageItem),
      cannotCover: listOf(boundCoverageItem),
      tryInstead: charsMarker,
      tryInsteadTool: shapeOf<TryInsteadToolPayload>({
        tool: seenToolName(toolRan),
        why: charsMarker,
      }),
      provenance: boundProvenance,
      period: boundPeriod,
      composition: boundComposition,
      lookedForRef: shapeOf<At<PayloadOf<'agentfootprint.tools.absent'>, 'lookedForRef'>>({
        resultId: str,
        field: oneOf('lookedFor'),
      }),
    }),

    'agentfootprint.tools.coverage_declared': eventShape<'agentfootprint.tools.coverage_declared'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      checked: listOf(boundCoverageItem),
      notChecked: listOf(boundCoverageItem),
      cannotCover: listOf(boundCoverageItem),
      period: boundPeriod,
      inProgress: listOf(boundInProgressItem),
      composition: boundComposition,
    }),

    'agentfootprint.tools.semantics_declared':
      eventShape<'agentfootprint.tools.semantics_declared'>({
        toolName: str,
        toolCallId: str,
        iteration: num,
        semantics: boundSemantics,
      }),

    'agentfootprint.agent.evidence_checked': eventShape<'agentfootprint.agent.evidence_checked'>({
      iteration: num,
      posture: oneOf('assist', 'guard', 'rails'),
      candidates: num,
      lookedUp: num,
      unsupported: listOf(
        shapeOf<ItemOf<PayloadOf<'agentfootprint.agent.evidence_checked'>['unsupported']>>({
          value: charsMarker,
          shape: str,
          region: oneOf('prose', 'code'),
        }),
      ),
      action: oneOf('flagged', 'grounded', 'refused', 'revision-asked'),
      afterRevision: bool,
      evidenceTruncated: bool,
      carriedBy: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.evidence_checked'>, 'carriedBy'>>>({
          toolCallId: str,
          values: num,
          only: num,
        }),
      ),
      stagedRefs: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.agent.evidence_checked'>, 'stagedRefs'>>>({
          ref: str,
          kind: str,
        }),
      ),
      spenderTools: listOf(str),
      // `from` names the operands — and a unit-scaled figure's source value.
      computed: listOf(
        shapeOf<
          ItemOf<NonNullable<PayloadOf<'agentfootprint.agent.evidence_checked'>['computed']>>
        >({
          value: charsMarker,
          shape: str,
          derivation: str,
          from: charsMarker,
        }),
      ),
      scripts: boundScriptsVerdict,
    }),

    'agentfootprint.integrity.external_ground_used':
      eventShape<'agentfootprint.integrity.external_ground_used'>({
        toolName: str,
        toolCallId: str,
        path: str,
        value: charsMarker,
        source: str,
        iteration: num,
      }),

    'agentfootprint.map.engaged': eventShape<'agentfootprint.map.engaged'>({
      mapId: str,
      iteration: num,
      by: oneOf('assumed', 'explicit', 'lexical', 'semantic', 'structural'),
      witness: charsMarker,
      reengaged: bool,
      upgraded: bool,
      foundedBy: oneOf('assumed', 'explicit', 'lexical', 'semantic', 'structural'),
      tenantChanged: bool,
      at: str,
    }),

    'agentfootprint.skill.turn_routed': eventShape<'agentfootprint.skill.turn_routed'>({
      by: oneOf('continuity', 'decider', 'entry', 'intent', 'menu', 'none'),
      from: str,
      to: str,
      scorer: str,
      scores: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'scores'>>>({
          id: str,
          score: num,
          relevance: num,
        }),
      ),
      runnerUp: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'runnerUp'>>({
        id: str,
        gap: num,
      }),
      decisive: bool,
      witness: boundWitness,
      offered: listOf(str),
      stayOffered: bool,
      policy: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'policy'>>({
        nearTieMargin: num,
        menuSize: num,
        floor: num,
      }),
      window: num,
      droppedResume: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'droppedResume'>>({
        id: str,
        reason: oneOf('unknown-skill'),
      }),
      decider: shapeOf<At<PayloadOf<'agentfootprint.skill.turn_routed'>, 'decider'>>({
        provider: str,
        model: str,
        picked: str,
      }),
    }),
  };
}
