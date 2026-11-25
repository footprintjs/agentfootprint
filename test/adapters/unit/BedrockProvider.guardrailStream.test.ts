import { describe, expect, it } from 'vitest';
import type { LLMChunk } from '../../../src/provider-contract/types.js';
import {
  assessment,
  eventsFor,
  fixture,
  guardrail,
  pii,
  publicText,
  read,
  request,
  textDelta,
  trace,
  usage,
} from './bedrockGuardrailFixtures.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('Bedrock guardrail stream admission boundary', () => {
  for (const action of ['ANONYMIZED', 'BLOCKED'] as const) {
    it(`${action}: releases no content until post-stop metadata and natural end`, async () => {
      const afterText = deferred<void>();
      const allowStop = deferred<void>();
      const afterMetadata = deferred<void>();
      const allowEnd = deferred<void>();
      const fx = fixture({
        stream: async function* () {
          yield textDelta();
          afterText.resolve();
          await allowStop.promise;
          yield { messageStop: { stopReason: 'guardrail_intervened' } };
          yield { metadata: { usage, trace: trace(assessment(pii(action))) } };
          afterMetadata.resolve();
          await allowEnd.promise;
        },
      });
      const seen: LLMChunk[] = [];
      let ended = false;
      const reading = (async () => {
        for await (const chunk of fx.provider.stream!(request)) seen.push(chunk);
        ended = true;
      })();
      // Promise handshakes are controlled event evidence, not elapsed-time
      // guesses. Each checkpoint is reached only after its preceding yield.
      try {
        await afterText.promise;
        expect(seen).toEqual([]);
        expect(ended).toBe(false);
        allowStop.resolve();
        await afterMetadata.promise;
        expect(seen).toEqual([]);
        expect(ended).toBe(false);
      } finally {
        allowStop.resolve();
        allowEnd.resolve();
        await reading;
      }
      const result = seen.at(-1)?.response as {
        content: string;
        intervention?: { outcome: string };
      };
      expect(result.intervention?.outcome).toBe(action === 'ANONYMIZED' ? 'masked' : 'blocked');
      expect(
        seen
          .filter((chunk) => !chunk.done)
          .map((chunk) => chunk.content)
          .join(''),
      ).toBe(action === 'ANONYMIZED' ? publicText : '');
      expect(fx.send).toHaveBeenCalledTimes(1);
    });
  }

  it.each([
    ['no messageStop', [textDelta(), { metadata: { usage } }]],
    ['no metadata', [textDelta(), { messageStop: { stopReason: 'end_turn' } }]],
    ['empty terminal', [textDelta(), { messageStop: {} }, { metadata: { usage } }]],
    [
      'malformed metadata',
      [textDelta(), { messageStop: { stopReason: 'end_turn' } }, { metadata: null }],
    ],
    [
      'metadata before terminal only',
      [textDelta(), { metadata: { usage } }, { messageStop: { stopReason: 'end_turn' } }],
    ],
  ])('%s is an unknown outcome with no released content and one send', async (_name, events) => {
    const fx = fixture({ events: events as unknown[] });
    const { result, chunks } = await read(fx.provider, 'stream');
    expect(result.intervention?.outcome).toBe('unknown');
    expect(result.content).toBe('');
    expect(chunks.filter((chunk) => !chunk.done)).toEqual([]);
    expect(fx.send).toHaveBeenCalledTimes(1);
  });

  it('a missing stream never sends a fallback Converse request', async () => {
    const fx = fixture({ missingStream: true });
    const { result, chunks } = await read(fx.provider, 'stream');
    expect(result.intervention?.outcome).toBe('unknown');
    expect(result.content).toBe('');
    expect(chunks.filter((chunk) => !chunk.done)).toEqual([]);
    expect(fx.send).toHaveBeenCalledTimes(1);
  });

  for (const disposition of ['BLOCKED', undefined] as const) {
    it(`${
      disposition ?? 'unknown'
    } classification precedes malformed tool argument parsing`, async () => {
      const evidence = disposition ? trace(assessment(pii(disposition))) : undefined;
      const fx = fixture({
        events: eventsFor(evidence, 'guardrail_intervened', [
          {
            contentBlockStart: {
              contentBlockIndex: 1,
              start: { toolUse: { toolUseId: 't1', name: 'act' } },
            },
          },
          {
            contentBlockDelta: {
              contentBlockIndex: 1,
              delta: { toolUse: { input: '{PRIVATE_BROKEN_JSON' } },
            },
          },
          { contentBlockStop: { contentBlockIndex: 1 } },
        ]),
      });
      const { result } = await read(fx.provider, 'stream');
      expect(result.intervention?.outcome).toBe(disposition ? 'blocked' : 'unknown');
      expect(result.toolCalls).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_BROKEN_JSON');
      expect(fx.send).toHaveBeenCalledTimes(1);
    });
  }

  it('masking-only retains ordinary tool argument validation', async () => {
    const fx = fixture({
      events: eventsFor(trace(assessment(pii('ANONYMIZED'))), 'guardrail_intervened', [
        {
          contentBlockStart: {
            contentBlockIndex: 1,
            start: { toolUse: { toolUseId: 't1', name: 'act' } },
          },
        },
        { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '{' } } } },
        { contentBlockStop: { contentBlockIndex: 1 } },
      ]),
    });
    await expect(read(fx.provider, 'stream')).rejects.toMatchObject({
      code: 'BEDROCK_MALFORMED_TOOL_ARGS',
    });
    expect(fx.send).toHaveBeenCalledTimes(1);
  });

  it('accepts an exact UTF-8 buffer fit and returns the exact SDK text', async () => {
    const text = 'é🙂'; // Six UTF-8 bytes, three UTF-16 code units.
    const fx = fixture({
      guardrail: { ...guardrail, maxBufferedBytes: 6 },
      events: eventsFor(trace(assessment(pii('ANONYMIZED'))), 'guardrail_intervened', [
        textDelta(text),
      ]),
    });
    const { result } = await read(fx.provider, 'stream');
    expect(result.content).toBe(text);
    expect(result.intervention?.outcome).toBe('masked');
    expect(fx.send).toHaveBeenCalledTimes(1);
  });

  it('UTF-8 overflow refuses before release without truncating or resending', async () => {
    const fx = fixture({
      guardrail: { ...guardrail, maxBufferedBytes: 5 },
      events: eventsFor(undefined, 'end_turn', [textDelta('é🙂')]),
    });
    const seen: LLMChunk[] = [];
    let failure: unknown;
    try {
      for await (const chunk of fx.provider.stream!(request)) seen.push(chunk);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(seen).toEqual([]);
    expect(String(failure)).not.toContain('é🙂');
    expect(fx.send).toHaveBeenCalledTimes(1);
  });

  it('counts held tool fragments as buffered bytes before parsing', async () => {
    const fx = fixture({
      guardrail: { ...guardrail, maxBufferedBytes: 3 },
      events: eventsFor(trace(assessment(pii('BLOCKED'))), 'guardrail_intervened', [
        {
          contentBlockStart: {
            contentBlockIndex: 1,
            start: { toolUse: { toolUseId: 't1', name: 'act' } },
          },
        },
        { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '1234' } } } },
        { contentBlockStop: { contentBlockIndex: 1 } },
      ]),
    });
    await expect(read(fx.provider, 'stream')).rejects.toBeInstanceOf(Error);
    expect(fx.send).toHaveBeenCalledTimes(1);
  });

  it('SDK failure after a held prefix retains transport category/cause and releases nothing', async () => {
    const sdkError = Object.assign(new Error('connection lost'), { name: 'NetworkingError' });
    const fx = fixture({
      stream: async function* () {
        yield textDelta();
        throw sdkError;
      },
    });
    const seen: LLMChunk[] = [];
    let failure: unknown;
    try {
      for await (const chunk of fx.provider.stream!(request)) seen.push(chunk);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: 'BedrockProviderError', cause: sdkError });
    expect(failure).not.toHaveProperty('intervention');
    expect(seen).toEqual([]);
    expect(fx.send).toHaveBeenCalledTimes(1);
  });

  it('caller abort after a held prefix keeps its category and closes the stream without resend', async () => {
    const controller = new AbortController();
    const abort = new DOMException('caller stopped', 'AbortError');
    let closed = 0;
    const fx = fixture({
      stream: async function* () {
        try {
          yield textDelta();
          controller.abort(abort);
          yield { messageStop: { stopReason: 'end_turn' } };
        } finally {
          closed++;
        }
      },
    });
    const seen: LLMChunk[] = [];
    let failure: unknown;
    try {
      for await (const chunk of fx.provider.stream!({ ...request, signal: controller.signal })) {
        seen.push(chunk);
      }
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual([]);
    expect(closed).toBe(1);
    expect(fx.send).toHaveBeenCalledTimes(1);
  });
});
