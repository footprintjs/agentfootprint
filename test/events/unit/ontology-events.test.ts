/**
 * Unit tests — the ontology event (9.106.0).
 *
 * Pattern: Test-as-specification.
 * Role:    Lock the name and the payload LAW: `agentfootprint.ontology.served`
 *          is registered at every site the registry has (`EVENT_NAMES`,
 *          `AgentfootprintEventMap`, `ALL_EVENT_TYPES`), in the three-segment
 *          snake-case form the registry's own test demands, its domain has a
 *          wildcard, and its payload carries the map's identities and counts
 *          ONLY — never a meaning, a coverage sentence or a node name.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEventMap,
} from '../../../src/events/registry.js';
import type { DomainWildcard } from '../../../src/events/dispatcher.js';
import type { OntologyServedPayload } from '../../../src/events/payloads.js';
import type { ContextSource } from '../../../src/events/types.js';

describe('ontology event — registered at every site', () => {
  it('EVENT_NAMES.ontology names the one event in the three-segment form', () => {
    expect(EVENT_NAMES.ontology).toEqual({ served: 'agentfootprint.ontology.served' });
  });

  it('it is in ALL_EVENT_TYPES, directly after the tool_choice domain', () => {
    const list = [...ALL_EVENT_TYPES];
    const at = list.indexOf('agentfootprint.tool_choice.failed');
    expect(at).toBeGreaterThan(-1);
    expect(list[at + 1]).toBe('agentfootprint.ontology.served');
  });

  it('it is a key of AgentfootprintEventMap with its own payload type, and the domain has a wildcard', () => {
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.ontology.served']['payload']
    >().toEqualTypeOf<OntologyServedPayload>();
    expectTypeOf<'agentfootprint.ontology.*'>().toMatchTypeOf<DomainWildcard>();
  });

  it("the piece's source literal is a ContextSource", () => {
    expectTypeOf<'ontology'>().toMatchTypeOf<ContextSource>();
  });
});

describe('ontology event — the payload law', () => {
  it('served: the iteration, the identities and the three counts — nothing the author wrote', () => {
    expectTypeOf<keyof OntologyServedPayload>().toEqualTypeOf<
      'iteration' | 'id' | 'version' | 'hash' | 'nodes' | 'sources' | 'edges'
    >();
    expectTypeOf<OntologyServedPayload['nodes']>().toEqualTypeOf<number>();
    expectTypeOf<OntologyServedPayload['sources']>().toEqualTypeOf<number>();
    expectTypeOf<OntologyServedPayload['edges']>().toEqualTypeOf<number>();
  });
});
