/**
 * Unit tests — `defineOntology` and `ontologyHash` (9.106.0).
 *
 * Pattern: Test-as-specification.
 * Role:    Pin the definition's laws: every fault refused by NAME (an
 *          identifier that is not safe, an edge to a node nobody declared, a
 *          node held by a source nobody declared, a text that is empty or
 *          too long, a repeated alias / via / edge), the result detached
 *          and deep-frozen, `configured` absent staying absent, and a hash
 *          that is stable, key-order independent and blind to `hash`.
 */

import { describe, expect, it } from 'vitest';
import * as door from '../../src/doors/ontology.js';
import {
  defineOntology,
  ONTOLOGY_LIMITS,
  ontologyHash,
  type OntologySpec,
} from '../../src/ontology/index.js';

const SPEC: OntologySpec = {
  id: 'fleet',
  version: '1',
  sources: {
    inventory: {
      meaning: 'the switch inventory export',
      coverage: 'every port on every switch',
      configured: true,
    },
    syslog: { meaning: 'the syslog archive' },
  },
  nodes: {
    port: {
      meaning: 'a physical switch port',
      aliases: ['interface'],
      sources: [{ source: 'inventory', via: ['lookup_port'], coverage: 'all ports' }],
    },
    port_error_rate: { meaning: 'CRC errors per minute on a port', unit: 'errors/min' },
  },
  edges: [
    { from: 'port_error_rate', to: 'port', relation: 'measured-on', meaning: 'the port it counts' },
  ],
};

describe('defineOntology — the result', () => {
  it('is the door’s own function, detached from the input and deep-frozen', () => {
    expect(door.defineOntology).toBe(defineOntology);
    const input = JSON.parse(JSON.stringify(SPEC)) as OntologySpec;
    const map = defineOntology(input);
    expect(map.id).toBe('fleet');
    expect(map.version).toBe('1');
    expect(map.edges).toEqual(SPEC.edges);
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.nodes)).toBe(true);
    expect(Object.isFrozen(map.nodes.port)).toBe(true);
    expect(Object.isFrozen(map.nodes.port!.sources)).toBe(true);
    expect(Object.isFrozen(map.nodes.port!.sources![0])).toBe(true);
    expect(Object.isFrozen(map.sources.inventory)).toBe(true);
    expect(Object.isFrozen(map.edges)).toBe(true);
    expect(Object.isFrozen(map.edges[0])).toBe(true);
    // Detached: a later edit of the caller's objects moves nothing.
    (input.nodes.port as { meaning: string }).meaning = 'edited';
    (input.edges as { relation: string }[])[0]!.relation = 'edited';
    expect(map.nodes.port!.meaning).toBe('a physical switch port');
    expect(map.edges[0]!.relation).toBe('measured-on');
    // Never aliased either.
    expect(map.nodes).not.toBe(input.nodes);
    expect(map.edges).not.toBe(input.edges);
  });

  it('`configured` absent stays absent; `edges` absent becomes an empty frozen array', () => {
    const map = defineOntology({
      id: 'a',
      version: '1',
      sources: { s: { meaning: 'a source' } },
      nodes: { n: { meaning: 'a node' } },
    });
    expect('configured' in map.sources.s!).toBe(false);
    expect(map.sources.s).toEqual({ meaning: 'a source' });
    expect(map.edges).toEqual([]);
    expect(Object.isFrozen(map.edges)).toBe(true);
    // …and a written `false` is kept as written, never dropped as "unset".
    const off = defineOntology({
      id: 'a',
      version: '1',
      sources: { s: { meaning: 'a source', configured: false } },
      nodes: { n: { meaning: 'a node' } },
    });
    expect(off.sources.s!.configured).toBe(false);
  });

  it('carries the hash `ontologyHash` computes, and an ontology with no sources is legal', () => {
    const map = defineOntology(SPEC);
    expect(map.hash).toBe(ontologyHash(SPEC));
    expect(map.hash).toMatch(/^[0-9a-f]{64}$/);
    const bare = defineOntology({
      id: 'known',
      version: '1',
      sources: {},
      nodes: { n: { meaning: 'known, nowhere collected here' } },
    });
    expect(Object.keys(bare.sources)).toEqual([]);
  });
});

describe('defineOntology — every fault refused by name', () => {
  const base = (): OntologySpec => JSON.parse(JSON.stringify(SPEC)) as OntologySpec;
  const refuses = (mutate: (s: OntologySpec) => OntologySpec | unknown, re: RegExp): void => {
    const spec = base();
    const out = mutate(spec);
    expect(() => defineOntology((out === undefined ? spec : out) as OntologySpec)).toThrow(re);
  };

  it('a non-object spec', () => {
    expect(() => defineOntology(undefined as never)).toThrow(/expected a spec object/);
    expect(() => defineOntology('x' as never)).toThrow(TypeError);
  });

  it('an id that is empty, too long, or not identifier-safe — for the ontology, a node and a source', () => {
    refuses((s) => ({ ...s, id: '' }), /id must be a non-empty string/);
    refuses(
      (s) => ({ ...s, id: 'x'.repeat(ONTOLOGY_LIMITS.idChars + 1) }),
      /at most 64 characters/,
    );
    refuses((s) => ({ ...s, id: 'has space' }), /'has space' is not identifier-safe/);
    refuses((s) => ({ ...s, id: '9lives' }), /not identifier-safe/);
    refuses(
      (s) => ({ ...s, nodes: { ...s.nodes, 'bad id': { meaning: 'x' } } }),
      /a node id 'bad id'/,
    );
    refuses(
      (s) => ({ ...s, sources: { ...s.sources, 'bad/id': { meaning: 'x' } } }),
      /a source id 'bad\/id'/,
    );
  });

  it('a version that is empty or too long', () => {
    refuses((s) => ({ ...s, version: '' }), /version must be a non-empty string/);
    refuses((s) => ({ ...s, version: 'v'.repeat(65) }), /version must be at most 64 characters/);
  });

  it('a dangling edge end, in either direction', () => {
    refuses(
      (s) => ({ ...s, edges: [{ from: 'ghost', to: 'port', relation: 'r' }] }),
      /edge 0 names node 'ghost', which is not declared in nodes/,
    );
    refuses(
      (s) => ({ ...s, edges: [{ from: 'port', to: 'ghost', relation: 'r' }] }),
      /edge 0 names node 'ghost'/,
    );
  });

  it('a node held by a source nobody declared, or by the same source twice', () => {
    refuses(
      (s) => ({
        ...s,
        nodes: { ...s.nodes, port: { meaning: 'p', sources: [{ source: 'nowhere' }] } },
      }),
      /node 'port' is held by source 'nowhere', which is not declared in sources/,
    );
    refuses(
      (s) => ({
        ...s,
        nodes: {
          ...s.nodes,
          port: { meaning: 'p', sources: [{ source: 'inventory' }, { source: 'inventory' }] },
        },
      }),
      /node 'port' names the same source twice/,
    );
  });

  it('an empty or over-long text, wherever a text may sit', () => {
    refuses(
      (s) => ({ ...s, nodes: { ...s.nodes, port: { meaning: '   ' } } }),
      /nodes\['port'\]\.meaning must be a non-empty string/,
    );
    refuses(
      (s) => ({ ...s, nodes: { ...s.nodes, port: { meaning: 'p', unit: 'u'.repeat(513) } } }),
      /nodes\['port'\]\.unit must be a non-empty string of at most 512/,
    );
    refuses(
      (s) => ({ ...s, sources: { ...s.sources, inventory: { meaning: 'm', coverage: '' } } }),
      /sources\['inventory'\]\.coverage/,
    );
    refuses(
      (s) => ({ ...s, edges: [{ from: 'port', to: 'port', relation: '' }] }),
      /edges\[0\]\.relation/,
    );
    refuses(
      (s) => ({
        ...s,
        nodes: {
          ...s.nodes,
          port: { meaning: 'p', sources: [{ source: 'inventory', coverage: 42 as never }] },
        },
      }),
      /nodes\['port'\]\.sources\[0\]\.coverage/,
    );
  });

  it('a repeated alias, a repeated via, a non-boolean configured, a duplicate edge', () => {
    refuses(
      (s) => ({ ...s, nodes: { ...s.nodes, port: { meaning: 'p', aliases: ['a', 'a'] } } }),
      /nodes\['port'\]\.aliases repeats a name/,
    );
    refuses(
      (s) => ({
        ...s,
        nodes: {
          ...s.nodes,
          port: { meaning: 'p', sources: [{ source: 'inventory', via: ['t', 't'] }] },
        },
      }),
      /nodes\['port'\]\.sources\[0\]\.via repeats a name/,
    );
    refuses(
      (s) => ({
        ...s,
        sources: { ...s.sources, inventory: { meaning: 'm', configured: 'yes' as never } },
      }),
      /sources\['inventory'\]\.configured must be a boolean/,
    );
    refuses(
      (s) => ({
        ...s,
        edges: [
          { from: 'port', to: 'port_error_rate', relation: 'has' },
          { from: 'port', to: 'port_error_rate', relation: 'has' },
        ],
      }),
      /edge 'port —has→ port_error_rate' is declared twice/,
    );
  });

  it('an unknown key on a node, a source, a node-source entry or an edge', () => {
    refuses(
      (s) => ({ ...s, nodes: { ...s.nodes, port: { ...s.nodes.port, foo: 1 } as never } }),
      /node 'port' carries unknown key 'foo'/,
    );
    refuses(
      (s) => ({
        ...s,
        sources: { ...s.sources, inventory: { ...s.sources.inventory, foo: 1 } as never },
      }),
      /source 'inventory' carries unknown key 'foo'/,
    );
    refuses(
      (s) => ({
        ...s,
        nodes: {
          ...s.nodes,
          port: { meaning: 'p', sources: [{ source: 'inventory', foo: 1 } as never] },
        },
      }),
      /nodes\['port'\]\.sources\[0\] carries unknown key 'foo'/,
    );
    refuses(
      (s) => ({ ...s, edges: [{ from: 'port', to: 'port', relation: 'r', foo: 1 } as never] }),
      /edges\[0\] carries unknown key 'foo'/,
    );
  });

  it('a node id that collides with a source id, and an alias that collides with another node id', () => {
    refuses(
      (s) => ({
        ...s,
        sources: { ...s.sources, port: { meaning: 'a source named like a node' } },
      }),
      /node id 'port' collides with source id 'port'/,
    );
    refuses(
      (s) => ({
        ...s,
        nodes: { ...s.nodes, port: { meaning: 'p', aliases: ['port_error_rate'] } },
      }),
      /node 'port' alias 'port_error_rate' collides with node id 'port_error_rate'/,
    );
  });

  it('the bounds: no nodes, too many nodes, sources, edges, aliases, holdings, via', () => {
    refuses((s) => ({ ...s, nodes: {} }), /between 1 and 256 nodes/);
    const many = (n: number, prefix: string) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, { meaning: 'm' }]));
    refuses((s) => ({ ...s, nodes: many(257, 'n') }), /between 1 and 256 nodes/);
    refuses((s) => ({ ...s, sources: many(65, 's') }), /at most 64 sources/);
    refuses(
      (s) => ({
        ...s,
        edges: Array.from({ length: 513 }, (_, i) => ({
          from: 'port',
          to: 'port',
          relation: `r${i}`,
        })),
      }),
      /at most 512 edges/,
    );
    refuses(
      (s) => ({
        ...s,
        nodes: {
          ...s.nodes,
          port: { meaning: 'p', aliases: Array.from({ length: 17 }, (_, i) => `a${i}`) },
        },
      }),
      /aliases must be an array of at most 16 strings/,
    );
    refuses(
      (s) => ({
        ...s,
        nodes: {
          ...s.nodes,
          port: {
            meaning: 'p',
            sources: Array.from({ length: 9 }, () => ({ source: 'inventory' })),
          },
        },
      }),
      /sources must be an array of at most 8 entries/,
    );
    refuses(
      (s) => ({
        ...s,
        nodes: {
          ...s.nodes,
          port: {
            meaning: 'p',
            sources: [{ source: 'inventory', via: Array.from({ length: 17 }, (_, i) => `t${i}`) }],
          },
        },
      }),
      /via must be an array of at most 16 strings/,
    );
    refuses((s) => ({ ...s, edges: 'nope' as never }), /edges must be an array when given/);
    refuses((s) => ({ ...s, nodes: [] as never }), /nodes must be a record/);
    refuses((s) => ({ ...s, sources: null as never }), /sources must be a record/);
  });
});

describe('ontologyHash — stable, key-order independent, blind to `hash`', () => {
  it('the same declaration hashes the same across calls and across key order', () => {
    const a = ontologyHash(SPEC);
    expect(ontologyHash(SPEC)).toBe(a);
    const reordered: OntologySpec = {
      edges: SPEC.edges,
      nodes: { port_error_rate: SPEC.nodes.port_error_rate!, port: SPEC.nodes.port! },
      sources: { syslog: SPEC.sources.syslog!, inventory: SPEC.sources.inventory! },
      version: '1',
      id: 'fleet',
    };
    expect(ontologyHash(reordered)).toBe(a);
    expect(defineOntology(reordered).hash).toBe(a);
  });

  it('a changed meaning, a changed edge order or a changed version is a different hash', () => {
    const a = ontologyHash(SPEC);
    expect(ontologyHash({ ...SPEC, version: '2' })).not.toBe(a);
    expect(
      ontologyHash({ ...SPEC, nodes: { ...SPEC.nodes, port: { meaning: 'a port, edited' } } }),
    ).not.toBe(a);
    const two: OntologySpec = {
      ...SPEC,
      edges: [
        { from: 'port', to: 'port_error_rate', relation: 'has' },
        { from: 'port_error_rate', to: 'port', relation: 'measured-on' },
      ],
    };
    const swapped: OntologySpec = { ...two, edges: [two.edges![1]!, two.edges![0]!] };
    expect(ontologyHash(swapped)).not.toBe(ontologyHash(two));
  });

  it('`hash` on an Ontology is never an input: hashing the defined map equals hashing its spec', () => {
    const map = defineOntology(SPEC);
    expect(ontologyHash(map)).toBe(map.hash);
    expect(door.ontologyHash(map)).toBe(map.hash);
  });
});
