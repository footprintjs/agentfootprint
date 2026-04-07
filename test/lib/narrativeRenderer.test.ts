/**
 * Agent NarrativeRenderer — Direct Unit Tests
 *
 * Tests each renderer method with synthetic context objects.
 * No full agent needed — validates branch coverage for methods
 * that the integration tests can't reach (decision, fork, selected,
 * delete, truncation, validation errors, subflow mode message).
 */

import { describe, it, expect } from 'vitest';
import { createAgentRenderer } from '../../src/lib/narrative';

const renderer = createAgentRenderer();

// ── renderStage ─────────────────────────────────────────────

describe('renderStage', () => {
  it('known stage name uses agent label', () => {
    expect(renderer.renderStage!({ stageName: 'CallLLM', stageNumber: 3, isFirst: false })).toBe(
      '[CallLLM] Called LLM',
    );
  });

  it('unknown stage with description uses description', () => {
    expect(
      renderer.renderStage!({
        stageName: 'Custom',
        stageNumber: 1,
        isFirst: false,
        description: 'My custom stage',
      }),
    ).toBe('[Custom] My custom stage');
  });

  it('unknown stage without description returns bare name', () => {
    expect(renderer.renderStage!({ stageName: 'Unknown', stageNumber: 1, isFirst: false })).toBe(
      '[Unknown]',
    );
  });
});

// ── renderOp ────────────────────────────────────────────────

describe('renderOp', () => {
  it('reads return null', () => {
    expect(
      renderer.renderOp!({
        type: 'read',
        key: 'result',
        rawValue: 'x',
        valueSummary: 'x',
        stepNumber: 1,
      }),
    ).toBeNull();
  });

  it('suppressed keys return null', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'loopCount',
        rawValue: 1,
        valueSummary: '1',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBeNull();
  });

  it('enrichment summary keys are suppressed (actual values shown instead)', () => {
    // llmCall, responseType, resolvedTools, promptSummary are all suppressed
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'llmCall',
        rawValue: 'gpt-4',
        valueSummary: 'gpt-4',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBeNull();
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'responseType',
        rawValue: 'final',
        valueSummary: 'final',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBeNull();
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'resolvedTools',
        rawValue: 'search',
        valueSummary: 'search',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBeNull();
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'promptSummary',
        rawValue: '1 system, 1 user',
        valueSummary: '1 system, 1 user',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBeNull();
  });

  it('systemPrompt shows actual text', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'systemPrompt',
        rawValue: 'You are helpful.',
        valueSummary: '"You are helpful."',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('System prompt: "You are helpful."');
  });

  it('systemPrompt truncated at 200 chars', () => {
    const long = 'A'.repeat(250);
    const result = renderer.renderOp!({
      type: 'write',
      key: 'systemPrompt',
      rawValue: long,
      valueSummary: long,
      operation: 'set',
      stepNumber: 1,
    });
    expect(result).toBe(`System prompt: "${'A'.repeat(200)}..."`);
  });

  it('systemPrompt empty or missing', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'systemPrompt',
        rawValue: '',
        valueSummary: '""',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('System prompt: (none)');
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'systemPrompt',
        rawValue: null,
        valueSummary: 'null',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('System prompt: (none)');
  });

  it('toolDescriptions shows tool names', () => {
    const tools = [{ name: 'search' }, { name: 'calculate' }];
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'toolDescriptions',
        rawValue: tools,
        valueSummary: '(2 items)',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Tools: [search, calculate]');
  });

  it('toolDescriptions empty', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'toolDescriptions',
        rawValue: [],
        valueSummary: '(0 items)',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Tools: (none)');
  });

  it('parsedResponse tool_calls shows tool names', () => {
    const parsed = {
      hasToolCalls: true,
      toolCalls: [{ name: 'search' }, { name: 'rank' }],
      content: '',
    };
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'parsedResponse',
        rawValue: parsed,
        valueSummary: '(object)',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Parsed: tool_calls → [search, rank]');
  });

  it('parsedResponse final shows content preview', () => {
    const parsed = { hasToolCalls: false, toolCalls: [], content: 'The answer is 42.' };
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'parsedResponse',
        rawValue: parsed,
        valueSummary: '(object)',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Parsed: final → "The answer is 42."');
  });

  it('parsedResponse final truncated at 100 chars', () => {
    const parsed = { hasToolCalls: false, toolCalls: [], content: 'X'.repeat(150) };
    const result = renderer.renderOp!({
      type: 'write',
      key: 'parsedResponse',
      rawValue: parsed,
      valueSummary: '(object)',
      operation: 'set',
      stepNumber: 1,
    });
    expect(result).toBe(`Parsed: final → "${'X'.repeat(100)}..."`);
  });

  it('parsedResponse unknown shape', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'parsedResponse',
        rawValue: {},
        valueSummary: '(object)',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Parsed: (unknown)');
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'parsedResponse',
        rawValue: null,
        valueSummary: 'null',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Parsed: (unknown)');
  });

  it('delete operation renders as "Cleared"', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'tempData',
        rawValue: undefined,
        valueSummary: 'undefined',
        operation: 'delete',
        stepNumber: 1,
      }),
    ).toBe('Cleared tempData');
  });

  it('messages with roles get breakdown', () => {
    const msgs = [{ role: 'system' }, { role: 'user' }, { role: 'assistant' }];
    const result = renderer.renderOp!({
      type: 'write',
      key: 'messages',
      rawValue: msgs,
      valueSummary: '(3 items)',
      operation: 'set',
      stepNumber: 1,
    });
    expect(result).toContain('Messages: 3');
    expect(result).toContain('1 system');
    expect(result).toContain('1 user');
    expect(result).toContain('1 assistant');
  });

  it('empty messages array', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'messages',
        rawValue: [],
        valueSummary: '(0 items)',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Messages: (empty)');
  });

  it('messages with non-array value', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'messages',
        rawValue: null,
        valueSummary: 'null',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Messages: (empty)');
  });

  it('result truncated at 100 chars', () => {
    const long = 'A'.repeat(150);
    const result = renderer.renderOp!({
      type: 'write',
      key: 'result',
      rawValue: long,
      valueSummary: long,
      operation: 'set',
      stepNumber: 1,
    });
    expect(result).toBe(`Result: "${'A'.repeat(100)}..."`);
  });

  it('result empty string', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'result',
        rawValue: '',
        valueSummary: '',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Result: (empty)');
  });

  it('result non-string', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'result',
        rawValue: 42,
        valueSummary: '42',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Result: (non-string)');
  });

  it('message key (subflow mode) formats as User quote', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'message',
        rawValue: 'hello world',
        valueSummary: 'hello world',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('User: "hello world"');
  });

  it('message key truncated at 100 chars', () => {
    const long = 'B'.repeat(150);
    const result = renderer.renderOp!({
      type: 'write',
      key: 'message',
      rawValue: long,
      valueSummary: long,
      operation: 'set',
      stepNumber: 1,
    });
    expect(result).toBe(`User: "${'B'.repeat(100)}..."`);
  });

  it('default write uses "Set" for set operation', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'customKey',
        rawValue: 'val',
        valueSummary: '"val"',
        operation: 'set',
        stepNumber: 1,
      }),
    ).toBe('Set customKey = "val"');
  });

  it('default write uses "Updated" for update operation', () => {
    expect(
      renderer.renderOp!({
        type: 'write',
        key: 'customKey',
        rawValue: 'val',
        valueSummary: '"val"',
        operation: 'update',
        stepNumber: 1,
      }),
    ).toBe('Updated customKey = "val"');
  });
});

// ── renderSubflow ───────────────────────────────────────────

describe('renderSubflow', () => {
  it('entry with known name uses agent label', () => {
    expect(renderer.renderSubflow!({ name: 'SystemPrompt', direction: 'entry' })).toBe(
      'Preparing system prompt',
    );
  });

  it('entry with unknown name uses generic', () => {
    expect(renderer.renderSubflow!({ name: 'CustomFlow', direction: 'entry' })).toBe(
      'Entering CustomFlow',
    );
  });

  it('exit uses "Done: name"', () => {
    expect(renderer.renderSubflow!({ name: 'SystemPrompt', direction: 'exit' })).toBe(
      'Done: SystemPrompt',
    );
  });
});

// ── renderLoop ──────────────────────────────────────────────

describe('renderLoop', () => {
  it('formats iteration number', () => {
    expect(renderer.renderLoop!({ target: 'call-llm', iteration: 3 })).toBe(
      'Tool loop iteration 3: re-calling LLM',
    );
  });
});

// ── renderBreak ─────────────────────────────────────────────

describe('renderBreak', () => {
  it('uses agent terminology', () => {
    expect(renderer.renderBreak!({ stageName: 'HandleResponse' })).toBe(
      'Agent completed at HandleResponse',
    );
  });
});

// ── renderError ─────────────────────────────────────────────

describe('renderError', () => {
  it('basic error', () => {
    expect(renderer.renderError!({ stageName: 'CallLLM', message: 'timeout' })).toBe(
      'Error at CallLLM: timeout',
    );
  });

  it('error with validation issues', () => {
    expect(
      renderer.renderError!({
        stageName: 'ParseResponse',
        message: 'invalid',
        validationIssues: 'missing field "content"',
      }),
    ).toBe('Error at ParseResponse: invalid (missing field "content")');
  });
});

// ── renderDecision ──────────────────────────────────────────

describe('renderDecision', () => {
  it('with rationale', () => {
    expect(
      renderer.renderDecision!({
        decider: 'route',
        chosen: 'toolCall',
        rationale: 'has tool_calls in response',
      }),
    ).toBe('Chose toolCall (has tool_calls in response)');
  });

  it('with description (no rationale)', () => {
    // rationale absent → concise "Chose X" (description already in stage header)
    expect(
      renderer.renderDecision!({
        decider: 'route',
        chosen: 'final',
        description: 'Route based on response type',
      }),
    ).toBe('Chose final');
  });

  it('bare (no rationale or description)', () => {
    expect(renderer.renderDecision!({ decider: 'route', chosen: 'error' })).toBe('Chose error');
  });
});

// ── renderFork ──────────────────────────────────────────────

describe('renderFork', () => {
  it('lists children', () => {
    expect(renderer.renderFork!({ children: ['search', 'summarize', 'rank'] })).toBe(
      'Parallel: search, summarize, rank',
    );
  });
});

// ── renderSelected ──────────────────────────────────────────

describe('renderSelected', () => {
  it('shows selected out of total', () => {
    expect(renderer.renderSelected!({ selected: ['search', 'rank'], total: 5 })).toBe(
      'Selected 2/5: search, rank',
    );
  });
});
