/**
 * Shared LLMProvider factory for every example in this folder.
 *
 * Examples are pure references: they accept a `provider` parameter and
 * fall back to this helper when none is injected. Switching the
 * default provider for the entire example suite (Mock → OpenAI →
 * Anthropic → Browser adapter) is a one-file edit.
 *
 * The helper is **kind-aware**: each example category gets a sensible
 * default mock setup so the example body stays one line:
 *
 *   • 'core'       — single LLM call, simple echo. Tests stream
 *                    plumbing without scripted theatrics.
 *   • 'core-flow'  — composition primitives (Sequence/Parallel/...).
 *                    Default reply is short; consumers override
 *                    `reply` per LLMCall.
 *   • 'feature'    — Agent + tools / pause / observability / cost.
 *                    Default `respond` simulates a "tool call → final
 *                    answer" flow by inspecting the request: if tools
 *                    are present and no tool result has come back yet,
 *                    call the first tool with empty args; otherwise
 *                    return a generic final.
 *   • 'pattern'    — multi-perspective demos (debate, reflection,
 *                    swarm). Default is the same as 'core'; consumers
 *                    pass a custom `respond` so the demo shows varied
 *                    per-turn output.
 *
 * Real-provider swap point: edit the body of `exampleProvider()` to
 * return your provider of choice. The kind parameter is mock-specific
 * and SHOULD be ignored when switching to a real LLM (the LLM answers
 * the request — no scripted behaviour needed).
 *
 * @example  Switch the entire example suite to OpenAI
 * ```ts
 * import { OpenAI } from 'openai';
 * export function exampleProvider(): LLMProvider {
 *   const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
 *   return { name: 'openai-gpt-4o', complete: async (req) => { ... } };
 * }
 * ```
 */

import {
  MockProvider,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type MockProviderOptions,
} from '../../src/index.js';

/** Example category — drives the default mock setup. */
export type ExampleKind = 'core' | 'core-flow' | 'feature' | 'pattern';

/**
 * Build the default LLMProvider used by every example.
 *
 * Mock mode (current default): returns a `MockProvider.realistic()`
 * instance — random `[3000, 8000] ms` thinking latency, word-by-word
 * `[30, 80] ms` chunk streaming, AbortSignal-aware. The `kind`
 * parameter selects a sensible default `respond` so most examples
 * don't need to write one. Pass `opts` to override any field.
 *
 * Real mode: edit this function to return your provider of choice.
 * Both `kind` and `opts` SHOULD be ignored when switching to a real
 * provider (the LLM answers the prompt — no scripting).
 */
export function exampleProvider(
  kind: ExampleKind = 'core',
  opts: MockProviderOptions = {},
): LLMProvider {
  // ── MOCK DEFAULT ─────────────────────────────────────────────
  return MockProvider.realistic({
    ...presetFor(kind),
    ...opts, // explicit overrides win
  });

  // ── REAL PROVIDER (commented examples) ───────────────────────
  // OpenAI:
  //   const { OpenAI } = await import('openai');
  //   const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  //   return { name: 'openai-gpt-4o', complete: async (req) => { ... } };
  //
  // Anthropic:
  //   const Anthropic = (await import('@anthropic-ai/sdk')).default;
  //   const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  //   return { name: 'claude-sonnet-4', complete: async (req) => { ... } };
}

/** Per-kind preset for the realistic mock. */
function presetFor(kind: ExampleKind): MockProviderOptions {
  switch (kind) {
    case 'core':
      // Single-shot echo. The default `respond` (last-user-message
      // echo) inside MockProvider already handles this — nothing
      // extra needed.
      return {};
    case 'core-flow':
      // Composition primitives: a generic short reply when the
      // example doesn't override. Most core-flow examples DO
      // override per LLMCall.
      return { reply: 'ok' };
    case 'feature':
      // Agent + tool flows: simulate "tool call → final answer"
      // automatically. Examples drop their inline scripted respond.
      return { respond: smartToolCallFlow };
    case 'pattern':
      // Multi-perspective patterns (debate, reflection, swarm)
      // typically need scripted per-turn output to demo the pattern.
      // Default to no-op; the example provides its own `respond`.
      return {};
  }
}

/**
 * Smart default `respond` for `'feature'` examples.
 *
 * Inspects the request:
 *   • Tools present + no tool result yet → call the FIRST tool.
 *     `toolCallId` is stable so the `tool.end` event correlates with
 *     the `tool.start` cleanly.
 *   • Otherwise → return a terse final answer.
 *
 * Result: a feature example that registers a tool and runs through
 * "Agent calls it → tool runs (or pauses) → resume / second turn →
 * final" behaves correctly with zero per-example scripting.
 *
 * Tools that need specific argument shapes can pass their own
 * `respond` via `exampleProvider('feature', { respond: ... })`.
 */
function smartToolCallFlow(req: LLMRequest): Partial<LLMResponse> {
  const tools = req.tools ?? [];
  // Find the LATEST tool result in messages — that's what the LLM is
  // "reasoning" about on this turn. The findLast pattern matches a
  // real LLM consuming the most recent tool result.
  const lastToolResult = [...req.messages].reverse().find((m) => m.role === 'tool');

  if (!lastToolResult && tools.length > 0) {
    // Iteration 1 with tools available — call the first one.
    const tool = tools[0];
    return {
      content: '',
      toolCalls: [
        {
          id: `call-${tool.name}-1`,
          name: tool.name,
          args: {},
        },
      ],
    };
  }
  // After a tool result lands, fold it into a meaningful final answer
  // instead of a generic "Done." Real LLMs echo / paraphrase the tool
  // output; the smart-default mirrors that so demos read naturally
  // ("Got it — Approved by ops" instead of "Done.").
  if (lastToolResult) {
    const result = String(lastToolResult.content ?? '').trim();
    if (result.length > 0) {
      return { content: `Got it — ${result}` };
    }
  }
  return { content: 'Done.' };
}
