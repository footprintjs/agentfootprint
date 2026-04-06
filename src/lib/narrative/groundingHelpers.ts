/**
 * Grounding helpers — extract sources, claims, and cross-reference data
 * from CombinedNarrativeRecorder entries.
 *
 * Uses the `key` field on entries (the scope key that was written) for
 * structured data extraction. No dependency on rendered text strings or
 * stage names — works with any NarrativeRenderer and any flowchart topology.
 *
 * Usage:
 *   const entries = executor.getNarrativeEntries();
 *   const sources = getGroundingSources(entries);
 *   const claims = getLLMClaims(entries);
 *   const context = getFullLLMContext(entries);
 */

import type { CombinedNarrativeEntry } from 'footprintjs';
import { AgentScopeKey } from '../../scope/types';

// ── Types ────────────────────────────────────────────────────────────────────

/** A tool result that serves as a grounding source (source of truth). */
export interface GroundingSource {
  /** Stage that produced this source. */
  readonly stageName: string;
  /** Stage ID for UI sync. */
  readonly stageId?: string;
  /** Subflow ID (e.g., 'tool-calls' for ExecuteTools). */
  readonly subflowId?: string;
  /** Raw tool result content string. */
  readonly content: string;
  /** Parsed content (JSON-parsed if possible, raw string otherwise). */
  readonly parsed: unknown;
}

/** An LLM output claim to verify against sources. */
export interface LLMClaim {
  /** Stage that produced this claim. */
  readonly stageName: string;
  readonly stageId?: string;
  /** The full LLM output text. */
  readonly content: string;
  /** Whether this is the final answer ('result') or intermediate ('parsedResponse'). */
  readonly type: 'final' | 'intermediate';
}

/** Full LLM context snapshot for a single turn. */
export interface LLMContextSnapshot {
  /** System prompt (full, un-truncated). */
  readonly systemPrompt?: string;
  /** Tool descriptions sent to the LLM. */
  readonly toolDescriptions?: Array<{ name: string; description: string; inputSchema: unknown }>;
  /** Tool results (sources of truth). */
  readonly sources: GroundingSource[];
  /** LLM claims (outputs to verify). */
  readonly claims: LLMClaim[];
  /** Decision scope values (last observed). */
  readonly decision?: Record<string, unknown>;
}

// ── Extractors ───────────────────────────────────────────────────────────────

/**
 * Extract grounding sources (tool results) from narrative entries.
 *
 * Matches on `entry.key === 'toolResultMessages'` — the scope key written
 * by the ExecuteToolCalls stage. Renderer-independent and topology-independent.
 *
 * @example
 * ```typescript
 * const entries = agent.getNarrativeEntries();
 * const sources = getGroundingSources(entries);
 * // [{ stageName: 'ExecuteToolCalls', content: '{"orderId":"ORD-1003",...}', parsed: {...} }]
 * ```
 */
export function getGroundingSources(entries: CombinedNarrativeEntry[]): GroundingSource[] {
  const sources: GroundingSource[] = [];

  for (const entry of entries) {
    if (entry.type !== 'step' || entry.key !== AgentScopeKey.ToolResultMessages) continue;

    const messages = entry.rawValue as Array<{ role?: string; content?: string }> | undefined;
    if (!Array.isArray(messages)) continue;

    for (const msg of messages) {
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        let parsed: unknown;
        try { parsed = JSON.parse(msg.content); } catch { parsed = msg.content; }
        sources.push({
          stageName: entry.stageName ?? 'unknown',
          stageId: entry.stageId,
          subflowId: entry.subflowId,
          content: msg.content,
          parsed,
        });
      }
    }
  }

  return sources;
}

/**
 * Extract LLM output claims from narrative entries.
 *
 * Final claims from `entry.key === AgentScopeKey.Result`.
 * Intermediate claims from `entry.key === AgentScopeKey.ParsedResponse` where content is final (not tool_calls).
 *
 * @example
 * ```typescript
 * const claims = getLLMClaims(agent.getNarrativeEntries());
 * // [{ content: 'Your order was denied...', type: 'final' }]
 * ```
 */
export function getLLMClaims(entries: CombinedNarrativeEntry[]): LLMClaim[] {
  const claims: LLMClaim[] = [];

  for (const entry of entries) {
    if (entry.type !== 'step') continue;

    if (entry.key === AgentScopeKey.Result) {
      const content = entry.rawValue as string;
      if (typeof content === 'string' && content.length > 0) {
        claims.push({
          stageName: entry.stageName ?? 'unknown',
          stageId: entry.stageId,
          content,
          type: 'final',
        });
      }
    }

    if (entry.key === AgentScopeKey.ParsedResponse) {
      const parsed = entry.rawValue as { hasToolCalls?: boolean; content?: string };
      if (parsed && !parsed.hasToolCalls && typeof parsed.content === 'string' && parsed.content.length > 0) {
        claims.push({
          stageName: entry.stageName ?? 'unknown',
          stageId: entry.stageId,
          content: parsed.content,
          type: 'intermediate',
        });
      }
    }
  }

  return claims;
}

/**
 * Build a full LLM context snapshot from narrative entries.
 *
 * Extracts everything the LLM saw and produced. Uses scope keys for matching:
 * - `systemPrompt` — system prompt text (last value, may change in Dynamic mode)
 * - `toolDescriptions` — tool descriptions sent to LLM
 * - `toolResultMessages` — tool results (sources of truth)
 * - `result` / `parsedResponse` — LLM outputs (claims)
 * - `decision` — Decision Scope state
 */
export function getFullLLMContext(entries: CombinedNarrativeEntry[]): LLMContextSnapshot {
  let systemPrompt: string | undefined;
  let toolDescriptions: Array<{ name: string; description: string; inputSchema: unknown }> | undefined;
  let decision: Record<string, unknown> | undefined;

  for (const entry of entries) {
    if (entry.type !== 'step') continue;

    if (entry.key === AgentScopeKey.SystemPrompt && typeof entry.rawValue === 'string') {
      systemPrompt = entry.rawValue;
    }

    if (entry.key === AgentScopeKey.ToolDescriptions && Array.isArray(entry.rawValue)) {
      toolDescriptions = entry.rawValue as Array<{ name: string; description: string; inputSchema: unknown }>;
    }

    if (entry.key === AgentScopeKey.Decision && entry.rawValue && typeof entry.rawValue === 'object' && !Array.isArray(entry.rawValue)) {
      decision = entry.rawValue as Record<string, unknown>;
    }
  }

  return {
    systemPrompt,
    toolDescriptions,
    sources: getGroundingSources(entries),
    claims: getLLMClaims(entries),
    decision,
  };
}
