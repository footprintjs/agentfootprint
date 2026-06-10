/**
 * 06 — Tool-args validation: reject malformed calls, let the model retry.
 *
 * The LLM writes tool args as free-form JSON; nothing used to guarantee
 * they matched the schema the tool advertised. With `toolArgValidation`
 * (default `'enforce'`), args are validated against the tool's
 * `inputSchema` BEFORE dispatch: a mismatch rejects the call, the model
 * receives a structured retry message as the tool result (paths +
 * expected shapes + received TYPES — never the supplied values), and
 * corrects itself on the next iteration. Emits
 * `agentfootprint.validation.args_invalid`.
 *
 * Modes: 'enforce' (default) | 'warn' (event only, executes anyway) | 'off'.
 *
 * Run:  npx tsx examples/features/06-tool-args-validation.ts
 */

import { Agent, defineTool } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/06-tool-args-validation',
  title: 'Tool-args validation — model-visible retry',
  group: 'features',
  description:
    "LLM-produced tool args are validated against the tool's inputSchema before dispatch (default 'enforce'). Mismatches reject the call with a structured retry message; the model self-corrects next iteration.",
  defaultInput: 'echo the word hello three times',
  providerSlots: ['default'],
  tags: ['feature', 'validation', 'reliability'],
};

export async function run(
  input: string,
  provider?: import('../../src/index.js').LLMProvider,
): Promise<unknown> {
  // Scripted mock (when no real provider given): first call sends BAD args
  // — `times` as a word, `text` missing — so the rejection + retry path is
  // deterministic and visible without an API key. After it sees the retry
  // message it sends corrected args, then finishes.
  let llmCalls = 0;
  const scripted = exampleProvider('feature', {
    respond: (req) => {
      llmCalls++;
      const lastTool = [...req.messages].reverse().find((m) => m.role === 'tool');
      if (llmCalls === 1) {
        return {
          content: 'Echoing…',
          toolCalls: [{ id: 'c1', name: 'echo', args: { times: 'three' } as never }],
          stopReason: 'tool_use',
        };
      }
      if (typeof lastTool?.content === 'string' && lastTool.content.includes('Invalid arguments')) {
        return {
          content: 'Fixing my arguments…',
          toolCalls: [{ id: 'c2', name: 'echo', args: { text: 'hello', times: 3 } }],
          stopReason: 'tool_use',
        };
      }
      return { content: `Done: ${lastTool?.content ?? ''}`, stopReason: 'end_turn' };
    },
  });

  const echo = defineTool<{ text: string; times: number }, string>({
    name: 'echo',
    description: 'Echo `text`, repeated `times` times.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What to echo.' },
        times: { type: 'integer', description: 'Repeat count.' },
      },
      required: ['text', 'times'],
    },
    execute: ({ text, times }) => Array.from({ length: times }, () => text).join(' '),
  });

  const agent = Agent.create({
    provider: provider ?? scripted,
    model: 'mock',
    // 'enforce' is the default — shown explicitly here for the example.
    toolArgValidation: 'enforce',
  })
    .system('You echo text using the echo tool.')
    .tool(echo)
    .build();

  agent.on('agentfootprint.validation.args_invalid', (e) => {
    console.log(
      `[validation] ${e.payload.toolName} rejected (enforced=${e.payload.enforced}):`,
      e.payload.issues
        .map(
          (issue) => `${issue.path || 'arguments'}: expected ${issue.expected}, got ${issue.got}`,
        )
        .join('; '),
    );
  });

  const out = await agent.run({ message: input });
  console.log('\nFinal:', out);
  return out;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
