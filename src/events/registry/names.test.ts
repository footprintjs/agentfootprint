import { expect, it } from 'vitest';
import { EVENT_NAMES, ALL_EVENT_TYPES } from '../registry.js';

it('names every registered event exactly once', () => {
  const names = Object.values(EVENT_NAMES).flatMap((domain) => Object.values(domain));
  expect(names.toSorted()).toEqual([...ALL_EVENT_TYPES].toSorted());
});
