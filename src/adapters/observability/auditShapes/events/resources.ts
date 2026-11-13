import { appReasonWord } from '../../auditKeptByContract.js';
import {
  bool,
  charsMarker,
  keysMarker,
  listOf,
  num,
  oneOf,
  recordOf,
  str,
} from '../../auditBounding.js';
import { boundRequestAttempt, boundRequestEnd } from '../pieces/requests.js';
import { eventShape } from '../vocabulary.js';

export function resourcesShapes() {
  return {
    'agentfootprint.memory.strategy_applied': eventShape<'agentfootprint.memory.strategy_applied'>({
      strategyId: str,
      strategyKind: oneOf('fact-extraction', 'hybrid', 'semantic', 'sliding-window', 'summarizing'),
      reason: str,
      scoreEvidence: keysMarker,
      inputMemoryCount: num,
      outputMemoryCount: num,
      droppedIds: listOf(str),
      addedIds: listOf(str),
    }),

    'agentfootprint.memory.attached': eventShape<'agentfootprint.memory.attached'>({
      memoryId: str,
      contentSummary: charsMarker,
      score: num,
      rank: num,
      source: oneOf('auto-extract', 'manual', 'store'),
      retriever: oneOf('chroma', 'custom', 'pinecone', 'qdrant', 'weaviate'),
    }),

    'agentfootprint.memory.detached': eventShape<'agentfootprint.memory.detached'>({
      memoryId: str,
      reason: oneOf('budget', 'policy', 'score_low', 'stale'),
    }),

    'agentfootprint.memory.written': eventShape<'agentfootprint.memory.written'>({
      memoryId: str,
      contentSummary: charsMarker,
      source: oneOf('auto', 'manual'),
      actor: str,
    }),

    'agentfootprint.tools.offered': eventShape<'agentfootprint.tools.offered'>({
      availableIds: listOf(str),
      withheldIds: listOf(str),
      withheldReasons: recordOf(oneOf('cost_guard', 'gated', 'permission', 'skill_inactive')),
      reason: appReasonWord,
    }),

    'agentfootprint.tools.activated': eventShape<'agentfootprint.tools.activated'>({
      toolId: str,
      reason: oneOf('autoActivate', 'permission_granted', 'skill_activated'),
      source: str,
    }),

    'agentfootprint.tools.deactivated': eventShape<'agentfootprint.tools.deactivated'>({
      toolId: str,
      reason: oneOf('permission_revoked', 'skill_deactivated'),
    }),

    'agentfootprint.tools.discovery_started': eventShape<'agentfootprint.tools.discovery_started'>({
      providerId: str,
      iteration: num,
    }),

    'agentfootprint.tools.discovery_completed':
      eventShape<'agentfootprint.tools.discovery_completed'>({
        providerId: str,
        iteration: num,
        durationMs: num,
        toolCount: num,
      }),

    'agentfootprint.tools.discovery_failed': eventShape<'agentfootprint.tools.discovery_failed'>({
      providerId: str,
      error: charsMarker,
      errorName: str,
      iteration: num,
      durationMs: num,
    }),

    'agentfootprint.tools.shadowed': eventShape<'agentfootprint.tools.shadowed'>({
      toolName: str,
      iteration: num,
      schemaFrom: oneOf('framework', 'provider', 'registry', 'skill'),
      schemaFromId: str,
      dispatchTo: oneOf('framework', 'provider', 'registry', 'skill'),
      dispatchToId: str,
    }),

    'agentfootprint.tools.claim_swallowed': eventShape<'agentfootprint.tools.claim_swallowed'>({
      toolName: str,
      iteration: num,
      lostBy: oneOf('framework', 'provider', 'registry', 'skill'),
      lostById: str,
      wonBy: oneOf('framework', 'provider', 'registry', 'skill'),
      wonById: str,
    }),

    'agentfootprint.tools.answered_off_wire': eventShape<'agentfootprint.tools.answered_off_wire'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      answeredBy: oneOf('framework', 'provider', 'registry', 'skill'),
      answeredById: str,
    }),

    'agentfootprint.tools.resource_restore': eventShape<'agentfootprint.tools.resource_restore'>({
      local: oneOf('retained', 'none-known-locally', 'unconfirmed'),
      remote: oneOf('unknown'),
    }),

    'agentfootprint.tools.session_started': eventShape<'agentfootprint.tools.session_started'>({
      tool: str,
      scope: oneOf('call', 'run', 'session', 'shutdown'),
      keyHash: str,
      runnerId: str,
      label: str,
    }),

    'agentfootprint.tools.session_reused': eventShape<'agentfootprint.tools.session_reused'>({
      calls: num,
      tool: str,
      scope: oneOf('call', 'run', 'session', 'shutdown'),
      keyHash: str,
      runnerId: str,
      label: str,
    }),

    'agentfootprint.tools.session_closed': eventShape<'agentfootprint.tools.session_closed'>({
      reason: oneOf('call-end', 'evicted', 'idle', 'run-end', 'session-end', 'shutdown'),
      durationMs: num,
      tool: str,
      scope: oneOf('call', 'run', 'session', 'shutdown'),
      keyHash: str,
      runnerId: str,
      label: str,
    }),

    'agentfootprint.tools.result_refused': eventShape<'agentfootprint.tools.result_refused'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      sizeChars: num,
      maxChars: num,
      narrowBy: listOf(str),
      declaredStatus: oneOf(
        'absent',
        'denied',
        'failure',
        'invalid',
        'partial',
        'pending',
        'success',
      ),
    }),

    'agentfootprint.tools.repeated_call': eventShape<'agentfootprint.tools.repeated_call'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      occurrences: num,
      argsFingerprint: str,
      resultFingerprint: str,
      mode: oneOf('arguments'),
    }),

    'agentfootprint.tools.code_run': eventShape<'agentfootprint.tools.code_run'>({
      tool: str,
      language: str,
      stagedInputs: num,
      outputChars: num,
      truncated: bool,
      ok: bool,
      exitCode: num,
      serviceError: bool,
      terminatedBy: str,
      shapeHash: str,
    }),

    // An MCP pool's use: ids, digests, evidence and outcomes; never a value or a server's text.
    'agentfootprint.tools.mcp_client': eventShape<'agentfootprint.tools.mcp_client'>({
      server: str,
      at: oneOf('call', 'list'),
      toolCallId: str,
      keyHash: str,
      clientId: str,
      generation: num,
      client: oneOf(
        'expired',
        'handle-lost',
        'joined',
        'not-needed',
        'opened',
        'refused',
        'reused',
      ),
      previous: oneOf('evicted', 'expired', 'handle-lost', 'idle', 'terminated'),
      evidence: oneOf('server-404', 'transport-forgot-handle'),
      refusal: oneOf(
        'binding-changed',
        'closed',
        'ending-full',
        'identity-mismatch',
        'incomplete-identity',
        'init-failed',
        'init-timeout',
        'lease-expired',
        'no-identity',
        'operations-full',
        'pool-full',
        'principal-full',
        'request-unmatched',
        'stale-tools',
      ),
      initMs: num,
      definitions: oneOf('listed', 'shared'),
      definitionsAgeMs: num,
      revalidated: oneOf('kept', 'refused'),
    }),

    'agentfootprint.tools.request_attempts': eventShape<'agentfootprint.tools.request_attempts'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      endpoint: str,
      origin: str,
      attempts: listOf(boundRequestAttempt),
      omitted: num,
      end: boundRequestEnd,
    }),

    'agentfootprint.tools.session_close_failed':
      eventShape<'agentfootprint.tools.session_close_failed'>({
        reason: oneOf('call-end', 'evicted', 'idle', 'run-end', 'session-end', 'shutdown'),
        durationMs: num,
        error: charsMarker,
        errorClass: str,
        tool: str,
        scope: oneOf('call', 'run', 'session', 'shutdown'),
        keyHash: str,
        runnerId: str,
        label: str,
      }),
  };
}
