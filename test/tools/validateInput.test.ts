/**
 * Tool input validation — 5-pattern tests.
 *
 * Tests validateToolInput and its integration with executeToolCalls.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateToolInput, formatValidationErrors } from '../../src/tools/validateInput';
import { executeToolCalls } from '../../src/lib/call/helpers';
import { ToolRegistry, defineTool } from '../../src/tools/ToolRegistry';
import { userMessage } from '../../src/types';

// ── Unit ────────────────────────────────────────────────────

describe('validateToolInput — unit', () => {
  it('valid input passes', () => {
    const result = validateToolInput(
      { name: 'Alice', age: 30 },
      {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
        required: ['name'],
      },
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('missing required field fails', () => {
    const result = validateToolInput(
      { age: 30 },
      { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('name');
    expect(result.errors[0].message).toContain('missing');
  });

  it('wrong type fails', () => {
    const result = validateToolInput(
      { name: 42 },
      { type: 'object', properties: { name: { type: 'string' } } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe('name');
    expect(result.errors[0].message).toContain('Expected string');
  });

  it('integer validation works', () => {
    const schema = { type: 'object', properties: { count: { type: 'integer' } } };
    expect(validateToolInput({ count: 5 }, schema).valid).toBe(true);
    expect(validateToolInput({ count: 5.5 }, schema).valid).toBe(false);
    expect(validateToolInput({ count: 'five' }, schema).valid).toBe(false);
  });

  it('array type detection works', () => {
    const schema = { type: 'object', properties: { items: { type: 'array' } } };
    expect(validateToolInput({ items: [1, 2] }, schema).valid).toBe(true);
    expect(validateToolInput({ items: 'not-array' }, schema).valid).toBe(false);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('validateToolInput — boundary', () => {
  it('empty schema passes any input', () => {
    expect(validateToolInput({ anything: 'goes' }, {}).valid).toBe(true);
  });

  it('empty args with no required fields passes', () => {
    expect(
      validateToolInput({}, { type: 'object', properties: { x: { type: 'string' } } }).valid,
    ).toBe(true);
  });

  it('null required field fails', () => {
    const result = validateToolInput(
      { name: null },
      { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    );
    expect(result.valid).toBe(false);
  });

  it('optional missing field does not validate type', () => {
    const result = validateToolInput(
      {},
      { type: 'object', properties: { name: { type: 'string' } } },
    );
    expect(result.valid).toBe(true);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('Tool input validation — scenario (integration)', () => {
  it('executeToolCalls rejects invalid input with error message', async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'greet',
        description: 'Greet someone',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        handler: async ({ name }) => ({ content: `Hello ${name}!` }),
      }),
    );

    const result = await executeToolCalls(
      [{ id: 'tc1', name: 'greet', arguments: {} }], // missing required 'name'
      registry,
      [userMessage('hi')],
    );

    // The tool result should contain the validation error, not the handler's output
    const toolMsg = result.messages[result.messages.length - 1];
    expect(toolMsg.content).toContain('Invalid arguments');
    expect(toolMsg.content).toContain('name');
    expect(toolMsg.content).toContain('missing');
  });

  it('valid input passes through to handler', async () => {
    const handler = vi.fn(async () => ({ content: 'Hello Alice!' }));
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        id: 'greet',
        description: 'Greet',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        handler,
      }),
    );

    await executeToolCalls([{ id: 'tc1', name: 'greet', arguments: { name: 'Alice' } }], registry, [
      userMessage('hi'),
    ]);

    expect(handler).toHaveBeenCalledWith({ name: 'Alice' });
  });
});

// ── Property ────────────────────────────────────────────────

describe('validateToolInput — property', () => {
  it('multiple errors are collected', () => {
    const result = validateToolInput(
      { age: 'not-a-number' },
      {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
        required: ['name', 'age'],
      },
    );
    expect(result.errors.length).toBeGreaterThanOrEqual(2); // missing name + wrong type age
  });

  it('formatValidationErrors produces semicolon-separated string', () => {
    const errors = [
      { path: 'name', message: 'Required.' },
      { path: 'age', message: 'Wrong type.' },
    ];
    const formatted = formatValidationErrors(errors);
    expect(formatted).toBe('name: Required.; age: Wrong type.');
  });
});

// ── Security ────────────────────────────────────────────────

describe('validateToolInput — security', () => {
  it('prototype pollution keys are treated as regular fields', () => {
    const result = validateToolInput(
      { __proto__: 'evil', constructor: 'bad' },
      { type: 'object', properties: { __proto__: { type: 'string' } } },
    );
    // Should validate normally, not crash
    expect(result.valid).toBe(true);
  });

  it('validation error message does not leak schema internals', () => {
    const result = validateToolInput(
      {},
      { type: 'object', properties: { secret: { type: 'string' } }, required: ['secret'] },
    );
    // Error mentions field name but not schema structure
    expect(result.errors[0].message).toContain('secret');
    expect(result.errors[0].message).not.toContain('properties');
  });
});
