/**
 * Unit tests for PermissionRecorder — audit trail for gated tool events.
 */

import { describe, it, expect } from 'vitest';
import { PermissionRecorder } from '../../src/recorders/v2/PermissionRecorder';
import type { ToolCallEvent } from '../../src/core/recorders';

describe('PermissionRecorder: onBlocked events', () => {
  it('captures resolve-phase blocks', () => {
    const recorder = new PermissionRecorder();
    recorder.onBlocked('admin', 'resolve');
    recorder.onBlocked('code', 'resolve');

    expect(recorder.getBlocked()).toEqual(['admin', 'code']);
    expect(recorder.getEvents()).toHaveLength(2);
    expect(recorder.getEvents()[0].type).toBe('blocked');
  });

  it('captures execute-phase denials', () => {
    const recorder = new PermissionRecorder();
    recorder.onBlocked('admin', 'execute');

    expect(recorder.getDenied()).toEqual(['admin']);
    expect(recorder.getEvents()[0].type).toBe('denied');
  });

  it('deduplicates tool IDs in getBlocked/getDenied', () => {
    const recorder = new PermissionRecorder();
    recorder.onBlocked('admin', 'resolve');
    recorder.onBlocked('admin', 'resolve'); // same tool, multiple turns
    recorder.onBlocked('admin', 'execute');

    expect(recorder.getBlocked()).toEqual(['admin']); // deduped
    expect(recorder.getDenied()).toEqual(['admin']);
  });
});

describe('PermissionRecorder: onToolCall (allowed)', () => {
  it('captures successful tool calls as allowed', () => {
    const recorder = new PermissionRecorder();
    const event: ToolCallEvent = {
      toolName: 'search',
      args: { query: 'test' },
      result: { content: 'results' },
      latencyMs: 10,
    };
    recorder.onToolCall(event);

    expect(recorder.getAllowed()).toEqual(['search']);
  });

  it('does not capture errored tool calls as allowed', () => {
    const recorder = new PermissionRecorder();
    const event: ToolCallEvent = {
      toolName: 'admin',
      args: {},
      result: { content: 'Permission denied', error: true },
      latencyMs: 1,
    };
    recorder.onToolCall(event);

    expect(recorder.getAllowed()).toEqual([]);
  });
});

describe('PermissionRecorder: getSummary', () => {
  it('provides complete audit summary', () => {
    const recorder = new PermissionRecorder();

    // Resolve phase: admin and code blocked
    recorder.onBlocked('admin', 'resolve');
    recorder.onBlocked('code', 'resolve');

    // Execute phase: LLM hallucinated admin call
    recorder.onBlocked('admin', 'execute');

    // Successful tool calls
    recorder.onToolCall({
      toolName: 'search',
      args: {},
      result: { content: 'ok' },
      latencyMs: 5,
    });

    const summary = recorder.getSummary();
    expect(summary.allowed).toEqual(['search']);
    expect(summary.blocked).toEqual(['admin', 'code']);
    expect(summary.denied).toEqual(['admin']);
  });
});

describe('PermissionRecorder: clear', () => {
  it('resets all events', () => {
    const recorder = new PermissionRecorder();
    recorder.onBlocked('admin', 'resolve');
    recorder.clear();

    expect(recorder.getEvents()).toHaveLength(0);
    expect(recorder.getSummary()).toEqual({ allowed: [], blocked: [], denied: [] });
  });
});
