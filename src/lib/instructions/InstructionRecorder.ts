/**
 * InstructionRecorder — tracks which LLM instructions fired and follow-up usage.
 *
 * Implements AgentRecorder so it plugs into the standard `.recorder()` API.
 * Records per-tool instruction firings and follow-up accuracy for evaluation.
 *
 * @example
 * ```typescript
 * import { Agent, InstructionRecorder } from 'agentfootprint';
 *
 * const recorder = new InstructionRecorder();
 * const agent = Agent.create({ provider })
 *   .recorder(recorder)
 *   .build();
 *
 * await agent.run('Check my order');
 *
 * console.log(recorder.getSummary());
 * // {
 * //   totalFired: 2,
 * //   totalFollowUpsOffered: 1,
 * //   byTool: {
 * //     check_order: {
 * //       instructions: { 'cancelled': { fired: 1, safety: false } },
 * //       followUps: { 'get_trace': { offered: 1 } },
 * //     }
 * //   }
 * // }
 * ```
 */

import type { AgentRecorder } from '../../core';
import type { ResolvedInstruction } from './evaluator';

// ── Tracking Types ──────────────────────────────────────────────────────

export interface InstructionFiring {
  /** Number of times this instruction fired. */
  readonly fired: number;
  /** Whether this is a safety instruction. */
  readonly safety: boolean;
}

export interface FollowUpOffering {
  /** Number of times this follow-up was offered. */
  readonly offered: number;
  /** Target tool ID. */
  readonly toolId: string;
}

export interface ToolInstructionStats {
  /** Instructions that fired for this tool, keyed by instruction ID. */
  readonly instructions: Record<string, InstructionFiring>;
  /** Follow-ups offered for this tool, keyed by follow-up toolId. */
  readonly followUps: Record<string, FollowUpOffering>;
}

export interface InstructionSummary {
  /** Total instructions fired across all tools. */
  readonly totalFired: number;
  /** Total follow-ups offered across all tools. */
  readonly totalFollowUpsOffered: number;
  /** Per-tool breakdown. */
  readonly byTool: Record<string, ToolInstructionStats>;
}

// ── Recorder ────────────────────────────────────────────────────────────

export class InstructionRecorder implements AgentRecorder {
  readonly id: string;

  private firings = new Map<string, Map<string, { count: number; safety: boolean }>>();
  private followUps = new Map<string, Map<string, { count: number; toolId: string }>>();

  constructor(id = 'instruction-recorder') {
    this.id = id;
  }

  /**
   * Record instructions that fired for a tool invocation.
   *
   * Called by the agent loop after processInstructions() completes.
   * Not an AgentRecorder hook — this is a dedicated method because
   * instruction events don't map to the standard onLLMCall/onToolCall events.
   */
  recordFirings(toolId: string, fired: ResolvedInstruction[]): void {
    for (const instr of fired) {
      // Track instruction firing
      if (!this.firings.has(toolId)) this.firings.set(toolId, new Map());
      const toolFirings = this.firings.get(toolId)!;
      const existing = toolFirings.get(instr.id);
      if (existing) {
        existing.count++;
      } else {
        toolFirings.set(instr.id, { count: 1, safety: instr.safety });
      }

      // Track follow-up offering
      if (instr.resolvedFollowUp) {
        if (!this.followUps.has(toolId)) this.followUps.set(toolId, new Map());
        const toolFollowUps = this.followUps.get(toolId)!;
        const fuKey = instr.resolvedFollowUp.toolId;
        const existingFu = toolFollowUps.get(fuKey);
        if (existingFu) {
          existingFu.count++;
        } else {
          toolFollowUps.set(fuKey, { count: 1, toolId: fuKey });
        }
      }
    }
  }

  /** Get summary of all instruction firings and follow-up offerings. */
  getSummary(): InstructionSummary {
    let totalFired = 0;
    let totalFollowUpsOffered = 0;
    const byTool: Record<string, ToolInstructionStats> = {};

    // All tool IDs that have any activity
    const allToolIds = new Set([...this.firings.keys(), ...this.followUps.keys()]);

    for (const toolId of allToolIds) {
      const instructions: Record<string, InstructionFiring> = {};
      const followUps: Record<string, FollowUpOffering> = {};

      const toolFirings = this.firings.get(toolId);
      if (toolFirings) {
        for (const [instrId, data] of toolFirings) {
          instructions[instrId] = { fired: data.count, safety: data.safety };
          totalFired += data.count;
        }
      }

      const toolFollowUps = this.followUps.get(toolId);
      if (toolFollowUps) {
        for (const [fuToolId, data] of toolFollowUps) {
          followUps[fuToolId] = { offered: data.count, toolId: data.toolId };
          totalFollowUpsOffered += data.count;
        }
      }

      byTool[toolId] = { instructions, followUps };
    }

    return { totalFired, totalFollowUpsOffered, byTool };
  }

  /** Get firing count for a specific instruction on a specific tool. */
  getFiringCount(toolId: string, instructionId: string): number {
    return this.firings.get(toolId)?.get(instructionId)?.count ?? 0;
  }

  /** Get all instruction IDs that fired for a tool. */
  getFiredInstructionIds(toolId: string): string[] {
    const toolFirings = this.firings.get(toolId);
    return toolFirings ? [...toolFirings.keys()] : [];
  }

  /** Serialize for inclusion in executor.getSnapshot().recorders. */
  toSnapshot(): { name: string; data: unknown } {
    return { name: 'Instructions', data: this.getSummary() };
  }

  clear(): void {
    this.firings.clear();
    this.followUps.clear();
  }
}
