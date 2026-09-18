/**
 * scoreAbsence / summarizeAbsence — the bench's measuring stick (9.109.0).
 *
 * Every case is a fixed answer against a fixed map: no model, no clock. What
 * is pinned: matching is by DECLARED strings only (ids, aliases, tool names),
 * whole-word and case-insensitive with `_` standing for a space; the
 * neighbourhood is exactly the declared one (holding sources, reading tools,
 * one-relation terms; for a source, its terms and their tools); a gap the map
 * does not declare is refused; a question with no gap scores only the counts;
 * the map-words metric reports the header's own vocabulary; the summary is
 * `k` of `n` over the turns that had the check.
 */

import { describe, expect, it } from 'vitest';
import * as door from '../../src/doors/ontology.js';
import {
  defineOntology,
  scoreAbsence,
  summarizeAbsence,
  type AbsenceTurn,
  type OntologySpec,
} from '../../src/ontology/index.js';

const SPEC: OntologySpec = {
  id: 'fleet',
  version: '1',
  sources: {
    inventory: { meaning: 'the switch inventory export', configured: true },
    intersight: { meaning: 'Cisco Intersight', configured: false, aliases: ['the cloud manager'] },
    ucs_manager: { meaning: 'UCS Manager', coverage: 'hosts still on UCS Manager' },
  },
  nodes: {
    port: {
      meaning: 'a physical switch port',
      aliases: ['interface'],
      sources: [{ source: 'inventory', via: ['lookup_port'] }],
    },
    esxi_host: {
      meaning: 'an ESXi host',
      sources: [{ source: 'inventory', via: ['lookup_host'] }],
    },
    vmkernel_log: { meaning: "an ESXi host's vmkernel log", aliases: ['APD', 'host log'] },
    ucs_service_profile: {
      meaning: 'a UCS service profile',
      sources: [{ source: 'ucs_manager', via: ['ucs_host_path'] }],
    },
    orphan: { meaning: 'a term with no source and no relation' },
  },
  edges: [
    { from: 'vmkernel_log', to: 'esxi_host', relation: 'written-by' },
    { from: 'port', to: 'esxi_host', relation: 'logs-into' },
  ],
};
const MAP = defineOntology(SPEC);
const turn = (
  answer: string,
  toolCalls: string[] = [],
  unsupportedValues?: number,
): AbsenceTurn => ({
  answer,
  toolCalls,
  ...(unsupportedValues !== undefined && { unsupportedValues }),
});

describe('scoreAbsence — the door', () => {
  it('is exported on agentfootprint/ontology beside the map', () => {
    expect(door.scoreAbsence).toBe(scoreAbsence);
    expect(door.summarizeAbsence).toBe(summarizeAbsence);
  });
});

describe('scoreAbsence — naming the gap', () => {
  it('a term gap: the id with `_` as a space, case-insensitive, whole word', () => {
    expect(
      scoreAbsence(MAP, turn('The vmkernel log is not collected here.'), { gap: 'vmkernel_log' })
        .namedGap,
    ).toBe(true);
    expect(scoreAbsence(MAP, turn('VMKERNEL_LOG absent'), { gap: 'vmkernel_log' }).namedGap).toBe(
      true,
    );
    expect(scoreAbsence(MAP, turn('the vmkernel-log'), { gap: 'vmkernel_log' }).namedGap).toBe(
      true,
    );
    // A longer word containing the id is not the id.
    expect(scoreAbsence(MAP, turn('vmkernel_logs_archive'), { gap: 'vmkernel_log' }).namedGap).toBe(
      false,
    );
    expect(scoreAbsence(MAP, turn('No host logs here.'), { gap: 'vmkernel_log' }).namedGap).toBe(
      false,
    );
  });

  it('a declared alias counts; an undeclared paraphrase does not', () => {
    expect(
      scoreAbsence(MAP, turn('An APD event leaves no trace.'), { gap: 'vmkernel_log' }).namedGap,
    ).toBe(true);
    expect(scoreAbsence(MAP, turn('the host log'), { gap: 'vmkernel_log' }).namedGap).toBe(true);
    expect(
      scoreAbsence(MAP, turn('the kernel log of the host'), { gap: 'vmkernel_log' }).namedGap,
    ).toBe(false);
  });

  it('a source gap: the source id or a declared source alias', () => {
    const s = scoreAbsence(MAP, turn('Intersight is not configured.'), { gap: 'intersight' });
    expect(s.gapKind).toBe('source');
    expect(s.namedGap).toBe(true);
    expect(
      scoreAbsence(MAP, turn('The cloud manager is not read.'), { gap: 'intersight' }).namedGap,
    ).toBe(true);
    expect(
      scoreAbsence(MAP, turn('Cisco cloud thing is not read.'), { gap: 'intersight' }).namedGap,
    ).toBe(false);
  });

  it('refuses a gap the map does not declare, naming it and the map', () => {
    expect(() => scoreAbsence(MAP, turn('x'), { gap: 'change_record' })).toThrow(
      /expected gap 'change_record' is neither a term nor a source of ontology 'fleet'/,
    );
  });
});

describe('scoreAbsence — naming where the need would be met', () => {
  it('a term gap: its holding sources, reading tools and one-relation terms are the neighbourhood', () => {
    const s = scoreAbsence(MAP, turn('Written by the ESXi host; inventory holds the host.'), {
      gap: 'vmkernel_log',
    });
    expect(s.neighbours).toEqual(['esxi_host']);
    expect(s.namedWhere).toBe(true);
    expect(s.where).toEqual(['esxi_host']);
  });

  it('a held term: the source, the tool and the related term all count; the answer may name any one', () => {
    const s = scoreAbsence(MAP, turn('lookup_port reads it.'), { gap: 'port' });
    expect(s.neighbours).toEqual(['inventory', 'lookup_port', 'esxi_host']);
    expect(s.where).toEqual(['lookup_port']);
    expect(s.namedWhere).toBe(true);
    expect(scoreAbsence(MAP, turn('Ask the network team.'), { gap: 'port' }).namedWhere).toBe(
      false,
    );
  });

  it("a source gap: the terms it holds and the tools reading through it; a meaning's words never count", () => {
    const s = scoreAbsence(
      MAP,
      turn('UCS Manager still reads the service profile via ucs_host_path.'),
      {
        gap: 'intersight',
      },
    );
    // `intersight` holds nothing — no neighbour is declared, so the check is not asked.
    expect(s.neighbours).toEqual([]);
    expect(s.namedWhere).toBeUndefined();
    const u = scoreAbsence(MAP, turn('UCS Manager still reads it.'), { gap: 'ucs_manager' });
    expect(u.neighbours).toEqual(['ucs_service_profile', 'ucs_host_path']);
    // "UCS Manager" is the source's MEANING, not a declared id — and the gap itself is not its own neighbour.
    expect(u.namedWhere).toBe(false);
    expect(
      scoreAbsence(MAP, turn('the UCS service profile is held there'), { gap: 'ucs_manager' })
        .namedWhere,
    ).toBe(true);
  });

  it('a term with no source and no relation has no neighbourhood: the check is not asked', () => {
    const s = scoreAbsence(MAP, turn('orphan is unknown here'), { gap: 'orphan' });
    expect(s.namedGap).toBe(true);
    expect(s.neighbours).toEqual([]);
    expect(s.namedWhere).toBeUndefined();
  });
});

describe('scoreAbsence — the counts and the map words', () => {
  it('a question with no gap scores only the counts', () => {
    const s = scoreAbsence(
      MAP,
      turn('The path is host → port.', ['lookup_host', 'lookup_port'], 0),
    );
    expect(s.gapKind).toBe('none');
    expect(s.namedGap).toBeUndefined();
    expect(s.namedWhere).toBeUndefined();
    expect(s.toolCalls).toBe(2);
    expect(s.unsupportedValues).toBe(0);
  });

  it('unsupported values are taken as handed in, absent when the record carried none', () => {
    expect(scoreAbsence(MAP, turn('x', [], 5), { gap: 'port' }).unsupportedValues).toBe(5);
    expect(scoreAbsence(MAP, turn('x'), { gap: 'port' }).unsupportedValues).toBeUndefined();
  });

  it("the map words: the header's own vocabulary, reported as the words found, once each", () => {
    expect(
      scoreAbsence(MAP, turn('The ontology declares it; the map says so; the declaration…'))
        .mapWords,
    ).toEqual(['ontology', 'map', 'declares', 'declaration']);
    expect(scoreAbsence(MAP, turn('Not collected here. Check the ESXi host.')).mapWords).toEqual(
      [],
    );
    // `mapping`, `maps` as a verb: `map` is exact, `maps` allowed — a word list, not a judgment.
    expect(scoreAbsence(MAP, turn('a mapping of ports')).mapWords).toEqual([]);
  });
});

describe('summarizeAbsence', () => {
  it('k of n per check over the turns that had it; counts summed; unsupported absent when no record carried one', () => {
    const scores = [
      scoreAbsence(
        MAP,
        turn(
          'The vmkernel log is not collected; the ESXi host writes it. The ontology says.',
          [],
          0,
        ),
        {
          gap: 'vmkernel_log',
        },
      ),
      scoreAbsence(MAP, turn('No idea.', ['lookup_host'], 2), { gap: 'vmkernel_log' }),
      scoreAbsence(MAP, turn('orphan: nowhere.'), { gap: 'orphan' }),
      scoreAbsence(MAP, turn('host → port', ['lookup_host', 'lookup_port'])),
    ];
    expect(summarizeAbsence(scores)).toEqual({
      turns: 4,
      namedGap: { k: 2, n: 3 },
      namedWhere: { k: 1, n: 2 },
      citedMap: { k: 1, n: 4 },
      toolCalls: 3,
      unsupportedValues: 2,
    });
    expect(summarizeAbsence([scoreAbsence(MAP, turn('x'))]).unsupportedValues).toBeUndefined();
    expect(summarizeAbsence([])).toEqual({
      turns: 0,
      namedGap: { k: 0, n: 0 },
      namedWhere: { k: 0, n: 0 },
      citedMap: { k: 0, n: 0 },
      toolCalls: 0,
      unsupportedValues: undefined,
    });
  });
});
