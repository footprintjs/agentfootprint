/** S3-compatible configuration only: running this example makes no backend call. */
// #region s3-compatible-config
import { s3Artifacts, type S3ArtifactsOptions } from '../../src/doors/artifacts.js';

export const objectStoreOptions: S3ArtifactsOptions = {
  bucket: 'agent-artifacts',
  region: 'us-east-1',
  endpoint: 'https://objects.example.test',
  forcePathStyle: true,
  prefix: 'artifacts',
};

// Call at host construction, with @aws-sdk/client-s3 installed and credentials
// configured through the SDK's credential chain. The bucket must already exist.
export function buildArtifactStore() {
  return s3Artifacts(objectStoreOptions);
}
// #endregion s3-compatible-config

console.log(
  'S3-compatible configuration is ready; no client was constructed or backend contacted.',
);
