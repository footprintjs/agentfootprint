import { describe, expect, it } from 'vitest';
import { defineOntology } from '../../../../ontology/define.js';
import { LOCAL_SOURCE } from '../../../../recipes/provenance.js';
import { configureOntology, type OntologyPort } from './configure.js';

function map() {
  return defineOntology({
    id: 'map',
    version: '1',
    sources: {},
    nodes: { device: { meaning: 'a declared device' } },
    edges: [],
  });
}

function declaration(): OntologyPort {
  return {
    injectionList: [],
    injectionSources: new Map(),
    currentSource: () => LOCAL_SOURCE,
  };
}

describe('ontology declaration', () => {
  it('retains a frozen map by reference while the none arm registers no ask', () => {
    const receiver = declaration();
    const ontology = map();
    expect(configureOntology(receiver, ontology, { ask: 'none' }, receiver)).toBe(receiver);
    expect(receiver.ontologyValue).toBe(ontology);
    expect(receiver.injectionList).toHaveLength(0);
    expect(receiver.injectionSources.size).toBe(0);
  });

  it('validates ask before checking for a duplicate map', () => {
    const receiver = declaration();
    const ontology = map();
    configureOntology(receiver, ontology, { ask: 'none' }, receiver);
    const bad = { ask: 'other' } as unknown as Parameters<typeof configureOntology>[2];
    expect(() => configureOntology(receiver, ontology, bad, receiver)).toThrow('ask must be');
    expect(() => configureOntology(receiver, ontology, undefined, receiver)).toThrow('already set');
  });
});
