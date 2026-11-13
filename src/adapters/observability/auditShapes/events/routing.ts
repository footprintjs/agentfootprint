import type { At, ItemOf, PayloadOf } from '../vocabulary.js';
import { appReasonWord, declaredValue } from '../../auditKeptByContract.js';
import { bool, listOf, nullOr, num, oneOf, orList, shapeOf, str } from '../../auditBounding.js';
import { eventShape } from '../vocabulary.js';

export function routingShapes() {
  return {
    'agentfootprint.skill.activated': eventShape<'agentfootprint.skill.activated'>({
      skillId: str,
      reason: oneOf('autoActivate', 'manual', 'read_skill_result'),
      injectedTools: listOf(str),
      injectedSystemPromptChars: num,
    }),

    'agentfootprint.skill.graph_declared': eventShape<'agentfootprint.skill.graph_declared'>({
      nodes: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'nodes'>>>({
          id: str,
          kind: str,
          description: str,
          label: str,
          title: str,
        }),
      ),
      edges: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'edges'>>>({
          from: nullOr(str),
          to: str,
          kind: str,
          label: str,
          guard: shapeOf<
            At<ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'edges'>>, 'guard'>
          >({
            conditions: listOf(
              shapeOf<
                ItemOf<
                  At<
                    At<
                      ItemOf<At<PayloadOf<'agentfootprint.skill.graph_declared'>, 'edges'>>,
                      'guard'
                    >,
                    'conditions'
                  >
                >
              >({
                key: str,
                op: str,
                // The value the app declared to compare against: one, or a list.
                value: orList(declaredValue),
              }),
            ),
          }),
        }),
      ),
    }),

    'agentfootprint.skill.deactivated': eventShape<'agentfootprint.skill.deactivated'>({
      skillId: str,
      reason: appReasonWord,
    }),

    'agentfootprint.skill.rejected': eventShape<'agentfootprint.skill.rejected'>({
      requestedId: str,
      currentSkillId: str,
      allowed: listOf(str),
      iteration: num,
      posture: oneOf('guard', 'rails'),
      reason: oneOf('posture', 'self-call', 'unreachable'),
    }),

    'agentfootprint.skill.reroute_superseded':
      eventShape<'agentfootprint.skill.reroute_superseded'>({
        volunteeredId: str,
        wonId: str,
        fromSkillId: str,
        iteration: num,
        source: oneOf('tool-proposal'),
      }),

    'agentfootprint.skill.route_conflict': eventShape<'agentfootprint.skill.route_conflict'>({
      iteration: num,
      fromSkillId: str,
      winner: shapeOf<At<PayloadOf<'agentfootprint.skill.route_conflict'>, 'winner'>>({
        toolCallId: str,
        toolName: str,
        target: str,
      }),
      losers: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.route_conflict'>, 'losers'>>>({
          toolCallId: str,
          toolName: str,
          target: str,
        }),
      ),
      source: oneOf('tool-proposal'),
    }),

    'agentfootprint.skill.step_advanced': eventShape<'agentfootprint.skill.step_advanced'>({
      skillId: str,
      step: shapeOf<At<PayloadOf<'agentfootprint.skill.step_advanced'>, 'step'>>({
        index: num,
        total: num,
        tool: str,
        note: str,
      }),
      iteration: num,
      toolCallId: str,
      completed: bool,
    }),

    'agentfootprint.skill.steps_unfinished': eventShape<'agentfootprint.skill.steps_unfinished'>({
      skillId: str,
      remaining: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.skill.steps_unfinished'>, 'remaining'>>>({
          index: num,
          tool: str,
          note: str,
        }),
      ),
      total: num,
      action: oneOf('accepted', 'cut-short', 'nudged'),
      iteration: num,
    }),

    'agentfootprint.skill.escalated': eventShape<'agentfootprint.skill.escalated'>({
      iteration: num,
      afterRefusals: num,
      refusals: num,
      from: shapeOf<At<PayloadOf<'agentfootprint.skill.escalated'>, 'from'>>({
        provider: str,
        model: str,
      }),
      to: shapeOf<At<PayloadOf<'agentfootprint.skill.escalated'>, 'to'>>({
        provider: str,
        model: str,
      }),
    }),

    'agentfootprint.permission.gate_opened': eventShape<'agentfootprint.permission.gate_opened'>({
      gateId: str,
      openedBy: str,
      expiresAt: num,
    }),

    'agentfootprint.permission.gate_closed': eventShape<'agentfootprint.permission.gate_closed'>({
      gateId: str,
      reason: appReasonWord,
    }),

    'agentfootprint.credential.requested': eventShape<'agentfootprint.credential.requested'>({
      service: str,
      mode: oneOf('machine', 'user'),
      toolCallId: str,
      iteration: num,
    }),

    'agentfootprint.credential.acquired': eventShape<'agentfootprint.credential.acquired'>({
      service: str,
      kind: str,
      expiresAt: num,
      toolCallId: str,
      iteration: num,
    }),

    'agentfootprint.credential.authorization_required':
      eventShape<'agentfootprint.credential.authorization_required'>({
        service: str,
        sessionId: str,
        toolCallId: str,
        iteration: num,
      }),
  };
}
