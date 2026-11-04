/**
 * One component-leg evidence bridge. Each native component setup constructs a
 * fresh handle. Turn events and restored totals cannot reset or replace its facts.
 * Private tool facts arrive through the existing pre-serving computation port;
 * native decisions arrive through the existing scoped recorder dispatcher.
 */
import type { FlowDecisionEvent, FlowSelectedEvent } from 'footprintjs';
import type { DecisionRecord, ToolCallRecord } from './types.js';
import {
  EVIDENCE_CAUSES,
  EVIDENCE_LIMITS,
  type EvidenceCoverage,
  type RunEvidence,
} from './observation.js';
import { toWireJson, withWireErrors } from '../../lib/wireJson.js';

export type { RunEvidence } from './observation.js';

export interface CausalEvidenceRecorderOptions {
  readonly id?: string;
  /** Captured actual component source; absent means observation is unavailable. */
  readonly coverage?: EvidenceCoverage;
  readonly maxPreviewChars?: number;
  readonly maxFieldChars?: number;
}

export interface CausalEvidenceRecorderHandle {
  readonly id: string;
  collect(): RunEvidence;
  onEmit(event: { name: string; payload: unknown }): void;
  onDecision(event: FlowDecisionEvent): void;
  onSelected(event: FlowSelectedEvent): void;
}

function boundOption(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 65_536) {
    throw new TypeError('Causal evidence field bound must be an integer between 1 and 65536');
  }
  return result;
}

function preview(value: unknown, max: number): string {
  const serialized = typeof value === 'string' ? value : toWireJson(value);
  const text = typeof serialized === 'string' ? serialized : String(value);
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function bounded(
  value: Readonly<Record<string, unknown>> | undefined,
  max: number,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  const text = toWireJson(value);
  return text.length <= max ? withWireErrors(value) : { __truncated: text.slice(0, max) + '…' };
}

export function causalEvidenceRecorder(
  options: CausalEvidenceRecorderOptions = {},
): CausalEvidenceRecorderHandle {
  const maxPreview = boundOption(options.maxPreviewChars, 200);
  const maxField = boundOption(options.maxFieldChars, 2000);
  const coverage =
    options.coverage &&
    Object.freeze({
      scope: options.coverage.scope,
      runId: options.coverage.runId,
      entry: Object.freeze({ ...options.coverage.entry }),
      priorLegs: options.coverage.priorLegs,
    });
  const startedAt = Date.now();
  const decisions: DecisionRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const pending = new Map<string, { name: string; args: Readonly<Record<string, unknown>> }>();
  const omitted = { decisions: 0, toolCalls: 0, pendingStarts: 0 };
  let failed = false;
  let boundedObservation = false;
  let unmatchedEnds = 0;
  let duplicateStarts = 0;
  let observedCalls = 0;
  let missingUsage = 0;
  let observedIterationStarts = 0;
  let lastObservedIteration: number | undefined;
  let input = 0;
  let output = 0;

  const add = (count: number, amount = 1): number => {
    if (!Number.isSafeInteger(amount) || amount < 0 || count > Number.MAX_SAFE_INTEGER - amount) {
      boundedObservation = true;
      return Number.MAX_SAFE_INTEGER;
    }
    return count + amount;
  };
  const decision = (value: DecisionRecord): void => {
    if (decisions.length === EVIDENCE_LIMITS.decisions) {
      omitted.decisions = add(omitted.decisions);
      boundedObservation = true;
    } else decisions.push(value);
  };
  const observe = (body: () => void): void => {
    if (!coverage) return;
    try {
      body();
    } catch {
      failed = true;
    }
  };
  const usable = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER;

  return {
    id: options.id ?? 'causal-evidence',
    onEmit(event): void {
      observe(() => {
        const raw = event.payload;
        const payload = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<
          string,
          unknown
        >;
        switch (event.name) {
          case 'agentfootprint.agent.iteration_start':
            observedIterationStarts = add(observedIterationStarts);
            if (Number.isSafeInteger(payload.iterIndex) && (payload.iterIndex as number) >= 0) {
              lastObservedIteration = payload.iterIndex as number;
            }
            break;
          case 'agentfootprint.stream.tool_start': {
            if (payload.notDispatched !== undefined) break;
            const id = payload.toolCallId;
            if (typeof id !== 'string' || id.length === 0) {
              failed = true;
              break;
            }
            if (pending.has(id)) {
              duplicateStarts = add(duplicateStarts);
              break;
            }
            if (pending.size === EVIDENCE_LIMITS.pendingStarts) {
              omitted.pendingStarts = add(omitted.pendingStarts);
              boundedObservation = true;
              break;
            }
            pending.set(id, {
              name: preview(payload.toolName ?? 'unknown', maxField),
              args:
                bounded((payload.args ?? {}) as Readonly<Record<string, unknown>>, maxField) ?? {},
            });
            break;
          }
          case 'agentfootprint.stream.tool_end': {
            if (payload.notDispatched !== undefined) break;
            const id = payload.toolCallId;
            if (typeof id !== 'string' || id.length === 0) {
              failed = true;
              break;
            }
            const start = pending.get(id);
            if (!start) {
              unmatchedEnds = add(unmatchedEnds);
              break;
            }
            pending.delete(id);
            if (toolCalls.length === EVIDENCE_LIMITS.toolCalls) {
              omitted.toolCalls = add(omitted.toolCalls);
              boundedObservation = true;
              break;
            }
            toolCalls.push({
              ...start,
              resultPreview: preview(payload.result, maxPreview),
              errored: payload.error === true,
            });
            break;
          }
          case 'agentfootprint.stream.llm_end': {
            const usage = payload.usage as { input?: unknown; output?: unknown } | undefined;
            if (!usable(usage?.input) || !usable(usage?.output)) {
              missingUsage = add(missingUsage);
              break;
            }
            observedCalls = add(observedCalls);
            const nextInput = input + usage.input,
              nextOutput = output + usage.output;
            if (nextInput > Number.MAX_SAFE_INTEGER || nextOutput > Number.MAX_SAFE_INTEGER) {
              boundedObservation = true;
              input = Math.min(Number.MAX_SAFE_INTEGER, nextInput);
              output = Math.min(Number.MAX_SAFE_INTEGER, nextOutput);
            } else {
              input = nextInput;
              output = nextOutput;
            }
            break;
          }
          case 'agentfootprint.context.evaluated': {
            const routing = payload.routing;
            if (!Array.isArray(routing)) break;
            for (const row of routing) {
              decision({
                stageId: 'skill-graph',
                chosen: preview(row.injectionId ?? row.id ?? 'unknown', maxField),
                ...(row.label !== undefined || row.via !== undefined
                  ? { rule: preview(row.label ?? 'via ' + String(row.via), maxField) }
                  : {}),
                ...(row.path !== undefined
                  ? { evidence: bounded({ path: row.path }, maxField) }
                  : {}),
              });
            }
            break;
          }
          // Turn boundaries/totals describe the whole conversation, not this leg.
          default:
            break;
        }
      });
    },
    onDecision(event): void {
      observe(() => {
        const stageId = event.traversalContext?.stageId ?? event.decider;
        if (
          String(event.chosen ?? '').includes('sf-cache/') ||
          String(stageId).includes('sf-cache')
        )
          return;
        const evidence = event.evidence as { rule?: string; label?: string } | undefined;
        decision({
          stageId: preview(stageId, maxField),
          chosen: preview(event.chosen ?? 'unknown', maxField),
          ...(evidence?.label !== undefined || evidence?.rule !== undefined
            ? { rule: preview(evidence.label ?? evidence.rule, maxField) }
            : {}),
          ...(evidence !== undefined
            ? { evidence: bounded(evidence as Readonly<Record<string, unknown>>, maxField) }
            : {}),
        });
      });
    },
    onSelected(event): void {
      observe(() => {
        const stageId = event.traversalContext?.stageId ?? event.parent;
        if (String(stageId).includes('sf-cache')) return;
        if (String(stageId).includes('context') && event.selected.every((s) => s.startsWith('sf-')))
          return;
        decision({
          stageId: preview(stageId, maxField),
          chosen: preview(event.selected.join(', '), maxField),
          ...(event.evidence !== undefined
            ? {
                evidence: bounded(
                  event.evidence as unknown as Readonly<Record<string, unknown>>,
                  maxField,
                ),
              }
            : {}),
        });
      });
    },
    collect(): RunEvidence {
      if (!coverage) return { availability: 'unavailable', reason: 'not-configured' };
      const flags = {
        'observer-failed': failed,
        'bounded-observation': boundedObservation,
        'incomplete-tool-pairs': pending.size > 0 || unmatchedEnds > 0,
        'duplicate-tool-start': duplicateStarts > 0,
        'missing-usage': missingUsage > 0,
      };
      const causes = EVIDENCE_CAUSES.filter((cause) => flags[cause]);
      const elapsed = Date.now() - startedAt;
      const facts = {
        coverage,
        decisions: [...decisions],
        toolCalls: [...toolCalls],
        observedIterationStarts,
        ...(lastObservedIteration !== undefined ? { lastObservedIteration } : {}),
        toolAccounting: { unmatchedStarts: pending.size, unmatchedEnds, duplicateStarts },
        usageAccounting: { observedCalls, missingUsage },
        omittedObservations: { ...omitted },
        duration: usable(elapsed)
          ? { kind: 'measured' as const, observationWindowMs: elapsed }
          : { kind: 'unavailable' as const },
        tokenUsage: { input, output },
      };
      return causes.length
        ? { ...facts, availability: 'partial', causes }
        : { ...facts, availability: 'observed' };
    },
  };
}
