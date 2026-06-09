/**
 * causalEvidenceRecorder — the evidence bridge (backlog Phase-1 #5).
 *
 * Harvests, DURING the run, everything a causal snapshot needs beyond
 * (query, finalContent) — from events the engine already fires:
 *
 *   stream.tool_start/tool_end  → ToolCallRecord (name, args, resultPreview, errored)
 *   stream.llm_end              → tokenUsage accumulation + iteration high-water
 *   agent.turn_start/turn_end   → durationMs (+ authoritative totals when seen)
 *   FlowRecorder.onDecision     → DecisionRecord with footprintjs decide()/select()
 *                                 operator-level evidence (rule, conditions, chosen)
 *   context.evaluated routing   → DecisionRecord per skill the graph routed to
 *
 * Pattern: CombinedRecorder (Convention 1 — single purpose: evidence
 *          accumulation) with runId-keyed reset (Convention 4).
 * Redaction: payloads arrive AFTER footprintjs `RedactionPolicy` (the emit
 *          channel redacts before recorders see events); previews are
 *          additionally truncated to `maxPreviewChars`.
 *
 * The Agent attaches this automatically when a CAUSAL memory is mounted and
 * threads `collect` into the memory write mount (`evidenceSource`) — so
 * `writeSnapshot` persists real evidence instead of zeros.
 */

import type { FlowDecisionEvent } from 'footprintjs';
import type { DecisionRecord, ToolCallRecord } from './types.js';

/** What the bridge delivers to `writeSnapshot` for one run. */
export interface RunEvidence {
  readonly iterations: number;
  readonly decisions: ReadonlyArray<DecisionRecord>;
  readonly toolCalls: ReadonlyArray<ToolCallRecord>;
  readonly durationMs: number;
  readonly tokenUsage: { readonly input: number; readonly output: number };
}

export interface CausalEvidenceRecorderOptions {
  /** Recorder id (default 'causal-evidence'). */
  readonly id?: string;
  /** Max chars kept of each tool result preview. Default 200. */
  readonly maxPreviewChars?: number;
}

export interface CausalEvidenceRecorderHandle {
  readonly id: string;
  /** Snapshot the evidence accumulated for the CURRENT run. */
  collect(): RunEvidence;
  clear(): void;
  // CombinedRecorder hooks (routed by method-shape detection):
  onEmit(event: { name: string; payload: unknown }): void;
  onDecision(event: FlowDecisionEvent): void;
}

function preview(value: unknown, max: number): string {
  let s: string;
  if (typeof value === 'string') s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Build the evidence-harvesting recorder. Attach via `.recorder(rec)` (the
 *  Agent does this automatically for CAUSAL memories). */
export function causalEvidenceRecorder(
  options: CausalEvidenceRecorderOptions = {},
): CausalEvidenceRecorderHandle {
  const maxPreview = options.maxPreviewChars ?? 200;

  // ── run-scoped accumulators (reset when a new runId is observed) ──
  let lastRunId: string | undefined;
  let decisions: DecisionRecord[] = [];
  let toolCalls: ToolCallRecord[] = [];
  let pendingTools = new Map<string, { name: string; args: Readonly<Record<string, unknown>> }>();
  let tokens = { input: 0, output: 0 };
  let iterations = 0;
  let turnStartMs: number | undefined;
  let authoritative:
    | { iterations: number; input: number; output: number; durationMs: number }
    | undefined;

  const reset = (): void => {
    decisions = [];
    toolCalls = [];
    pendingTools = new Map();
    tokens = { input: 0, output: 0 };
    iterations = 0;
    turnStartMs = undefined;
    authoritative = undefined;
  };

  const observeRunId = (event: unknown): void => {
    const runId = (event as { traversalContext?: { runId?: string } })?.traversalContext?.runId;
    if (runId && runId !== lastRunId) {
      lastRunId = runId;
      reset(); // Convention 4 — new run, fresh evidence
    }
  };

  return {
    id: options.id ?? 'causal-evidence',

    onEmit(event): void {
      const { name, payload } = event as { name: string; payload: Record<string, unknown> };
      switch (name) {
        case 'agentfootprint.agent.turn_start':
          // A new turn on the same executor — start fresh (one snapshot per turn).
          reset();
          turnStartMs = Date.now();
          break;
        case 'agentfootprint.stream.tool_start': {
          const id = String(payload.toolCallId ?? '');
          pendingTools.set(id, {
            name: String(payload.toolName ?? 'unknown'),
            args: (payload.args ?? {}) as Readonly<Record<string, unknown>>,
          });
          break;
        }
        case 'agentfootprint.stream.tool_end': {
          const id = String(payload.toolCallId ?? '');
          const started = pendingTools.get(id);
          pendingTools.delete(id);
          toolCalls.push({
            name: started?.name ?? 'unknown',
            args: started?.args ?? {},
            resultPreview: preview(payload.result, maxPreview),
            errored: payload.error === true,
          });
          break;
        }
        case 'agentfootprint.stream.llm_end': {
          const usage = payload.usage as { input?: number; output?: number } | undefined;
          tokens = {
            input: tokens.input + (usage?.input ?? 0),
            output: tokens.output + (usage?.output ?? 0),
          };
          const iter = Number(payload.iteration ?? 0);
          if (iter > iterations) iterations = iter;
          break;
        }
        case 'agentfootprint.context.evaluated': {
          // Skill-graph routing provenance → one DecisionRecord per routed skill.
          const routing = payload.routing as
            | ReadonlyArray<{ id?: string; via?: string; label?: string; path?: unknown }>
            | undefined;
          if (Array.isArray(routing)) {
            for (const r of routing) {
              decisions.push({
                stageId: 'skill-graph',
                chosen: String(r.id ?? 'unknown'),
                ...(r.label !== undefined || r.via !== undefined
                  ? { rule: r.label ?? `via ${r.via}` }
                  : {}),
                ...(r.path !== undefined && {
                  evidence: { path: r.path } as Readonly<Record<string, unknown>>,
                }),
              });
            }
          }
          break;
        }
        case 'agentfootprint.agent.turn_end': {
          // Authoritative totals when the write runs after turn_end.
          authoritative = {
            iterations: Number(payload.iterationCount ?? iterations),
            input: Number(payload.totalInputTokens ?? tokens.input),
            output: Number(payload.totalOutputTokens ?? tokens.output),
            durationMs: Number(payload.durationMs ?? 0),
          };
          break;
        }
        default:
          break;
      }
    },

    /** footprintjs FlowRecorder channel — decide()/select() evidence. */
    onDecision(event: FlowDecisionEvent): void {
      observeRunId(event);
      const e = event as unknown as Record<string, unknown>;
      const chosen = e.chosen ?? e.selected;
      // Internal agent plumbing (the cache-gate decider) is not domain
      // decision evidence — keep snapshots focused on consumer-meaningful
      // decisions (route, skill graph, consumer decide()/select()).
      if (String(chosen ?? '').startsWith('sf-cache/')) return;
      const evidence = e.evidence as
        | { rule?: string; label?: string; conditions?: unknown }
        | undefined;
      decisions.push({
        stageId: String(e.stageId ?? e.stageName ?? e.stage ?? 'decider'),
        chosen: String(chosen ?? 'unknown'),
        ...(evidence?.label !== undefined || evidence?.rule !== undefined
          ? { rule: String(evidence.label ?? evidence.rule) }
          : {}),
        ...(evidence !== undefined && {
          evidence: evidence as Readonly<Record<string, unknown>>,
        }),
      });
    },

    collect(): RunEvidence {
      return {
        iterations: authoritative?.iterations ?? iterations,
        decisions: [...decisions],
        toolCalls: [...toolCalls],
        durationMs:
          authoritative?.durationMs ?? (turnStartMs !== undefined ? Date.now() - turnStartMs : 0),
        tokenUsage: {
          input: authoritative?.input ?? tokens.input,
          output: authoritative?.output ?? tokens.output,
        },
      };
    },

    clear(): void {
      reset();
      lastRunId = undefined;
    },
  };
}
