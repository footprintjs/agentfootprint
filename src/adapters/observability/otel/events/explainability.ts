import type { AgentfootprintEvent } from '../../../../events/registry.js';
import type {
  AgentEvidenceCheckedPayload,
  FindingsStandingPayload,
  ToolAbsentPayload,
} from '../../../../events/payloads.js';
import type { OtelAttributeValue } from '../types.js';
import type { TurnState, TurnStore } from '../turns/state.js';
import type { SpanWriter } from '../spans/writer.js';
import { bound, boundList } from '../attributes/bounds.js';
import { looksLikeDecideEvidence, renderEvidenceAttrs } from '../attributes/evidence.js';
import {
  coverageAttrs,
  evidenceVerdictAttrs,
  standingAttrs,
  standingCountAttrs,
  MAX_STANDING_EVENTS_PER_TURN,
  STANDINGS,
} from '../attributes/projections.js';

export function createExplainability(
  captureContent: boolean,
  explainability: boolean,
  ranTools: TurnStore['ranTools'],
  spans: Pick<SpanWriter, 'topSpan' | 'recordSpanEvent' | 'setAttrs'>,
) {
  const { topSpan, recordSpanEvent, setAttrs } = spans;
  function handleExplainability(event: AgentfootprintEvent, t: TurnState): void {
    const top = topSpan(t);
    if (!top) return;
    const p = event.payload as unknown as Record<string, unknown>;

    switch (event.type) {
      // The ReAct loop's own decision: tool-calls vs final.
      case 'agentfootprint.agent.route_decided': {
        recordSpanEvent(top, 'agentfootprint.agent.route_decided', {
          'agentfootprint.decision.stage': 'react-route',
          'agentfootprint.decision.chosen': bound(p.chosen),
          ...(typeof p.rationale === 'string' && {
            'agentfootprint.decision.rationale': bound(p.rationale),
          }),
          ...(typeof p.iterIndex === 'number' && {
            'agentfootprint.iteration.index': p.iterIndex,
          }),
        });
        break;
      }

      // Conditional core-flow routing. `evidence` (when an emitter
      // populates it with decide() output) renders at operator level.
      case 'agentfootprint.composition.route_decided': {
        const attrs: Record<string, OtelAttributeValue> = {
          'agentfootprint.decision.stage': bound(p.conditionalId),
          'agentfootprint.decision.chosen': bound(p.chosen),
          ...(typeof p.rationale === 'string' && {
            'agentfootprint.decision.rationale': bound(p.rationale),
          }),
        };
        if (looksLikeDecideEvidence(p.evidence))
          Object.assign(attrs, renderEvidenceAttrs(p.evidence));
        recordSpanEvent(top, 'agentfootprint.composition.route_decided', attrs);
        break;
      }

      // Skill-graph routing provenance — one span event per routed
      // injection: the decision path (predicate labels + branch taken),
      // the route edge, and the tools the route unlocked.
      case 'agentfootprint.context.evaluated': {
        const routing = p.routing as
          | ReadonlyArray<{
              injectionId?: string;
              via?: string;
              label?: string;
              from?: string;
              path?: ReadonlyArray<{ label?: string; branch?: string }>;
              tools?: readonly string[];
            }>
          | undefined;
        if (!Array.isArray(routing)) break; // no skill routing this iteration — no event
        for (const r of routing) {
          recordSpanEvent(top, 'agentfootprint.skill.routing', {
            'agentfootprint.skill.injection_id': bound(r.injectionId),
            ...(r.via !== undefined && { 'agentfootprint.skill.via': bound(r.via) }),
            ...(r.label !== undefined && { 'agentfootprint.skill.label': bound(r.label) }),
            ...(r.from !== undefined && { 'agentfootprint.skill.from': bound(r.from) }),
            ...(Array.isArray(r.path) && {
              'agentfootprint.skill.path': boundList(
                r.path.map(
                  (step: { label?: string; branch?: string }) => `${step.label} → ${step.branch}`,
                ),
              ),
            }),
            ...(Array.isArray(r.tools) && {
              'agentfootprint.skill.tools': boundList(r.tools.map(String)),
            }),
          });
        }
        break;
      }

      case 'agentfootprint.skill.activated': {
        recordSpanEvent(top, 'agentfootprint.skill.activated', {
          'agentfootprint.skill.id': bound(p.skillId),
          'agentfootprint.skill.reason': bound(p.reason),
          ...(Array.isArray(p.injectedTools) && {
            'agentfootprint.skill.tools': boundList((p.injectedTools as unknown[]).map(String)),
          }),
        });
        break;
      }

      // #9 tool-arg validation rejections. The span event renders paths /
      // expectations / received TYPES only. A string-shape issue also carries
      // `value` (a capped excerpt) and `hint` for the MODEL's correction —
      // deliberately NOT projected here: third-party telemetry stays
      // value-free (PII contract).
      case 'agentfootprint.validation.args_invalid': {
        const issues = (p.issues ?? []) as ReadonlyArray<{
          path?: string;
          expected?: string;
          got?: string;
        }>;
        recordSpanEvent(top, 'agentfootprint.validation.args_invalid', {
          'agentfootprint.validation.tool_name': bound(p.toolName),
          'agentfootprint.validation.tool_call_id': bound(p.toolCallId),
          'agentfootprint.validation.enforced': p.enforced === true,
          'agentfootprint.validation.issue_count': issues.length,
          'agentfootprint.validation.issues': boundList(
            issues.map((i) => `${i.path}: expected ${i.expected}, got ${i.got}`),
          ),
        });
        break;
      }

      case 'agentfootprint.permission.check': {
        recordSpanEvent(top, 'agentfootprint.permission.check', {
          'agentfootprint.permission.capability': bound(p.capability),
          'agentfootprint.permission.actor': bound(p.actor),
          ...(p.target !== undefined && { 'agentfootprint.permission.target': bound(p.target) }),
          'agentfootprint.permission.result': bound(p.result),
          ...(p.policyRuleId !== undefined && {
            'agentfootprint.permission.policy_rule_id': bound(p.policyRuleId),
          }),
          ...(typeof p.rationale === 'string' && {
            'agentfootprint.permission.rationale': bound(p.rationale),
          }),
          ...(typeof p.reason === 'string' && {
            'agentfootprint.permission.reason': bound(p.reason),
          }),
        });
        break;
      }

      case 'agentfootprint.permission.halt': {
        recordSpanEvent(top, 'agentfootprint.permission.halt', {
          'agentfootprint.permission.target': bound(p.target),
          'agentfootprint.permission.reason': bound(p.reason),
          ...(typeof p.iteration === 'number' && {
            'agentfootprint.iteration.index': p.iteration,
          }),
        });
        break;
      }

      // Credential lifecycle — payloads carry kind / service / session
      // identifiers ONLY (the registry contract: never the secret).
      case 'agentfootprint.credential.requested':
      case 'agentfootprint.credential.acquired':
      case 'agentfootprint.credential.authorization_required':
      case 'agentfootprint.credential.failed': {
        recordSpanEvent(top, event.type, {
          'agentfootprint.credential.service': bound(p.service),
          ...(p.kind !== undefined && { 'agentfootprint.credential.kind': bound(p.kind) }),
          ...(p.mode !== undefined && { 'agentfootprint.credential.mode': bound(p.mode) }),
          ...(p.sessionId !== undefined && {
            'agentfootprint.credential.session_id': bound(p.sessionId),
          }),
          ...(p.reason !== undefined && { 'agentfootprint.credential.reason': bound(p.reason) }),
        });
        break;
      }

      // A tool's declared absence / coverage — on the call's OWN span while it
      // is open (parallel calls interleave, so the stack top may be another
      // call's), else the active span. Counts per list, never a sentence.
      case 'agentfootprint.tools.absent':
      case 'agentfootprint.tools.coverage_declared': {
        const callId = typeof p.toolCallId === 'string' ? p.toolCallId : undefined;
        const span = (callId !== undefined ? t.toolSpans.get(callId) : undefined) ?? top;
        recordSpanEvent(
          span,
          event.type,
          coverageAttrs(p as Partial<ToolAbsentPayload>, (name) => ranTools.has(name)),
        );
        break;
      }

      // The evidence gate's verdict on one would-be-final answer.
      case 'agentfootprint.agent.evidence_checked': {
        recordSpanEvent(
          top,
          event.type,
          evidenceVerdictAttrs(p as Partial<AgentEvidenceCheckedPayload>, captureContent),
        );
        break;
      }

      // One model standing on one earlier result; counted for turn_end. The
      // MODEL decides how many rows it files, and a real SDK keeps 128
      // events per span by evicting the OLDEST — so past a per-turn cap the
      // rows are counted, not written, and one summary event says how many
      // at the turn's close. The per-standing counts stay complete.
      case 'agentfootprint.findings.standing': {
        const row = p as Partial<FindingsStandingPayload>;
        if (t.standingEvents < MAX_STANDING_EVENTS_PER_TURN) {
          t.standingEvents += 1;
          recordSpanEvent(top, event.type, standingAttrs(row));
        } else t.standingOmitted += 1;
        if (row.standing !== undefined && STANDINGS.includes(row.standing)) {
          t.standingCounts ??= new Map();
          t.standingCounts.set(row.standing, (t.standingCounts.get(row.standing) ?? 0) + 1);
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * The turn's findings summary on the agent span, at whichever close the
   * turn gets (turn_end, error.fatal, or `stop()` for a paused one): a count
   * per standing when any row was filed, and the one overflow event when the
   * per-turn cap held rows back.
   */
  function flushStandings(t: TurnState): void {
    if (t.root === undefined || !explainability) return;
    if (t.standingCounts !== undefined) setAttrs(t.root, standingCountAttrs(t.standingCounts));
    if (t.standingOmitted > 0) {
      recordSpanEvent(t.root, 'agentfootprint.findings.standing_overflow', {
        'agentfootprint.findings.standing_events_omitted': t.standingOmitted,
        'agentfootprint.findings.standing_events_written': t.standingEvents,
      });
    }
  }

  return { handleExplainability, flushStandings };
}

export type Explainability = ReturnType<typeof createExplainability>;
