import { describe, expect, it, vi } from 'vitest';
import { projectEventSourcePosition } from '../../../src/bridge/eventSourcePosition.js';

function valid() {
  return {
    runId: 'engine/run#2',
    logRunId: 'log/run#1',
    drillPath: ['outer.part#0', 'inner/part#1'],
    committedThroughIdx: 0,
  };
}

describe('event source position projection', () => {
  it.each([-1, 0, Number.MAX_SAFE_INTEGER])('keeps the valid local index %s exactly', (index) => {
    expect(
      projectEventSourcePosition({ sourcePosition: { ...valid(), committedThroughIdx: index } }),
    ).toEqual({
      engineRunId: 'engine/run#2',
      logRunId: 'log/run#1',
      drillPath: ['outer.part#0', 'inner/part#1'],
      committedThroughIdx: index,
    });
  });

  it.each([undefined, null, false, 'position', 2, []])(
    'omits absent/non-record input %s',
    (input) => {
      expect(projectEventSourcePosition({ sourcePosition: input })).toBeUndefined();
    },
  );

  it.each([
    ['runId', undefined],
    ['runId', ''],
    ['runId', 1],
    ['logRunId', ''],
    ['logRunId', null],
    ['drillPath', 'root'],
    ['drillPath', ['']],
    ['drillPath', [1]],
    ['drillPath', new Array(1)],
    ['committedThroughIdx', -2],
    ['committedThroughIdx', 0.5],
    ['committedThroughIdx', NaN],
    ['committedThroughIdx', Infinity],
    ['committedThroughIdx', Number.MAX_SAFE_INTEGER + 1],
    ['committedThroughIdx', '0'],
  ])('rejects invalid %s = %s without repairing it', (key, value) => {
    expect(
      projectEventSourcePosition({ sourcePosition: { ...valid(), [key as string]: value } }),
    ).toBeUndefined();
  });

  it('accepts non-enumerable data fields but never reads unrelated fields', () => {
    const position = {};
    for (const [key, value] of Object.entries(valid())) {
      Object.defineProperty(position, key, { value });
    }
    const read = vi.fn(() => {
      throw new Error('unlisted data must not cross the adapter');
    });
    Object.defineProperty(position, 'extra', { get: read });
    const projected = projectEventSourcePosition({ sourcePosition: position });
    expect(projected).toEqual({
      engineRunId: 'engine/run#2',
      logRunId: 'log/run#1',
      drillPath: ['outer.part#0', 'inner/part#1'],
      committedThroughIdx: 0,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['runId', 'logRunId', 'drillPath', 'committedThroughIdx'])(
    'rejects an accessor %s without invoking it',
    (key) => {
      const position = valid();
      const read = vi.fn(() => 'must-not-read');
      Object.defineProperty(position, key, { get: read });
      expect(projectEventSourcePosition({ sourcePosition: position })).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('rejects path element accessors without invoking them', () => {
    const path = ['mount#0'];
    const read = vi.fn(() => 'mount#1');
    Object.defineProperty(path, '0', { get: read });
    expect(
      projectEventSourcePosition({ sourcePosition: { ...valid(), drillPath: path } }),
    ).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('does not accept inherited metadata on the event or inside the position', () => {
    expect(projectEventSourcePosition(Object.create({ sourcePosition: valid() }))).toBeUndefined();
    expect(projectEventSourcePosition({ sourcePosition: Object.create(valid()) })).toBeUndefined();
  });

  it('does not invoke an event-level metadata getter', () => {
    const read = vi.fn(() => valid());
    const event = Object.defineProperty({}, 'sourcePosition', { get: read });
    expect(projectEventSourcePosition(event)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('makes uninspectable metadata unplaced without affecting event delivery', () => {
    const { proxy, revoke } = Proxy.revocable(valid(), {});
    revoke();
    expect(projectEventSourcePosition({ sourcePosition: proxy })).toBeUndefined();
  });

  it('detaches only the listed fields without parsing or normalizing identities', () => {
    const position = {
      ...valid(),
      drillPath: ['same#0', 'same#0'],
      extra: { secret: 'not-retained' },
    };
    const projected = projectEventSourcePosition({ sourcePosition: position });
    expect(projected).toEqual({
      engineRunId: 'engine/run#2',
      logRunId: 'log/run#1',
      drillPath: ['same#0', 'same#0'],
      committedThroughIdx: 0,
    });
    expect(projected?.drillPath).not.toBe(position.drillPath);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected?.drillPath)).toBe(true);
  });
});
