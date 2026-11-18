import assert from 'node:assert/strict';
import test from 'node:test';
import { requireSnapshot } from './check-published.mjs';

const name = 'agentfootprint-lens';
const selected = {
  agentfootprint: '15.0.0',
  footprintjs: '14.0.0-rc.0',
  foottrace: '2.1.0',
  'footprint-explainable-ui': '2.0.0',
  react: '19.2.7',
};
const native = {
  agentfootprint: '^15.0.0-rc.0',
  footprintjs: '^14.0.0-rc.0',
  foottrace: '^2.1.0',
  'footprint-explainable-ui': '^2.0.0',
  react: '^19.0.0',
};
const published = (version, peerDependencies) => ({ name, version, peerDependencies });
const old = published('0.83.0', {
  ...native,
  agentfootprint: '^14.0.0',
  footprintjs: '^12.0.0',
  foottrace: '^1.11.1',
});

test('an older Lens and stable-only engine peer leave the snapshot in place', () => {
  assert.doesNotThrow(() =>
    requireSnapshot(
      {
        name,
        versions: {
          [old.version]: old,
          '0.84.0': published('0.84.0', { ...native, footprintjs: '^14.0.0' }),
          '0.85.0': published('0.85.0', { ...native, 'footprint-explainable-ui': '^1.0.0' }),
        },
      },
      selected,
    ),
  );
});

test('a compatible publication fails with removal directions, including when latest is newer', () => {
  assert.throws(
    () =>
      requireSnapshot(
        {
          name,
          versions: {
            [old.version]: old,
            '0.84.0': published('0.84.0', native),
            '0.85.0': published('0.85.0', { ...native, react: '^18.0.0' }),
          },
        },
        selected,
      ),
    /agentfootprint-lens@0\.84\.0.*regenerate its lock.*remove docs-next\/vendor\/lens/,
  );
});

test('a missing registry version list cannot establish that the snapshot should be kept', () => {
  assert.throws(
    () => requireSnapshot({ name, versions: {} }, selected),
    /missing Lens registry versions/,
  );
});
