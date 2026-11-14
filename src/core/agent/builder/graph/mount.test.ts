import { describe, expect, it } from 'vitest';
import type { Injection } from '../../../../injection-engine/types.js';
import { mountSkillGraph, type GraphMountPort, type MountedGraph } from './mount.js';

const skill = (id: string): Injection => ({
  id,
  flavor: 'skill',
  trigger: { kind: 'always' },
  inject: { systemPrompt: 'Guidance' },
});

describe('the builder graph mount', () => {
  it('calls the current injection door for every member before capturing the resolver', () => {
    const first = skill('first');
    const second = skill('second');
    const calls: string[] = [];
    const laterResolver = () => 'second';
    const graph: MountedGraph = {
      skills: [first, second],
      nextSkill: () => 'first',
      nodes: [
        { id: 'first', kind: 'skill' },
        { id: 'second', kind: 'skill' },
      ],
      deferredBodyContract: { mode: 'throw' },
    };
    const receiver: GraphMountPort = {
      opts: {},
      skillGraphIsTree: false,
      injection(injection) {
        expect(this).toBe(receiver);
        expect(this.skillGraphNextSkill).toBeUndefined();
        calls.push('original:' + injection.id);
        graph.nextSkill = laterResolver;
        this.injection = (next) => calls.push('replacement:' + next.id);
      },
    };
    expect(mountSkillGraph(receiver, graph, undefined, receiver)).toBe(receiver);
    expect(calls).toEqual(['original:first', 'replacement:second']);
    expect(receiver.skillGraphNextSkill).toBe(laterResolver);
    expect(receiver.skillGraphDeferredBodyContract?.skills).toBe(graph.skills);
    expect([...(receiver.skillGraphNodeIds ?? [])]).toEqual(['first', 'second']);
  });

  it('refuses classic mode before consulting the graph contribution', () => {
    const receiver: GraphMountPort = {
      opts: { reactMode: 'classic' },
      skillGraphIsTree: false,
      injection() {
        throw new Error('must not register');
      },
    };
    const graph: MountedGraph = {
      get skills(): never {
        throw new Error('must not read skills');
      },
      nextSkill: () => undefined,
    };
    expect(() => mountSkillGraph(receiver, graph, undefined, receiver)).toThrow(
      /reactMode 'classic'/,
    );
    expect(receiver.skillGraphNextSkill).toBeUndefined();
  });

  it('refuses continuity on a predicate tree rather than inventing a carried cursor', () => {
    const receiver: GraphMountPort = { opts: {}, skillGraphIsTree: false, injection() {} };
    const graph: MountedGraph = {
      skills: [],
      nextSkill: () => undefined,
      nodes: [{ kind: 'predicate', id: 'choice' }],
    };
    expect(() =>
      mountSkillGraph(receiver, graph, { continuity: 'conversation' }, receiver),
    ).toThrow(/tree.*no cursor/);
    expect(receiver.skillGraphCascade).toBeUndefined();
  });
});
