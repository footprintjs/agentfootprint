import { expect, it } from 'vitest';
import { readToolParty, sameToolParty } from './toolParty.js';
import { finiteLabel, keyOfLabel, labelKey, readFiniteLabel } from './finiteLabel.js';
import { buildToolResolver } from '../core/agent/stages/toolResolver.js';
import { defineTool } from './tools.js';

it('a finite oversized provider label has a bounded representation that still matches its declaration', () => {
  const actual = { channel: 'provider' as const, id: 'P'.repeat(2000) };
  const saved = readToolParty(actual);
  expect(saved).toBeDefined();
  expect(JSON.stringify(saved).length).toBeLessThan(200);
  expect(sameToolParty(actual, saved!)).toBe(true);
  expect(sameToolParty({ ...actual, id: 'different'.repeat(1000) }, saved!)).toBe(false);
});

it('a raw digest-looking label cannot alias an oversized declaration', () => {
  const label = 'P'.repeat(2000);
  const saved = readToolParty({ channel: 'provider', id: label });
  expect(saved).toBeDefined();
  const digest = saved!.idDigest!;
  expect(sameToolParty({ channel: 'provider', id: `sha256:${digest}` }, saved!)).toBe(false);
  expect(sameToolParty({ channel: 'provider', id: digest }, saved!)).toBe(false);
});

it('finite labels preserve distinct lone surrogates and reject ambiguous tag shapes', () => {
  const first = 'x'.repeat(2000) + '\ud800',
    second = 'x'.repeat(2000) + '\ud801';
  expect(keyOfLabel(first)).not.toBe(keyOfLabel(second));
  const encoded = finiteLabel(first);
  expect(encoded.kind).toBe('sha256');
  expect(keyOfLabel(encoded.value)).not.toBe(labelKey(encoded));
  expect(keyOfLabel(`sha256:${encoded.value}`)).not.toBe(labelKey(encoded));
  expect(() => readFiniteLabel({ kind: 'sha256', value: encoded.value, id: 'extra' })).toThrow();
  expect(
    readToolParty({ channel: 'provider', id: 'short', idDigest: encoded.value }),
  ).toBeUndefined();
});

it('a matched finite proof returns the actual raw provider label to dispatch', () => {
  const id = 'P'.repeat(2000),
    name = 'target';
  const tool = defineTool({
    name,
    description: 'Target',
    inputSchema: { type: 'object' },
    execute: () => 'ran',
  });
  const resolve = buildToolResolver({
    registryByName: new Map(),
    externalToolProvider: { id, list: () => [tool] },
    providerToolCache: { current: [tool] },
    servedTools: {
      current: new Map(),
      lastServed: new Map(),
      lastProof: new Map([[keyOfLabel(name), readToolParty({ channel: 'provider', id })!]]),
      truncated: true,
    },
    notServed: () => 'not served',
  });
  expect(resolve(name)).toMatchObject({ tool, party: { channel: 'provider', id } });
  expect(resolve(name).party).not.toHaveProperty('idDigest');
});
