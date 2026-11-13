import { describe, expect, it } from 'vitest';
import * as api from '../auditShapes.js';
import { ruleKind } from '../auditBounding.js';
import fixture from './surface.fixture.json';

describe('audit facade observable surface', () => {
  it('retains the original named functions and arity', () => {
    expect(Object.keys(api).sort()).toEqual([...fixture.exports].sort());
    for (const key of fixture.exports) {
      const fn = api[key as keyof typeof api];
      expect(typeof fn).toBe('function');
      expect(fn.length).toBe(1);
    }
  });

  it('returns fresh plain tables with the original own keys and writable data properties', () => {
    const first = api.eventShapes(() => false);
    const second = api.eventShapes(() => false);
    expect(Reflect.ownKeys(first)).toEqual(fixture.eventKeys);
    expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
    expect(second).not.toBe(first);
    for (const key of Object.keys(first) as (keyof typeof first)[]) {
      expect(second[key]).not.toBe(first[key]);
      expect(Object.getOwnPropertyDescriptor(first, key)).toEqual({
        value: first[key],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    const map = api.eventShapeTable(() => false);
    expect([...map.keys()]).toEqual(fixture.mapKeys);
    for (const name of ['constructor', 'toString', '__proto__']) expect(map.has(name)).toBe(false);
  });

  it('keeps shared rule identity in the turn-end metadata', () => {
    const kind = ruleKind(api.eventShapes(() => false)['agentfootprint.agent.turn_end']);
    expect(kind?.kind).toBe('shape');
    if (kind?.kind !== 'shape') throw new Error('Expected turn-end shape metadata');
    expect(kind.fields.get('scripts')).toBe(api.boundScripts);
    expect(kind.fields.get('answerCoverage')).toBe(api.boundAnswerCoverage);
    expect(kind.fields.get('answerNegatives')).toBe(api.boundAnswerNegatives);
  });

  it('preserves Proxy observations and consults the live tool tracker on every call', () => {
    const tracker = new Set<string>();
    let reads = 0;
    const shape = api.eventShapes((name) => {
      reads++;
      return tracker.has(name);
    })['agentfootprint.tools.absent'];
    expect(reads).toBe(0);
    const trace: string[][] = [];
    const payload = new Proxy(
      {
        toolName: 'tool',
        lookedFor: 'private',
        checked: [{ what: 'private', kind: 'existence' }],
        tryInsteadTool: { tool: 'later', why: 'private' },
        unknown: 'private',
      },
      {
        ownKeys(target) {
          trace.push(['ownKeys']);
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          trace.push(['descriptor', String(key)]);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        get(target, key, receiver) {
          trace.push(['get', String(key)]);
          return Reflect.get(target, key, receiver);
        },
      },
    );
    expect(shape(payload)).toEqual(fixture.proxy.before);
    tracker.add('later');
    expect(shape(payload)).toEqual(fixture.proxy.after);
    expect(reads).toBe(2);
    expect(trace).toEqual(fixture.proxy.trace);
    expect(
      api.boundMeta(new Proxy({ runId: 'run', sessionId: 'session', unknown: 'private' }, {})),
    ).toEqual(fixture.proxy.meta);
  });
});
