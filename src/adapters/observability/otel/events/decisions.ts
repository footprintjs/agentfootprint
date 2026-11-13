import type { FlowDecisionEvent, FlowSelectedEvent } from 'footprintjs';
import type { OtelDecisionEvidenceRecorder } from '../types.js';
import type { TurnStore } from '../turns/state.js';
import type { SpanWriter } from '../spans/writer.js';
import { bound } from '../attributes/bounds.js';
import { renderEvidenceAttrs, type DecisionEvidenceLike } from '../attributes/evidence.js';

interface DecisionOptions {
  readonly lifecycle: { stopped: boolean };
  readonly explainability: boolean;
  readonly soleActiveTurn: TurnStore['soleActiveTurn'];
  readonly topSpan: SpanWriter['topSpan'];
  readonly recordSpanEvent: SpanWriter['recordSpanEvent'];
}

export function decisionEvidenceRecorder({
  lifecycle,
  explainability,
  soleActiveTurn,
  topSpan,
  recordSpanEvent,
}: DecisionOptions): OtelDecisionEvidenceRecorder {
  // One purpose (Convention 1): forward decide()/select() evidence
  // from footprintjs's FlowRecorder channel into this strategy's
  // span machinery. Plumbing filters mirror the #5 causal-evidence
  // bridge (sf-cache gate deciders, the agent's Context slot-fork).
  const forward = (
    stageId: string,
    chosen: string,
    evidence: DecisionEvidenceLike | undefined,
  ): void => {
    if (lifecycle.stopped || !explainability) return;
    // No structured evidence → already reported via the typed
    // route_decided events; skip to avoid double-reporting.
    if (evidence === undefined) return;
    const t = soleActiveTurn();
    if (!t?.sampled) return;
    const top = topSpan(t);
    if (!top) return;
    recordSpanEvent(top, 'agentfootprint.decision.evidence', {
      'agentfootprint.decision.stage': bound(stageId),
      'agentfootprint.decision.chosen': bound(chosen),
      ...renderEvidenceAttrs(evidence),
    });
  };

  return {
    id: 'otel-decision-evidence',
    onDecision(event: FlowDecisionEvent): void {
      const stageId = event.traversalContext?.stageId ?? event.decider;
      // Internal agent plumbing (the cache-gate decider) is not
      // domain decision evidence. `includes` (not startsWith): in
      // reactMode 'dynamic-grouped' names are double-prefixed.
      if (String(event.chosen ?? '').includes('sf-cache/') || String(stageId).includes('sf-cache'))
        return;
      forward(
        String(stageId),
        String(event.chosen ?? 'unknown'),
        event.evidence as DecisionEvidenceLike | undefined,
      );
    },
    onSelected(event: FlowSelectedEvent): void {
      const stageId = event.traversalContext?.stageId ?? event.parent;
      if (String(stageId).includes('sf-cache')) return;
      // The agent's own Context slot-fork is a selector — plumbing.
      if (String(stageId).includes('context') && event.selected.every((s) => s.startsWith('sf-')))
        return;
      forward(
        String(stageId),
        event.selected.join(', '),
        event.evidence as DecisionEvidenceLike | undefined,
      );
    },
  };
}
