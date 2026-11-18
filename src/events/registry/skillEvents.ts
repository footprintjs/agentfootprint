/** Typed contracts for events about skills and their procedure steps. */
import type { AgentfootprintEventEnvelope } from '../types.js';
import type {
  SkillActivatedPayload,
  SkillDeactivatedPayload,
  SkillEscalatedPayload,
  SkillGraphDeclaredPayload,
  SkillRejectedPayload,
  SkillRerouteSupersededPayload,
  SkillRouteConflictPayload,
  SkillStepAdvancedPayload,
  SkillStepHeldPayload,
  SkillStepSkippedPayload,
  SkillStepsUnfinishedPayload,
  SkillTurnRoutedPayload,
} from '../payloads.js';

export interface SkillEventMap {
  'agentfootprint.skill.activated': AgentfootprintEventEnvelope<
    'agentfootprint.skill.activated',
    SkillActivatedPayload
  >;
  'agentfootprint.skill.graph_declared': AgentfootprintEventEnvelope<
    'agentfootprint.skill.graph_declared',
    SkillGraphDeclaredPayload
  >;
  'agentfootprint.skill.deactivated': AgentfootprintEventEnvelope<
    'agentfootprint.skill.deactivated',
    SkillDeactivatedPayload
  >;
  'agentfootprint.skill.rejected': AgentfootprintEventEnvelope<
    'agentfootprint.skill.rejected',
    SkillRejectedPayload
  >;
  'agentfootprint.skill.reroute_superseded': AgentfootprintEventEnvelope<
    'agentfootprint.skill.reroute_superseded',
    SkillRerouteSupersededPayload
  >;
  'agentfootprint.skill.route_conflict': AgentfootprintEventEnvelope<
    'agentfootprint.skill.route_conflict',
    SkillRouteConflictPayload
  >;
  'agentfootprint.skill.turn_routed': AgentfootprintEventEnvelope<
    'agentfootprint.skill.turn_routed',
    SkillTurnRoutedPayload
  >;
  'agentfootprint.skill.step_advanced': AgentfootprintEventEnvelope<
    'agentfootprint.skill.step_advanced',
    SkillStepAdvancedPayload
  >;
  'agentfootprint.skill.step_held': AgentfootprintEventEnvelope<
    'agentfootprint.skill.step_held',
    SkillStepHeldPayload
  >;
  'agentfootprint.skill.step_skipped': AgentfootprintEventEnvelope<
    'agentfootprint.skill.step_skipped',
    SkillStepSkippedPayload
  >;
  'agentfootprint.skill.steps_unfinished': AgentfootprintEventEnvelope<
    'agentfootprint.skill.steps_unfinished',
    SkillStepsUnfinishedPayload
  >;
  'agentfootprint.skill.escalated': AgentfootprintEventEnvelope<
    'agentfootprint.skill.escalated',
    SkillEscalatedPayload
  >;
}
