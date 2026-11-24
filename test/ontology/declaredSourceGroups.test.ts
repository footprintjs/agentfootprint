import { describe, expect, it } from 'vitest';
import { declaredSourceGroups } from '../../src/ontology/declaredSourceGroups.js';
import { defineOntology } from '../../src/ontology/index.js';

const ontology = defineOntology({
  id: 'switches',
  version: '1',
  sources: {
    status: { meaning: 'Current state' },
    switch_monitor: { meaning: 'Observations after each switch change', aliases: ['monitor'] },
    inventory: { meaning: 'Available equipment', aliases: ['catalog'] },
  },
  nodes: {
    switch_state: {
      meaning: 'A switch state',
      aliases: ['state report', 'switch (live)'],
      sources: [
        { source: 'status', via: ['read_status'] },
        { source: 'switch_monitor', via: ['read_monitor', 'read_archive'] },
      ],
    },
    probe: {
      meaning: 'One observed timestamp',
      aliases: ['monitor'],
      sources: [{ source: 'switch_monitor', via: ['read_monitor', 'read_probe'] }],
    },
    owned_equipment: {
      meaning: 'A catalog entry',
      sources: [{ source: 'inventory', via: ['read_inventory'] }],
    },
    site: { meaning: 'A site referenced by other terms' },
  },
  edges: [{ from: 'site', to: 'switch_state', relation: 'is-connected-to' }],
});

describe('declared sources named in the question', () => {
  it.each(['switch states', 'Switch-State', 'SWITCH_STATE', 'State reports', 'Switch (live)'])(
    'groups the direct holders of %s as alternative tools per source',
    (question) => {
      expect(declaredSourceGroups(ontology, question)).toEqual([
        { source: 'status', tools: ['read_status'] },
        {
          source: 'switch_monitor',
          tools: ['read_monitor', 'read_archive'],
          equivalents: ['read_monitor', 'read_archive', 'read_probe'],
        },
      ]);
    },
  );

  it('keeps offer candidates on the named term and equivalent attempts on the same source', () => {
    expect(declaredSourceGroups(ontology, 'Check the probe.')).toEqual([
      {
        source: 'switch_monitor',
        tools: ['read_monitor', 'read_probe'],
        equivalents: ['read_monitor', 'read_archive', 'read_probe'],
      },
    ]);
  });

  it('deduplicates direct holders of an explicitly named source and keeps a second source', () => {
    expect(declaredSourceGroups(ontology, 'Consult switch monitors and the catalog.')).toEqual([
      { source: 'switch_monitor', tools: ['read_monitor', 'read_archive', 'read_probe'] },
      { source: 'inventory', tools: ['read_inventory'] },
    ]);
  });

  it('ignores a shared alias and independently admits a different declared name', () => {
    expect(declaredSourceGroups(ontology, 'Check the monitor and the owned equipment.')).toEqual([
      { source: 'inventory', tools: ['read_inventory'] },
    ]);
  });

  it('uses neither relations, tool names, meanings, nor longer words as question matches', () => {
    expect(
      declaredSourceGroups(
        ontology,
        'Check this site: read_status, current state, switch_state_history.',
      ),
    ).toEqual([]);
  });

  it('does not treat an incomplete bounded read as a source declaration', () => {
    expect(declaredSourceGroups(ontology, 'monitor '.repeat(4_097) + 'owned equipment')).toEqual(
      [],
    );
  });
});
