import { expect, it } from 'vitest';
import { gcsArtifacts } from '../../src/artifacts/gcsArtifacts.js';
import { fakeGcs } from './fakes/objectServices.js';

it('does not expose SDK constructor failure text', () => {
  let failure: unknown;
  try {
    gcsArtifacts({
      bucket: 'artifacts',
      _sdk: {
        Storage: class {
          constructor() {
            throw new Error('PRIVATE_CONSTRUCTOR_SENTINEL');
          }
          bucket() {
            return fakeGcs().storage.bucket('artifacts');
          }
        },
      },
    });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    name: 'GcsArtifactsConfigurationError',
    code: 'ERR_GCS_ARTIFACTS_CONFIGURATION',
    reason: 'client-construction-failed',
  });
  expect(failure).not.toHaveProperty('cause');
  expect(String(failure)).not.toContain('PRIVATE_CONSTRUCTOR_SENTINEL');
});

it('refuses a projectId beside a supplied GCS storage client', () => {
  let failure: unknown;
  try {
    gcsArtifacts({ bucket: 'artifacts', projectId: 'unused-project', storage: fakeGcs().storage });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    name: 'GcsArtifactsConfigurationError',
    code: 'ERR_GCS_ARTIFACTS_CONFIGURATION',
    reason: 'conflicting-options',
  });
});

it('accepts a supplied GCS storage client when construction options are absent', () => {
  const store = gcsArtifacts({ bucket: 'artifacts', storage: fakeGcs().storage });
  expect(store.put).toBeTypeOf('function');
});

it('passes projectId to an owned storage client', () => {
  const configs: unknown[] = [];
  const fake = fakeGcs();
  const store = gcsArtifacts({
    bucket: 'artifacts',
    projectId: 'project',
    _sdk: {
      Storage: class {
        constructor(config: Record<string, unknown>) {
          configs.push(config);
        }
        bucket(name: string) {
          return fake.storage.bucket(name);
        }
      },
    },
  });
  expect(store.put).toBeTypeOf('function');
  expect(configs).toEqual([{ projectId: 'project' }]);
});
