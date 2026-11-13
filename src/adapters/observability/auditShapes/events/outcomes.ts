import type { At, ItemOf, PayloadOf } from '../vocabulary.js';
import {
  bool,
  charsMarker,
  keysMarker,
  listOf,
  num,
  oneOf,
  shapeOf,
  str,
} from '../../auditBounding.js';
import { boundAssessmentChecks, boundAssessmentReasons } from '../pieces/decisions.js';
import { eventShape } from '../vocabulary.js';

export function outcomesShapes() {
  return {
    'agentfootprint.cost.tick': eventShape<'agentfootprint.cost.tick'>({
      scope: oneOf('iteration', 'run', 'turn'),
      model: str,
      provider: str,
      tokensInput: num,
      tokensOutput: num,
      estimatedUsd: num,
      cumulative: shapeOf<PayloadOf<'agentfootprint.cost.tick'>['cumulative']>({
        tokensInput: num,
        tokensOutput: num,
        estimatedUsd: num,
      }),
    }),

    'agentfootprint.cost.limit_hit': eventShape<'agentfootprint.cost.limit_hit'>({
      kind: oneOf('max_cost', 'max_iterations', 'max_tokens', 'max_wallclock'),
      limit: num,
      actual: num,
      action: oneOf('abort', 'degrade', 'warn'),
    }),

    'agentfootprint.eval.score': eventShape<'agentfootprint.eval.score'>({
      metricId: str,
      value: num,
      threshold: num,
      target: oneOf('iteration', 'run', 'toolCall', 'turn'),
      targetRef: str,
      evaluator: oneOf('fn', 'heuristic', 'llm'),
      evidence: keysMarker,
      label: str,
      explanation: charsMarker,
    }),

    'agentfootprint.eval.threshold_crossed': eventShape<'agentfootprint.eval.threshold_crossed'>({
      metricId: str,
      direction: oneOf('above', 'below'),
      value: num,
      threshold: num,
      actionTaken: str,
    }),

    'agentfootprint.error.retried': eventShape<'agentfootprint.error.retried'>({
      attempt: num,
      maxAttempts: num,
      lastError: charsMarker,
      backoffMs: num,
      reason: str,
      statedWaitMs: num,
    }),

    'agentfootprint.error.recovered': eventShape<'agentfootprint.error.recovered'>({
      attempt: num,
      totalDurationMs: num,
    }),

    'agentfootprint.error.fatal': eventShape<'agentfootprint.error.fatal'>({
      error: charsMarker,
      stage: str,
      scope: str,
    }),

    'agentfootprint.error.circuit_changed': eventShape<'agentfootprint.error.circuit_changed'>({
      state: oneOf('closed', 'half-open', 'open'),
      reason: str,
      providerName: str,
    }),

    'agentfootprint.reliability.retried': eventShape<'agentfootprint.reliability.retried'>({
      attempt: num,
      action: oneOf('retry', 'retry-other'),
      errorKind: str,
      errorMessage: charsMarker,
      fromProvider: str,
      toProvider: str,
    }),

    'agentfootprint.reliability.recovered': eventShape<'agentfootprint.reliability.recovered'>({
      attempt: num,
      recoveredVia: oneOf('fallback', 'retry', 'retry-other'),
      priorFailures: num,
      errorKind: str,
    }),

    'agentfootprint.pause.resume': eventShape<'agentfootprint.pause.resume'>({
      resumeInput: keysMarker,
      pausedDurationMs: num,
      componentId: str,
    }),

    'agentfootprint.findings.declared': eventShape<'agentfootprint.findings.declared'>({
      toolName: str,
      toolCallId: str,
      iteration: num,
      basis: oneOf('direct', 'exploratory'),
      expect: oneOf('high', 'low', 'medium'),
      hasProposition: bool,
      malformed: num,
    }),

    'agentfootprint.findings.standing': eventShape<'agentfootprint.findings.standing'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      standing: oneOf('fact', 'noise', 'open', 'ruled-out'),
      declaredOn: oneOf('answer', 'tool-call'),
      assertionCount: num,
      conflictKeys: listOf(str),
      unknownId: bool,
      agrees: bool,
    }),

    'agentfootprint.findings.judged': eventShape<'agentfootprint.findings.judged'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      against: oneOf('proposition', 'question'),
      standing: oneOf('fact', 'noise', 'open', 'ruled-out'),
      confidence: num,
      latencyMs: num,
      inputTokens: num,
      outputTokens: num,
    }),

    'agentfootprint.findings.judge_failed': eventShape<'agentfootprint.findings.judge_failed'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      status: num,
      latencyMs: num,
    }),

    'agentfootprint.findings.contingent': eventShape<'agentfootprint.findings.contingent'>({
      iteration: num,
      declaredOn: oneOf('answer', 'tool-call'),
      toolCallId: str,
      carriers: num,
      standings: listOf(oneOf('fact', 'noise', 'open', 'ruled-out')),
      valueChars: num,
    }),

    'agentfootprint.findings.argument': eventShape<'agentfootprint.findings.argument'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      turn: num,
      argument: str,
      rule: oneOf('ask', 'assume'),
      period: bool,
      source: oneOf('answered', 'app', 'default', 'model', 'result', 'said'),
      asked: oneOf('invalid-answer', 'missing', 'unverified'),
      claimed: oneOf('app', 'assumed', 'none', 'result', 'turn', 'user'),
      matched: oneOf('mention', 'phrase', 'quote', 'spelling'),
      reading: bool,
      earlier: bool,
      setAside: oneOf('noise', 'open', 'ruled-out'),
      argumentsFrom: oneOf('listed', 'unlisted'),
      coincides: oneOf('app', 'person', 'result'),
      free: bool,
      failed: oneOf(
        'composed-message',
        'no-earlier-turn',
        'not-in-app-text',
        'not-in-earlier-turns',
        'not-in-result',
        'only-in-model-answer',
        'placed-result',
        'quote-not-found',
        'uncheckable',
        'unknown-result',
      ),
      malformed: num,
      valueChars: num,
    }),

    'agentfootprint.findings.period': eventShape<'agentfootprint.findings.period'>({
      toolCallId: str,
      toolName: str,
      iteration: num,
      turn: num,
      verdict: oneOf('covered', 'not-held', 'partly-held', 'undeclared', 'unknown'),
      timeChecks: listOf(
        oneOf(
          'partly-beyond-retention',
          'period-beyond-retention',
          'period-differs-from-asked',
          'period-shifted',
        ),
      ),
    }),

    'agentfootprint.findings.negative_claim': eventShape<'agentfootprint.findings.negative_claim'>({
      iteration: num,
      turn: num,
      field: str,
      span: shapeOf<PayloadOf<'agentfootprint.findings.negative_claim'>['span']>({
        start: num,
        end: num,
      }),
      packVersion: str,
      phraseId: str,
      truncated: bool,
      kind: oneOf('negative-claim', 'negative-claim-note'),
      // A claim row's checker codes and native result ids; a note row's code.
      claim: oneOf('complete', 'none'),
      notes: listOf(str),
      results: listOf(str),
      code: str,
    }),

    'agentfootprint.tool_choice.picked': eventShape<'agentfootprint.tool_choice.picked'>({
      iteration: num,
      chosen: str,
      confidence: num,
      offered: num,
      served: num,
      narrowed: bool,
      narrowedSkipped: oneOf(
        'after-miss',
        'evidence-revision',
        'too-few',
        'unavailable',
        'wrap-up',
      ),
      latencyMs: num,
      inputTokens: num,
      outputTokens: num,
    }),

    'agentfootprint.tool_choice.outcome': eventShape<'agentfootprint.tool_choice.outcome'>({
      iteration: num,
      called: listOf(str),
      firstAgrees: bool,
      missed: listOf(str),
    }),

    'agentfootprint.tool_choice.failed': eventShape<'agentfootprint.tool_choice.failed'>({
      iteration: num,
      status: num,
      latencyMs: num,
    }),

    'agentfootprint.ontology.served': eventShape<'agentfootprint.ontology.served'>({
      iteration: num,
      id: str,
      version: str,
      hash: str,
      nodes: num,
      sources: num,
      edges: num,
    }),

    'agentfootprint.answer.assessed': eventShape<'agentfootprint.answer.assessed'>({
      turn: num,
      iteration: num,
      assessment: oneOf('known', 'not-applicable', 'unknown', 'unrefuted'),
      standing: oneOf('ask', 'consistent', 'known', 'not-assessed', 'not-sure'),
      reasons: boundAssessmentReasons,
      checked: boundAssessmentChecks,
    }),

    'agentfootprint.embedding.generated': eventShape<'agentfootprint.embedding.generated'>({
      model: str,
      provider: oneOf('cohere', 'custom', 'local', 'openai', 'voyage'),
      inputKind: oneOf('document', 'query'),
      dimension: num,
      count: num,
      durationMs: num,
      tokensSpent: num,
    }),

    'agentfootprint.artifacts.resolved': eventShape<'agentfootprint.artifacts.resolved'>({
      ref: str,
      via: oneOf('get', 'head'),
      kind: str,
      bytes: num,
      tool: str,
    }),

    'agentfootprint.artifacts.expired': eventShape<'agentfootprint.artifacts.expired'>({
      ref: str,
      reason: oneOf('max-bytes', 'max-count', 'ttl'),
      kind: str,
      bytes: num,
      tool: str,
    }),

    'agentfootprint.artifacts.hand_over_failed':
      eventShape<'agentfootprint.artifacts.hand_over_failed'>({
        cause: oneOf('abort', 'expired', 'hook', 'operation', 'timeout'),
        op: oneOf('delete', 'dispatch', 'get', 'head', 'list', 'put'),
        errorClass: str,
        errorCode: str,
      }),

    'agentfootprint.integrity.disposition': eventShape<'agentfootprint.integrity.disposition'>({
      posture: oneOf('dev', 'observe'),
      workExisted: bool,
      rows: listOf(
        shapeOf<ItemOf<At<PayloadOf<'agentfootprint.integrity.disposition'>, 'rows'>>>({
          check: str,
          seam: oneOf('choice', 'claim', 'compose', 'wire', 'write'),
          checked: num,
          findings: num,
          notApplicable: num,
          unreachable: num,
          lastFiredAt: num,
          synthetic: num,
        }),
      ),
    }),
  };
}
