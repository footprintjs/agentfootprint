/**
 * dangling-reference at the compose seam — a served tool whose declared
 * argument ground has LEFT the window (T7's decidable fragment).
 *
 * The measured failure (already pinned in window-drop-observations.test.ts):
 * a model whose `whats_here` result had been evicted assembled a plausible
 * id from memory, was refused, and spent actions on it. 9.57.0 made the
 * DROP speak; this makes the next COMPOSITION answerable for it: a tool
 * that declared `argumentsFrom: ['whats_here']` is still being offered
 * while the results that ground its arguments are gone from the window and
 * not re-established.
 *
 * The fences matter as much as the detection: a ground that was NEVER
 * dropped is silent even when no result is present (the model simply has
 * not called it yet — offering the dependent tool is legitimate); a
 * re-fetched ground (fresh result in the window) is silent however many
 * drops preceded it; no declaration, no check — zero-delta.
 *
 * Test types (Convention 3): unit (the check + fences, the declaration
 * door) / functional (the live loop: evicted ground files ONE finding) /
 * regression (identity dedup across post-drop iterations; undeclared runs
 * byte-silent).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { danglingReferencesOf } from '../../src/integrity/dangling-reference/check.js';
import { Agent, slidingWindow, defineTool } from '../../src/index.js';
import type { LLMMessage, LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import type { AgentRunCheckpoint } from '../../src/index.js';
import type { WindowRecord } from '../../src/core/agent/window/types.js';

// ---------------------------------------------------------------------------
// The check, on its own
// ---------------------------------------------------------------------------

const served = (name: string, ...argumentsFrom: string[]) => ({ name, argumentsFrom });

describe('unit: danglingReferencesOf and its fences', () => {
  it('a served tool whose ground was dropped and not re-established → one finding', () => {
    const found = danglingReferencesOf(
      [served('screen_fire', 'whats_here')],
      new Set(['whats_here']),
      new Set(),
      4,
    );
    expect(found).toHaveLength(1);
    const f = found[0]!;
    expect(f.kind).toBe('dangling-reference');
    expect(f.seam).toBe('compose');
    expect(f.epoch).toBe(4);
    expect(f.subjects).toContainEqual({ kind: 'tool', id: 'screen_fire' });
    expect(f.subjects).toContainEqual({ kind: 'tool', id: 'whats_here' });
    expect(f.message).toContain('whats_here');
  });

  it('a ground never dropped is silent — not-yet-grounded is legitimate', () => {
    expect(
      danglingReferencesOf([served('screen_fire', 'whats_here')], new Set(), new Set(), 4),
    ).toEqual([]);
  });

  it('a re-fetched ground is silent, however many drops preceded it', () => {
    expect(
      danglingReferencesOf(
        [served('screen_fire', 'whats_here')],
        new Set(['whats_here']),
        new Set(['whats_here']),
        4,
      ),
    ).toEqual([]);
  });

  it('one finding per served tool, naming every missing ground it declared', () => {
    const found = danglingReferencesOf(
      [served('screen_fire', 'whats_here', 'pan_view'), served('other', 'whats_here')],
      new Set(['whats_here', 'pan_view']),
      new Set(),
      4,
    );
    expect(found).toHaveLength(2);
    expect(found[0]!.message).toContain('whats_here');
    expect(found[0]!.message).toContain('pan_view');
  });

  it('a tool declaring nothing is never this check’s subject', () => {
    expect(
      danglingReferencesOf([{ name: 'plain', argumentsFrom: [] }], new Set(['x']), new Set(), 4),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The declaration door
// ---------------------------------------------------------------------------

describe('unit: the argumentsFrom declaration is refused when malformed', () => {
  const base = {
    description: 'd',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'ok',
  };

  it('a blank name in the list joins the wrong subjects — refused, naming the tool', () => {
    expect(() => defineTool({ ...base, name: 'screen_fire', argumentsFrom: [''] })).toThrow(
      /argumentsFrom/,
    );
  });

  it('a tool grounded by itself is a declaration nobody could have meant', () => {
    expect(() =>
      defineTool({ ...base, name: 'screen_fire', argumentsFrom: ['screen_fire'] }),
    ).toThrow(/itself/);
  });

  it('an empty list is refused — omitting the field is how "no grounds" is said', () => {
    expect(() => defineTool({ ...base, name: 'screen_fire', argumentsFrom: [] })).toThrow(
      /argumentsFrom/,
    );
  });

  it('the declared edge rides the Tool', () => {
    const t = defineTool({ ...base, name: 'screen_fire', argumentsFrom: ['whats_here'] });
    expect(t.argumentsFrom).toEqual(['whats_here']);
  });
});

// ---------------------------------------------------------------------------
// Through the live loop
// ---------------------------------------------------------------------------

const TASK = 'Walk the whole floor and tell me which rack is hottest.';

function bigGround() {
  return defineTool({
    name: 'whats_here',
    description: 'lists the valid ids on this screen',
    inputSchema: { type: 'object', properties: {} },
    execute: () => `IDS ${'x'.repeat(600)}`,
  });
}

function firesAtIds(withGrounding: boolean) {
  return defineTool({
    name: 'screen_fire',
    description: 'fires one of the ids whats_here listed',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'fired',
    ...(withGrounding && { argumentsFrom: ['whats_here'] }),
  });
}

/** One whats_here call, then filler screen_fire rounds that age it out. */
function scriptedProvider(rounds: number): LLMProvider {
  let call = 0;
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => {
      call++;
      if (call > rounds) {
        return {
          content: 'done',
          toolCalls: [],
          usage: { input: 10, output: 5 },
          stopReason: 'end_turn',
        };
      }
      return {
        content: '',
        toolCalls: [
          call === 1
            ? { id: `h${call}`, name: 'whats_here', args: {} }
            : { id: `f${call}`, name: 'screen_fire', args: {} },
        ],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      };
    },
  };
}

function trapAgent(withGrounding: boolean) {
  const events: Array<Record<string, unknown>> = [];
  // The last-tool-result pin (9.57.0) is the shipped FIRST line of defense —
  // with it on, each tool's most recent result refuses to leave, and this
  // exact scenario never dangles. The check covers what the pin cannot:
  // agents that switched it off, and grounds older than its ceiling. So the
  // trap runs with the pin off, recreating the measured pre-9.57 failure.
  const agent = Agent.create({
    provider: scriptedProvider(8),
    model: 'm',
    maxIterations: 12,
    keepLastToolResults: false,
  })
    .tool(bigGround())
    .tool(firesAtIds(withGrounding))
    .window(slidingWindow({ keepRecentTurns: 2 }))
    .build();
  agent.on('agentfootprint.integrity.context_error', (e) => {
    events.push(e.payload as unknown as Record<string, unknown>);
  });
  return { agent, events };
}

describe('functional: the evicted ground files ONE finding through the real loop', () => {
  it('whats_here ages out while screen_fire stays offered → one dangling-reference', async () => {
    const { agent, events } = trapAgent(true);
    await agent.run({ message: TASK });
    const dangling = events.filter((e) => e.kind === 'dangling-reference');
    expect(dangling).toHaveLength(1);
    expect(dangling[0]).toMatchObject({ seam: 'compose' });
    expect(String(dangling[0]!.message)).toContain('whats_here');
    expect(String(dangling[0]!.message)).toContain('screen_fire');
  });

  it('the same run with no declaration is byte-silent — zero-delta', async () => {
    const { agent, events } = trapAgent(false);
    await agent.run({ message: TASK });
    expect(events.filter((e) => e.kind === 'dangling-reference')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The narrative: the check adds no step
// ---------------------------------------------------------------------------

/**
 * Every tracked scope read is a narrative STEP ("Step 14: Read history = (6
 * items)"), and the narrative is part of the record: `getLastNarrativeEntries`,
 * the trace toolpack's `read_narrative` / `find_in_trace` (served to a model
 * under `.selfExplain()`), recordings and bug reports all carry it. The check
 * runs on every composition after a ground has left, so a second read of a
 * key the stage already holds adds a step there and renumbers every step after
 * it — on runs that never meet anything new. 9.113.0's first cut did exactly
 * that (it read `scope.history` again to see the batch settlement's marker);
 * the stage's one read at its top already holds the marker. The commit log's
 * `stageReads` is a key SET and did not move, which is why only the narrative
 * can pin this.
 *
 * The reference was generated on the 9.112.2 tree (commit f430358b, before any
 * source edit of 9.113.0) by this file in update mode:
 *
 *   AF_DANGLING_NARRATIVE_REFERENCE=update npx vitest run test/integrity/danglingReference.test.ts -t 'narrates'
 *
 * The one moving part, the turn's clock (`turnStartMs`), is masked.
 */
const NARRATIVE_REFERENCE = resolve(__dirname, 'reference/dangling-trap-narrative.json');

describe('regression: the check adds no step to the narrative', () => {
  it('the trap run narrates exactly what 9.112.2 narrated, step for step', async () => {
    const { agent, events } = trapAgent(true);
    await agent.run({ message: TASK });
    // The trap is armed: compositions after the drop ran the check.
    expect(events.filter((e) => e.kind === 'dangling-reference')).toHaveLength(1);
    const narrative = agent
      .getLastNarrativeEntries()
      .map((entry) => entry.text.replace(/turnStartMs = \d+/g, 'turnStartMs = <clock>'));
    if (process.env.AF_DANGLING_NARRATIVE_REFERENCE === 'update') {
      mkdirSync(dirname(NARRATIVE_REFERENCE), { recursive: true });
      writeFileSync(NARRATIVE_REFERENCE, `${JSON.stringify(narrative, null, 1)}\n`);
      return;
    }
    expect(
      existsSync(NARRATIVE_REFERENCE),
      'no narrative reference — generate it on the pre-change tree',
    ).toBe(true);
    const reference = JSON.parse(readFileSync(NARRATIVE_REFERENCE, 'utf8')) as string[];
    // The reads first, so a failure names the step that moved.
    const reads = (lines: readonly string[]) => lines.filter((l) => / Read \w+/.test(l));
    expect(reads(narrative)).toEqual(reads(reference));
    expect(narrative).toEqual(reference);
  });
});

// ---------------------------------------------------------------------------
// Both sides must name a message the same way
// ---------------------------------------------------------------------------

/**
 * The check compares two name sets, and the two used to be derived by
 * DIFFERENT rules. The dropped side comes off the window ledger, which names a
 * tool result with `window/toolNames.ts` — the helper that RECOVERS the name
 * from the assistant turn that asked when the result itself does not carry
 * `toolName`. The present side read `m.toolName` directly.
 *
 * `LLMMessage.toolName` is OPTIONAL on the adapter type, and every reason it
 * can be absent is documented in that helper: a conversation restored from an
 * older release, a hand-built fixture, a host that speaks the wire shape and
 * nothing more. Such a conversation names its tools ONLY through the
 * assistant's `toolCalls[].id`. Under the old asymmetry the SAME message was
 * evidence-that-left on one side and not-present on the other, so a window
 * whose ground had been RE-FETCHED — the check's own second fence — was
 * accused of dangling. A false accusation is this family's unrecoverable
 * failure mode (see `dangling-reference/README.md`): it teaches a model to
 * re-fetch what it already has, and teaches a reader to distrust the finding.
 */
const WIRE_SHAPE_GROUND = `IDS ${'x'.repeat(600)}`;

/**
 * A conversation whose tool results carry only the `toolCallId` they answer.
 * `whats_here` is called twice: the FIRST result is old enough to be evicted,
 * the SECOND is the re-fetch and sits in the freshest turn.
 */
function wireShapeConversation(): readonly LLMMessage[] {
  return [
    { role: 'user', content: TASK },
    { role: 'assistant', content: '', toolCalls: [{ id: 'h1', name: 'whats_here', args: {} }] },
    { role: 'tool', content: WIRE_SHAPE_GROUND, toolCallId: 'h1' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'f1', name: 'screen_fire', args: {} }] },
    { role: 'tool', content: 'fired', toolCallId: 'f1' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'f2', name: 'screen_fire', args: {} }] },
    { role: 'tool', content: 'fired', toolCallId: 'f2' },
    // THE RE-FETCH — the ground is back, and the window still holds it.
    { role: 'assistant', content: '', toolCalls: [{ id: 'h2', name: 'whats_here', args: {} }] },
    { role: 'tool', content: WIRE_SHAPE_GROUND, toolCallId: 'h2' },
  ];
}

function restoredConversation(): AgentRunCheckpoint {
  return {
    version: 1,
    runId: 'run-from-an-older-release',
    history: wireShapeConversation(),
    lastCompletedIteration: 4,
    originalInput: { message: TASK },
    checkpointedAt: Date.now(),
  };
}

/** One answer, no tool calls: the run's ONE composition is the one under test. */
function answersAtOnce(): LLMProvider {
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => ({
      content: 'done',
      toolCalls: [],
      usage: { input: 10, output: 5 },
      stopReason: 'end_turn',
    }),
  };
}

function stateOf(agent: Agent): {
  compactions?: readonly WindowRecord[];
  history?: readonly LLMMessage[];
} {
  return (agent.getLastSnapshot()?.sharedState ?? {}) as {
    compactions?: readonly WindowRecord[];
    history?: readonly LLMMessage[];
  };
}

describe('regression: a re-fetched ground stays silent when the window speaks wire shape', () => {
  it('the ground the ledger recovered by name is the ground the frame recovers by name', async () => {
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: answersAtOnce(),
      model: 'm',
      maxIterations: 4,
      // Same pin-off trap as above: the check covers the agents that switched
      // the last-tool-result pin off.
      keepLastToolResults: false,
    })
      .tool(bigGround())
      .tool(firesAtIds(true))
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .build();
    agent.on('agentfootprint.integrity.context_error', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });

    await agent.run({ message: 'Which rack is hottest?', continueFrom: restoredConversation() });

    const { compactions = [], history = [] } = stateOf(agent);

    // The trap is armed: the window DID drop, and the ledger recovered the
    // ground's name from a result that never carried one.
    expect(compactions.some((r) => r.droppedObservations?.includes('whats_here'))).toBe(true);

    // And the re-fetch is right there in the assembled window — carrying no
    // `toolName`, exactly like the result the ledger just named.
    const reGrounded = history.find((m) => m.role === 'tool' && m.toolCallId === 'h2');
    expect(reGrounded).toBeDefined();
    expect(reGrounded!.toolName).toBeUndefined();
    expect(
      history.some((m) =>
        (m.toolCalls ?? []).some((c) => c.id === 'h2' && c.name === 'whats_here'),
      ),
    ).toBe(true);

    // So the second fence holds: evidence in reach, nothing to accuse.
    expect(events.filter((e) => e.kind === 'dangling-reference')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A settled sibling is not a re-fetch (9.113.0)
// ---------------------------------------------------------------------------

/**
 * When a batch of calls pauses, the resume answers each call after the paused
 * one with a fixed sentence and never runs it (`core/agent/stages/toolCalls.ts`
 * · "── The batch settlement (9.113.0)"). That message is `role: 'tool'` with a
 * `toolName`, so a reader that goes by the role would count it as the ground's
 * fresh result and file nothing. The marker `LLMMessage.notDispatched` says it
 * is no result. The request's wire never carries the marker
 * (`composeRequest.ts` · `stripFrameworkFields`), so the present side must
 * name the SERVED messages from the history, where the marker still is.
 */
function settledGroundConversation(): AgentRunCheckpoint {
  return {
    version: 1,
    runId: 'run-with-a-settled-ground',
    history: [
      { role: 'user', content: TASK },
      { role: 'assistant', content: '', toolCalls: [{ id: 'h1', name: 'whats_here', args: {} }] },
      { role: 'tool', content: WIRE_SHAPE_GROUND, toolCallId: 'h1', toolName: 'whats_here' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'f1', name: 'screen_fire', args: {} }] },
      { role: 'tool', content: 'fired', toolCallId: 'f1', toolName: 'screen_fire' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'f2', name: 'screen_fire', args: {} }] },
      { role: 'tool', content: 'fired', toolCallId: 'f2', toolName: 'screen_fire' },
      // The batch paused on q1; the resume answered it and SETTLED h2.
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'q1', name: 'collect_input', args: {} },
          { id: 'h2', name: 'whats_here', args: {} },
        ],
      },
      {
        role: 'tool',
        content: '{"status":"input_received"}',
        toolCallId: 'q1',
        toolName: 'collect_input',
      },
      {
        role: 'tool',
        content:
          "Tool 'whats_here' was not executed on that call: the run paused on call 'q1' to " +
          "'collect_input', earlier in the same batch, and resumed without executing the calls " +
          'that followed it in that batch.',
        toolCallId: 'h2',
        toolName: 'whats_here',
        notDispatched: { pausedCall: { toolCallId: 'q1', toolName: 'collect_input' } },
      },
    ],
    lastCompletedIteration: 4,
    originalInput: { message: TASK },
    checkpointedAt: Date.now(),
  };
}

describe('regression: a settled call is not a re-fetched ground', () => {
  it('the only whats_here left in the frame is a settled sentence → the ground is dangling', async () => {
    const events: Array<Record<string, unknown>> = [];
    const agent = Agent.create({
      provider: answersAtOnce(),
      model: 'm',
      maxIterations: 4,
      keepLastToolResults: false,
    })
      .tool(bigGround())
      .tool(firesAtIds(true))
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .build();
    agent.on('agentfootprint.integrity.context_error', (e) => {
      events.push(e.payload as unknown as Record<string, unknown>);
    });

    await agent.run({
      message: 'Which rack is hottest?',
      continueFrom: settledGroundConversation(),
    });

    const { compactions = [], history = [] } = stateOf(agent);
    // The trap is armed: the real ground left, the settled one stayed.
    expect(compactions.some((r) => r.droppedObservations?.includes('whats_here'))).toBe(true);
    expect(history.some((m) => m.toolCallId === 'h1')).toBe(false);
    expect(history.find((m) => m.toolCallId === 'h2')?.notDispatched).toBeDefined();

    const dangling = events.filter((e) => e.kind === 'dangling-reference');
    expect(dangling).toHaveLength(1);
    expect(String(dangling[0]!.message)).toContain('whats_here');
    expect(String(dangling[0]!.message)).toContain('screen_fire');
  });
});
