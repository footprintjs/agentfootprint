/**
 * agUiSse — the AG-UI framing strategy.
 *
 * Pins: a frame is byte for byte what the official `@ag-ui/encoder` writes; the
 * encoder is an optional peer loaded when a framing is built, refused BY NAME
 * when absent (with the install line), and replaceable by the module a caller
 * imported (a runtime whose loader cannot reach it).
 */

import { EventEncoder } from '@ag-ui/encoder';
import { describe, expect, it, vi } from 'vitest';

import { AG_UI_ENCODER_MISSING, agUiSse } from '../../src/ag-ui/framing.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';

const loader = vi.hoisted(() => ({ failure: undefined as unknown }));

vi.mock('../../src/lib/lazyRequire.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/lazyRequire.js')>();
  return {
    lazyRequire: (specifier: string) => {
      if (loader.failure !== undefined) throw loader.failure;
      return real.lazyRequire(specifier);
    },
  };
});

const EVENTS: readonly AgUiEvent[] = [
  { type: 'RUN_STARTED', threadId: 't', runId: 'r', protocolVersion: '1.0' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'r/text/0/call-llm#5', delta: 'line one\nline "two"' },
  { type: 'CUSTOM', name: 'agentfootprint.cost.tick', value: { usd: 0.01, nested: [1, 'x'] } },
  { type: 'RUN_FINISHED', threadId: 't', runId: 'r', result: 'done' },
];

describe('agUiSse — the frames', () => {
  it('writes exactly what @ag-ui/encoder writes: one data line, under text/event-stream', () => {
    const framing = agUiSse();
    const official = new EventEncoder();
    expect(framing.contentType).toBe('text/event-stream');
    for (const event of EVENTS) {
      const frame = framing.frame(event);
      expect(frame).toBe(official.encodeSSE(event as never));
      expect(frame.startsWith('data: ')).toBe(true);
      expect(frame.endsWith('\n\n')).toBe(true);
      // A newline inside a value stays escaped: one frame, one line of data.
      expect(frame.slice(0, -2).includes('\n')).toBe(false);
      expect(JSON.parse(frame.slice('data: '.length))).toEqual(event);
    }
  });

  it('uses the encoder module a caller passes, without loading one', () => {
    loader.failure = new Error("Cannot find module '@ag-ui/encoder'");
    try {
      const frames: string[] = [];
      class StubEncoder {
        encodeSSE(event: AgUiEvent): string {
          frames.push(event.type);
          return `data: ${event.type}\n\n`;
        }
      }
      const framing = agUiSse({ encoder: { EventEncoder: StubEncoder as never } });
      expect(framing.frame(EVENTS[0]!)).toBe('data: RUN_STARTED\n\n');
      expect(frames).toEqual(['RUN_STARTED']);
    } finally {
      loader.failure = undefined;
    }
  });
});

describe('agUiSse — the optional peer', () => {
  it('refuses a missing @ag-ui/encoder by name, with the install line', () => {
    loader.failure = Object.assign(new Error("Cannot find module '@ag-ui/encoder'"), {
      code: 'MODULE_NOT_FOUND',
    });
    try {
      expect(() => agUiSse()).toThrow(AG_UI_ENCODER_MISSING);
      expect(AG_UI_ENCODER_MISSING).toContain('npm install @ag-ui/core @ag-ui/encoder');
    } finally {
      loader.failure = undefined;
    }
  });

  it('a loader that is not there (a browser bundle) is told to pass the module, not to install it', () => {
    loader.failure = new TypeError('nodeModule.createRequire is not a function');
    try {
      expect(() => agUiSse()).toThrow(/agUiSse\(\{ encoder \}\)/);
      expect(() => agUiSse()).not.toThrow(/npm install/);
    } finally {
      loader.failure = undefined;
    }
  });

  it('refuses an `encoder` that is not the @ag-ui/encoder module', () => {
    expect(() => agUiSse({ encoder: {} as never })).toThrow(/EventEncoder/);
  });
});
