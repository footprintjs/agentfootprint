import { afterEach, expect, it, vi } from 'vitest';
import { recordModelContext } from './recordModelContext.js';

const capture = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../redaction/runRedaction.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../redaction/runRedaction.js')>()),
  wantsRecordedContext: () => capture.enabled,
  runKeepsOut: () => false,
  emitServed: (
    scope: { $emit: (type: string, payload: unknown) => void },
    type: string,
    payload: unknown,
  ) => scope.$emit(type, payload),
}));
afterEach(() => {
  capture.enabled = false;
});

it('does not inspect a context factory when capture is off', () => {
  const emit = vi.fn();
  const read = vi.fn(() => {
    throw new Error('A disabled recorder must not read the request.');
  });
  recordModelContext({ $emit: emit }, read);
  expect(read).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

it('refuses unsupported capture without getters, thrown text or input mutation', () => {
  capture.enabled = true;
  const emit = vi.fn();
  let reads = 0;
  const inputSchema = {
    get properties() {
      reads++;
      return {};
    },
  };
  recordModelContext({ $emit: emit }, () => ({
    iteration: 1,
    systemPieces: [],
    tools: [{ name: 'lookup', description: 'lookup', inputSchema }],
  }));
  expect(reads).toBe(0);
  expect(emit).toHaveBeenCalledWith('agentfootprint.context.recorded', {
    omission: 'not-json',
    pieces: [],
  });
  expect(Object.getOwnPropertyDescriptor(inputSchema, 'properties')?.get).toBeTypeOf('function');
  emit.mockClear();
  recordModelContext({ $emit: emit }, () => {
    throw new Error('PRIVATE');
  });
  expect(emit).toHaveBeenCalledWith('agentfootprint.context.recorded', {
    omission: 'not-json',
    pieces: [],
  });
});

it('owns and freezes a complete schema without freezing the caller object', () => {
  capture.enabled = true;
  const emit = vi.fn();
  const inputSchema = { properties: { id: { type: 'string' } }, required: ['id'] };
  recordModelContext({ $emit: emit }, () => ({
    iteration: 1,
    systemPieces: [],
    tools: [{ name: 'lookup', description: 'lookup', inputSchema }],
  }));
  inputSchema.required.push('later');
  const payload = emit.mock.calls[0][1];
  expect(payload.pieces[0].schema.inputSchema.required).toEqual(['id']);
  expect(Object.isFrozen(payload.pieces[0].schema.inputSchema.required)).toBe(true);
  expect(Object.isFrozen(inputSchema.required)).toBe(false);
});
