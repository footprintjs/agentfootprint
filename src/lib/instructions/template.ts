/**
 * InstructionTemplate — generates LLM-facing text from resolved instructions.
 *
 * The template controls HOW instructions appear in the recency window.
 * The developer writes structured data (inject text, follow-up bindings).
 * The template formats it for the LLM.
 *
 * Pluggable: organizations can customize the voice and format.
 * Default template works well for all model families.
 */

import type { ResolvedInstruction, ResolvedFollowUp } from './evaluator';

// ── Template Interface ──────────────────────────────────────────────────

/**
 * Pluggable template for formatting instructions as LLM-facing text.
 *
 * Each method is optional — unimplemented methods fall back to the default.
 *
 * @example
 * ```typescript
 * const healthcareTemplate: InstructionTemplate = {
 *   formatFollowUp: (fu) =>
 *     `If the patient requests additional information, ` +
 *     `retrieve the clinical decision audit using ${fu.toolId}.`,
 * };
 * ```
 */
export interface InstructionTemplate {
  /** Format a behavioral instruction. Default: inject text as-is. */
  formatText?(text: string): string;
  /** Format a follow-up binding. Default: structured block. */
  formatFollowUp?(followUp: ResolvedFollowUp): string;
  /** Format the full injection block (all instructions combined). */
  formatBlock?(parts: string[]): string;
}

// ── Default Template ────────────────────────────────────────────────────

/**
 * Default instruction template — works well across Claude, GPT, and Llama.
 *
 * Uses clear delimiters and structured follow-up format:
 * ```
 * [INSTRUCTION] Be empathetic. Do NOT promise reversal.
 *
 * [AVAILABLE ACTION]
 * Action: Retrieve detailed denial reasoning
 * Tool: get_execution_trace
 * Parameters: {"traceId":"tr_8f3a"}
 * Use when: User asks why or wants details
 * ```
 */
function defaultFormatInject(text: string): string {
  return `[INSTRUCTION] ${text}`;
}

function defaultFormatFollowUp(fu: ResolvedFollowUp): string {
  const lines = [
    '[AVAILABLE ACTION]',
    `Action: ${fu.description}`,
    `Tool: ${fu.toolId}`,
    `Parameters: ${JSON.stringify(fu.params)}`,
    `Use when: ${fu.condition}`,
  ];
  return lines.join('\n');
}

function defaultFormatBlock(parts: string[]): string {
  return parts.join('\n\n');
}

// ── Render Function ─────────────────────────────────────────────────────

/**
 * Render resolved instructions into LLM-facing text.
 *
 * Takes the output of `evaluateInstructions()` (already sorted in injection order)
 * and produces a single string to append to the tool result message.
 *
 * Returns `undefined` if no instructions have injectable content.
 *
 * @example
 * ```typescript
 * const fired = evaluateInstructions(tool.instructions, ctx);
 * const text = renderInstructions(fired);
 * if (text) {
 *   toolResultMessage.content += '\n\n' + text;
 * }
 * ```
 */
export function renderInstructions(
  instructions: ResolvedInstruction[],
  template?: InstructionTemplate,
): string | undefined {
  if (instructions.length === 0) return undefined;

  const formatText = template?.formatText ?? defaultFormatInject;
  const formatFollowUp = template?.formatFollowUp ?? defaultFormatFollowUp;
  const formatBlock = template?.formatBlock ?? defaultFormatBlock;

  const parts: string[] = [];

  for (const instr of instructions) {
    // Follow-up first (structured action), then inject (behavioral guidance)
    // Within each instruction, follow-up before inject so the LLM reads
    // "here's what you can do" before "here's how to behave"
    if (instr.resolvedFollowUp) {
      parts.push(formatFollowUp(instr.resolvedFollowUp));
    }
    if (instr.text) {
      parts.push(formatText(instr.text));
    }
  }

  if (parts.length === 0) return undefined;
  return formatBlock(parts);
}
