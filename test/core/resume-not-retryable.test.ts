/**
 * `resumeOnError` stops advertising a resume that cannot work (9.6.0).
 *
 * MEASURED IN THE FIELD: a run failed because the request exceeded the
 * provider's context limit; the checkpoint error said "Pass to
 * agent.resumeOnError(checkpoint) to continue"; resume re-sent the SAME
 * oversized history and got the identical 400. A deterministic loop,
 * advertised by the library itself.
 *
 * The checkpoint is still built and still carries the conversation — that
 * history is exactly what a post-mortem needs. Only the advice changes, and
 * only for the classes where replaying the same request reproduces the same
 * refusal.
 *
 * Covers: unit (`canResume` per class), scenario (a context-length failure
 * through a real `agent.run()`), boundary (retryable classes keep today's
 * hint verbatim), security (auth failures are named without echoing the
 * credential), compat (the checkpoint shape is untouched).
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  canResume,
  ContextWindowExceededError,
  defineTool,
  RunCheckpointError,
  type AgentRunCheckpoint,
} from '../../src/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { openai } from '../../src/adapters/llm/OpenAIProvider.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';

const FIELD_MESSAGE =
  '400 Input tokens exceed the configured limit of 272000 tokens. ' +
  'Your messages resulted in 879073 tokens.';

function err(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), extra);
}

/** A minimal checkpoint — the classification is about the CAUSE, not this. */
const CHECKPOINT: AgentRunCheckpoint = {
  version: 1,
  runId: 'run-1',
  history: [{ role: 'user', content: 'hi' }],
  lastCompletedIteration: 2,
  originalInput: { message: 'hi' },
  checkpointedAt: Date.now(),
};

/**
 * The field shape: one tool round succeeds, and the request that carries the
 * tool result back is the one the provider refuses as too large.
 */
function providerThatOverflowsOnSecondCall(): LLMProvider {
  const inner = openai({
    apiKey: 'sk-test',
    _client: {
      chat: {
        completions: {
          create: () => {
            throw err(FIELD_MESSAGE, { status: 400, code: 'context_length_exceeded' });
          },
        },
      },
    } as never,
  });
  let calls = 0;
  return {
    name: 'gateway',
    carriesInMessages: ['user', 'assistant', 'system', 'tool'],
    async complete(req: LLMRequest): Promise<LLMResponse> {
      calls++;
      if (calls === 1) {
        return {
          content: 'thinking',
          toolCalls: [{ id: 'tc-1', name: 'noop', args: {} }],
          usage: { input: 10, output: 5 },
        };
      }
      // Second call goes through the REAL adapter error path, so the test
      // pins the translation and the advice together.
      return inner.complete(req);
    },
  };
}

// ── Unit — the classification ────────────────────────────────

describe('canResume — unit', () => {
  it('a context-window refusal is not resumable', () => {
    const refusal = new ContextWindowExceededError({
      provider: 'openai',
      providerMessage: FIELD_MESSAGE,
      limitTokens: 272_000,
      actualTokens: 879_073,
      status: 400,
    });
    expect(canResume(refusal)).toBe(false);
  });

  it('rejected credentials are not resumable — the replay carries the same key', () => {
    expect(canResume(err('401 Incorrect API key provided', { status: 401 }))).toBe(false);
    expect(canResume(err('403 Forbidden', { status: 403 }))).toBe(false);
    expect(
      canResume(
        err('The security token included in the request is invalid', {
          name: 'UnrecognizedClientException',
        }),
      ),
    ).toBe(false);
  });

  it('a malformed request is not resumable', () => {
    expect(canResume(err('400 model `gpt-9` does not exist', { status: 400 }))).toBe(false);
    expect(canResume(err('404 Not Found', { status: 404 }))).toBe(false);
    expect(canResume(err('422 Unprocessable Entity', { status: 422 }))).toBe(false);
  });

  it('a CUSTOM provider that never went through an adapter is classified the same', () => {
    // The field case exactly: a bare `LLMProvider` in front of a gateway. The
    // sentence is the vendor's, but no `wrapError` ever saw it — so the
    // classification reads the sentence itself rather than falling into the
    // generic "malformed request" arm and offering the wrong three fixes.
    const raw = err(FIELD_MESSAGE, { status: 400 });
    expect(canResume(raw)).toBe(false);
    expect(new RunCheckpointError(raw, CHECKPOINT).message).toContain(
      'the conversation is what did not fit',
    );
  });

  it('the transient classes resume exists for stay resumable', () => {
    expect(canResume(err('503 Service Unavailable', { status: 503 }))).toBe(true);
    expect(canResume(err('429 Rate limit reached', { status: 429 }))).toBe(true);
    expect(canResume(err('socket hang up'))).toBe(true);
    expect(canResume(err('Load failed'))).toBe(true);
    expect(canResume(undefined)).toBe(true);
  });
});

// ── Scenario — through a real run ────────────────────────────

describe('RunCheckpointError — a context-length failure', () => {
  it('says why resume cannot help, and what to do instead', async () => {
    const agent = Agent.create({
      provider: providerThatOverflowsOnSecondCall(),
      model: 'gpt-4o',
      maxIterations: 4,
    })
      .system('You are a read-only triage assistant.')
      .tool(
        defineTool({
          name: 'noop',
          description: 'returns rows',
          parameters: { type: 'object', properties: {} },
          execute: async () => ({ rows: ['a', 'b'] }),
        }),
      )
      .build();

    let thrown: unknown;
    try {
      await agent.run({ message: 'summarise the inventory report' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RunCheckpointError);
    const error = thrown as RunCheckpointError;

    expect(error.message).toContain('Resume cannot help');
    expect(error.message).toContain('the conversation is what did not fit');
    expect(error.message).toContain('slidingWindow({ keepRecentTurns: 2 })');
    expect(error.message).toContain('.compaction() cannot fold a span bigger than the window');
    expect(error.message).toContain('checkpoint.history');
    // The old advice must NOT be there — that sentence is what sent a
    // production deployment into a deterministic retry loop.
    expect(error.message).not.toContain('Pass to agent.resumeOnError(checkpoint) to continue');

    // The checkpoint is still built and still carries the conversation.
    expect(error.checkpoint.history.length).toBeGreaterThan(0);
    expect(canResume(error.cause)).toBe(false);
    expect(JSON.parse(JSON.stringify(error.checkpoint)).version).toBe(1);
  });
});

// ── Boundary / compat — retryable failures are untouched ─────

describe('RunCheckpointError — retryable failures', () => {
  it('keeps the historical hint, word for word', async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      name: 'flaky',
      async complete(req: LLMRequest): Promise<LLMResponse> {
        calls++;
        if (calls >= 2) throw err('vendor 503', { status: 503 });
        return {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'noop', args: {} }],
          usage: { input: 1, output: 1 },
        };
      },
    };
    void mock;

    const agent = Agent.create({ provider: flaky, model: 'mock', maxIterations: 4 })
      .tool(
        defineTool({
          name: 'noop',
          description: 'noop',
          parameters: { type: 'object', properties: {} },
          execute: async () => 'ok',
        }),
      )
      .build();

    let thrown: unknown;
    try {
      await agent.run({ message: 'go' });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RunCheckpointError);
    expect((thrown as RunCheckpointError).message).toContain(
      'Pass to agent.resumeOnError(checkpoint) to continue.',
    );
    expect(canResume((thrown as RunCheckpointError).cause)).toBe(true);
  });
});
