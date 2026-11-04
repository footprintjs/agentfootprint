import { beforeAll, describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor, type FlowchartCheckpoint } from 'footprintjs';

import * as checkpointReads from '../../../src/core/agent/resumeCheckpoint.js';

const TOOL_DOMAIN = 'tool-calls';
type Carrier = {
  parentOnly?: string;
  runSessionId?: string;
  consentRequest?: { requestId: string };
  evidenceRecovery?: { toolCallId: string };
  answered?: boolean;
};
type DomainReader = (
  checkpoint: FlowchartCheckpoint,
  mountId: string,
) => Record<string, unknown> | undefined;

function reader(): DomainReader {
  const candidate = (checkpointReads as unknown as { toolDomainStateOf?: DomainReader })
    .toolDomainStateOf;
  expect(typeof candidate).toBe('function');
  return candidate!;
}

let checkpoint: FlowchartCheckpoint;
let mapped = 0;

beforeAll(async () => {
  const child = flowChart<Carrier>('Enter tool domain', () => undefined, 'enter')
    .addPausableFunction(
      'Commit then ask',
      {
        execute(scope) {
          scope.runSessionId = 'domain-session';
          scope.consentRequest = { requestId: 'request-1' };
          scope.evidenceRecovery = { toolCallId: 'call-1' };
          return { question: 'Continue the scripted call?' };
        },
        resume(scope) {
          scope.answered = true;
        },
      },
      'ask',
    )
    .build();
  const root = flowChart<Carrier>(
    'Root',
    (scope) => {
      scope.parentOnly = 'root-only';
      scope.runSessionId = 'root-session';
    },
    'root',
  )
    .addSubFlowChartNext(TOOL_DOMAIN, child, 'Tool domain', {
      inputMapper: () => ({}),
      outputMapper: (state: Carrier) => {
        mapped += 1;
        return { answered: state.answered };
      },
    })
    .build();
  const executor = new FlowChartExecutor(root);
  await executor.run();
  expect(executor.isPaused()).toBe(true);
  checkpoint = executor.getCheckpoint()!;
});

describe('tool-call checkpoint domain', () => {
  it('native capture includes writes committed by the pausing leaf before output mapping', () => {
    expect(checkpoint.subflowPath).toEqual([TOOL_DOMAIN]);
    expect(checkpoint.subflowStates?.[TOOL_DOMAIN]).toMatchObject({
      runSessionId: 'domain-session',
      consentRequest: { requestId: 'request-1' },
      evidenceRecovery: { toolCallId: 'call-1' },
    });
    expect(checkpoint.sharedState).toMatchObject({
      runSessionId: 'root-session',
      parentOnly: 'root-only',
    });
    expect(checkpoint.sharedState).not.toHaveProperty('consentRequest');
    expect(mapped).toBe(0);
  });

  it('reads the exact tool domain while retaining a separate root view', () => {
    const read = reader();
    const before = JSON.stringify(checkpoint);
    const root = checkpointReads.resumeStateOf(checkpoint);
    const domain = read(checkpoint, TOOL_DOMAIN);
    expect(domain).toMatchObject({
      runSessionId: 'domain-session',
      consentRequest: { requestId: 'request-1' },
      evidenceRecovery: { toolCallId: 'call-1' },
    });
    expect(domain).not.toHaveProperty('parentOnly');
    expect(root.runSessionId).toBe('root-session');
    expect(JSON.stringify(checkpoint)).toBe(before);
  });

  it('returns no tool view when that exact mount is absent from the active path', () => {
    const read = reader();
    const outside = { ...checkpoint, subflowPath: ['other-domain'] };
    expect(read(outside, TOOL_DOMAIN)).toBeUndefined();
    expect(checkpointReads.resumeStateOf(outside).runSessionId).toBe('root-session');
  });

  it('ignores a deeper tool-owned child rather than selecting the deepest capture', () => {
    const read = reader();
    const nested = structuredClone(checkpoint);
    nested.subflowPath = [TOOL_DOMAIN, TOOL_DOMAIN + '/foreign'];
    nested.subflowStates![TOOL_DOMAIN + '/foreign'] = {
      runSessionId: 'foreign-session',
      consentRequest: { requestId: 'foreign-request' },
    };
    expect(read(nested, TOOL_DOMAIN)).toMatchObject({
      runSessionId: 'domain-session',
      consentRequest: { requestId: 'request-1' },
    });
  });

  it.each([
    [
      'duplicate mount',
      (value: FlowchartCheckpoint) => {
        value.subflowPath = [TOOL_DOMAIN, TOOL_DOMAIN];
      },
    ],
    [
      'missing capture',
      (value: FlowchartCheckpoint) => {
        delete value.subflowStates![TOOL_DOMAIN];
      },
    ],
    [
      'null capture',
      (value: FlowchartCheckpoint) => {
        value.subflowStates![TOOL_DOMAIN] = null as never;
      },
    ],
    [
      'array capture',
      (value: FlowchartCheckpoint) => {
        value.subflowStates![TOOL_DOMAIN] = [] as never;
      },
    ],
    [
      'foreign prototype capture',
      (value: FlowchartCheckpoint) => {
        value.subflowStates![TOOL_DOMAIN] = new Date() as never;
      },
    ],
    [
      'inherited capture',
      (value: FlowchartCheckpoint) => {
        value.subflowStates = Object.create({
          [TOOL_DOMAIN]: value.subflowStates![TOOL_DOMAIN],
        });
      },
    ],
    [
      'non-array path',
      (value: FlowchartCheckpoint) => {
        value.subflowPath = TOOL_DOMAIN as never;
      },
    ],
  ] as const)('refuses %s with a named domain error', (_name, change) => {
    const read = reader();
    const invalid = structuredClone(checkpoint);
    change(invalid);
    let failure: unknown;
    try {
      read(invalid, TOOL_DOMAIN);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'ResumeCheckpointError',
      code: 'ERR_RESUME_CHECKPOINT',
      reason: 'invalid-domain',
    });
  });

  it('admits ordinary and null-prototype domain records without copying root facts', () => {
    const read = reader();
    const value = structuredClone(checkpoint);
    value.subflowStates = Object.assign(Object.create(null), value.subflowStates);
    value.subflowStates![TOOL_DOMAIN] = Object.assign(
      Object.create(null),
      value.subflowStates![TOOL_DOMAIN],
    );
    expect(read(value, TOOL_DOMAIN)).toMatchObject({
      consentRequest: { requestId: 'request-1' },
    });
  });

  it.each(['path', 'states', 'capture', 'path index'] as const)(
    'refuses an accessor on the consumed %s without calling its getter',
    (slot) => {
      const read = reader();
      const value = structuredClone(checkpoint);
      let getters = 0;
      const descriptor = {
        configurable: true,
        enumerable: true,
        get() {
          getters += 1;
          throw new Error('getter must not run');
        },
      };
      if (slot === 'path') Object.defineProperty(value, 'subflowPath', descriptor);
      if (slot === 'states') Object.defineProperty(value, 'subflowStates', descriptor);
      if (slot === 'capture') Object.defineProperty(value.subflowStates!, TOOL_DOMAIN, descriptor);
      if (slot === 'path index') Object.defineProperty(value.subflowPath!, '0', descriptor);
      let failure: unknown;
      try {
        read(value, TOOL_DOMAIN);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        name: 'ResumeCheckpointError',
        code: 'ERR_RESUME_CHECKPOINT',
        reason: 'invalid-domain',
      });
      expect(getters).toBe(0);
    },
  );

  it('refuses a sparse path instead of inferring a missing entry', () => {
    const read = reader();
    const value = structuredClone(checkpoint);
    value.subflowPath = new Array<string>(2);
    value.subflowPath[1] = TOOL_DOMAIN;
    expect(() => read(value, TOOL_DOMAIN)).toThrowError(
      expect.objectContaining({ code: 'ERR_RESUME_CHECKPOINT', reason: 'invalid-domain' }),
    );
  });

  it('does not inspect an unrelated deeper capture getter', () => {
    const read = reader();
    const value = structuredClone(checkpoint);
    value.subflowPath = [TOOL_DOMAIN, TOOL_DOMAIN + '/foreign'];
    let getters = 0;
    Object.defineProperty(value.subflowStates!, TOOL_DOMAIN + '/foreign', {
      enumerable: true,
      get() {
        getters += 1;
        throw new Error('foreign capture');
      },
    });
    expect(read(value, TOOL_DOMAIN)).toMatchObject({
      consentRequest: { requestId: 'request-1' },
    });
    expect(getters).toBe(0);
  });
});
