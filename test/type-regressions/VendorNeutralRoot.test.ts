import { inMemoryArtifacts, type ArtifactStore } from '../../src/index.js';
import { s3Artifacts, gcsArtifacts, type S3ArtifactsOptions } from '../../src/doors/artifacts.js';
import { providerFromEnv, type ProviderFromEnv } from '../../src/doors/providers.js';
import * as root from '../../src/index.js';
import { expect, it } from 'vitest';
// @ts-expect-error Vendor artifact factories are intentionally absent from the root.
type RemovedS3 = typeof root.s3Artifacts;
// @ts-expect-error Provider configuration is intentionally absent from the root.
type RemovedEnv = typeof root.providerFromEnv;
// @ts-expect-error Vendor artifact factories are intentionally absent from the root.
type RemovedGcs = typeof root.gcsArtifacts;
// @ts-expect-error Vendor option types move with their factory.
type RemovedS3Options = root.S3ArtifactsOptions;
// @ts-expect-error Vendor option types move with their factory.
type RemovedGcsOptions = root.GcsArtifactsOptions;
// @ts-expect-error Provider result types move with their helper.
type RemovedEnvResult = root.ProviderFromEnv;
// @ts-expect-error Provider option types belong to the provider door.
type RemovedCreateOptions = root.CreateProviderOptions;
// @ts-expect-error Provider kind types belong to the provider door.
type RemovedKind = root.ProviderKind;

const options: S3ArtifactsOptions = {
  bucket: 'artifacts',
  endpoint: 'https://objects.example.test',
};
const store: ArtifactStore = inMemoryArtifacts();
const resolveProvider: (options?: { readonly fallbackToMock?: boolean }) => ProviderFromEnv =
  providerFromEnv;
const removed:
  | [
      RemovedS3,
      RemovedEnv,
      RemovedGcs,
      RemovedS3Options,
      RemovedGcsOptions,
      RemovedEnvResult,
      RemovedCreateOptions,
      RemovedKind,
    ]
  | undefined = undefined;
void [options, store, resolveProvider, s3Artifacts, gcsArtifacts, removed];

it('publishes backend factories through their subpaths and local stores through the root', () => {
  expect(s3Artifacts).toBeTypeOf('function');
  expect(gcsArtifacts).toBeTypeOf('function');
  expect(providerFromEnv).toBeTypeOf('function');
  expect(root).not.toHaveProperty('s3Artifacts');
  expect(root).not.toHaveProperty('gcsArtifacts');
  expect(root).not.toHaveProperty('providerFromEnv');
  expect(store.put).toBeTypeOf('function');
});
