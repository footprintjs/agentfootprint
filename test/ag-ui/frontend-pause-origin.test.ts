/**
 * Which pause waits on the PAGE is read from where it came from.
 *
 * An AG-UI frontend tool pauses with `{ agUiFrontendTool: name }`, and the
 * host asks the adapter (`awaitsCaller`) whether the run now waits on the
 * page, which answers the call with a `tool` message, or on a person. Any
 * server tool can put the same key in its own pause data. When the key alone
 * decided, a server tool that did so handed its own call to the page to
 * answer: the page's word became that tool's result.
 *
 * Now the pause counts only when the call that raised it is one of the app's
 * declared frontend tools, read from the call's real `toolName`, which the
 * library writes over anything a tool says
 * (`ag-ui/frontendTools.ts` · `isFrontendToolPause`).
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, isPaused } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { pauseHere } from '../../src/core/pause.js';
import { agUi } from '../../src/ag-ui/index.js';
import { frontendToolBuilders } from '../../src/ag-ui/frontendTools.js';

const frontendTools = {
  pick_date: {
    description: 'the person picks a date in the page',
    inputSchema: { type: 'object', properties: {} },
  },
};

async function pauseDataOf(call: string, forged: Record<string, unknown> = {}) {
  const pickDate = frontendToolBuilders(frontendTools).get('pick_date')!();
  const agent = Agent.create({
    provider: mock({ replies: [{ toolCalls: [{ id: 'c1', name: call, args: {} }] }] }),
    model: 'mock',
  })
    .system('S')
    .tool(pickDate)
    .tool(
      defineTool({
        name: 'lookup',
        description: 'a server tool',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => pauseHere({ question: 'which date?', ...forged }),
      }),
    )
    .build();
  const out = await agent.run({ message: 'go' });
  if (!isPaused(out)) throw new Error('expected a pause');
  return out.pauseData;
}

describe('a pause waits on the page only when a declared frontend tool raised it', () => {
  const adapter = agUi({ frontendTools });

  it("the app's frontend tool waits on the page (control)", async () => {
    expect(adapter.awaitsCaller?.(await pauseDataOf('pick_date'))).toBe(true);
  });

  it('a server tool naming a frontend tool in its pause data waits on a person', async () => {
    const data = await pauseDataOf('lookup', { agUiFrontendTool: 'pick_date' });
    expect(data).toMatchObject({ toolName: 'lookup', agUiFrontendTool: 'pick_date' });
    expect(adapter.awaitsCaller?.(data)).toBe(false);
  });

  it('a server tool naming itself waits on a person', async () => {
    const data = await pauseDataOf('lookup', { agUiFrontendTool: 'lookup' });
    expect(adapter.awaitsCaller?.(data)).toBe(false);
  });

  it('an adapter that declared no frontend tool never waits on the page', async () => {
    expect(agUi().awaitsCaller?.(await pauseDataOf('pick_date'))).toBe(false);
  });
});
