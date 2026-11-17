/** Type-only tools-domain event vocabulary; the public registry inherits every key. */
import type { AgentfootprintEventEnvelope } from '../types.js';
import type {
  ToolAbsentPayload,
  ToolCoverageDeclaredPayload,
  ToolSemanticsDeclaredPayload,
  ToolsCodeRunPayload,
  ToolsRequestAttemptsPayload,
  ToolsMcpClientPayload,
  ToolEffectPayload,
  ToolRepeatedCallPayload,
  ToolResultRefusedPayload,
  ToolRowsetCheckedPayload,
  ToolsActivatedPayload,
  ToolsDeactivatedPayload,
  ToolsDiscoveryStartedPayload,
  ToolsDiscoveryCompletedPayload,
  ToolsDiscoveryFailedPayload,
  ToolsShadowedPayload,
  ToolsClaimSwallowedPayload,
  ToolsAnsweredOffWirePayload,
  ToolsSessionStartedPayload,
  ToolsSessionReusedPayload,
  ToolsSessionClosedPayload,
  ToolsSessionCloseFailedPayload,
  ToolsOfferedPayload,
} from '../payloads.js';

export interface ToolEventMap {
  // tools
  'agentfootprint.tools.offered': AgentfootprintEventEnvelope<
    'agentfootprint.tools.offered',
    ToolsOfferedPayload
  >;
  'agentfootprint.tools.activated': AgentfootprintEventEnvelope<
    'agentfootprint.tools.activated',
    ToolsActivatedPayload
  >;
  'agentfootprint.tools.deactivated': AgentfootprintEventEnvelope<
    'agentfootprint.tools.deactivated',
    ToolsDeactivatedPayload
  >;
  'agentfootprint.tools.discovery_started': AgentfootprintEventEnvelope<
    'agentfootprint.tools.discovery_started',
    ToolsDiscoveryStartedPayload
  >;
  'agentfootprint.tools.discovery_completed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.discovery_completed',
    ToolsDiscoveryCompletedPayload
  >;
  'agentfootprint.tools.discovery_failed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.discovery_failed',
    ToolsDiscoveryFailedPayload
  >;
  'agentfootprint.tools.shadowed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.shadowed',
    ToolsShadowedPayload
  >;
  'agentfootprint.tools.claim_swallowed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.claim_swallowed',
    ToolsClaimSwallowedPayload
  >;
  'agentfootprint.tools.answered_off_wire': AgentfootprintEventEnvelope<
    'agentfootprint.tools.answered_off_wire',
    ToolsAnsweredOffWirePayload
  >;
  'agentfootprint.tools.resource_restore': AgentfootprintEventEnvelope<
    'agentfootprint.tools.resource_restore',
    {
      readonly local: 'retained' | 'none-known-locally' | 'unconfirmed';
      readonly remote: 'unknown';
    }
  >;
  'agentfootprint.tools.session_started': AgentfootprintEventEnvelope<
    'agentfootprint.tools.session_started',
    ToolsSessionStartedPayload
  >;
  'agentfootprint.tools.session_reused': AgentfootprintEventEnvelope<
    'agentfootprint.tools.session_reused',
    ToolsSessionReusedPayload
  >;
  'agentfootprint.tools.session_closed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.session_closed',
    ToolsSessionClosedPayload
  >;
  'agentfootprint.tools.effect': AgentfootprintEventEnvelope<
    'agentfootprint.tools.effect',
    ToolEffectPayload
  >;
  'agentfootprint.tools.result_refused': AgentfootprintEventEnvelope<
    'agentfootprint.tools.result_refused',
    ToolResultRefusedPayload
  >;
  'agentfootprint.tools.rowset_checked': AgentfootprintEventEnvelope<
    'agentfootprint.tools.rowset_checked',
    ToolRowsetCheckedPayload
  >;
  'agentfootprint.tools.repeated_call': AgentfootprintEventEnvelope<
    'agentfootprint.tools.repeated_call',
    ToolRepeatedCallPayload
  >;
  'agentfootprint.tools.absent': AgentfootprintEventEnvelope<
    'agentfootprint.tools.absent',
    ToolAbsentPayload
  >;
  'agentfootprint.tools.code_run': AgentfootprintEventEnvelope<
    'agentfootprint.tools.code_run',
    ToolsCodeRunPayload
  >;
  'agentfootprint.tools.request_attempts': AgentfootprintEventEnvelope<
    'agentfootprint.tools.request_attempts',
    ToolsRequestAttemptsPayload
  >;
  'agentfootprint.tools.mcp_client': AgentfootprintEventEnvelope<
    'agentfootprint.tools.mcp_client',
    ToolsMcpClientPayload
  >;
  'agentfootprint.tools.coverage_declared': AgentfootprintEventEnvelope<
    'agentfootprint.tools.coverage_declared',
    ToolCoverageDeclaredPayload
  >;
  'agentfootprint.tools.semantics_declared': AgentfootprintEventEnvelope<
    'agentfootprint.tools.semantics_declared',
    ToolSemanticsDeclaredPayload
  >;
  'agentfootprint.tools.session_close_failed': AgentfootprintEventEnvelope<
    'agentfootprint.tools.session_close_failed',
    ToolsSessionCloseFailedPayload
  >;
}
