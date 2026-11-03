/**
 * agentfootprint/artifacts — stores behind the ArtifactStore port.
 *
 * The port, local defaults and shared artifact helpers are also on the root.
 * Backend adapters live here; optional SDKs load only when a store is built.
 *
 * @example
 * ```ts
 * import { s3Artifacts } from 'agentfootprint/artifacts';
 * const store = s3Artifacts({ bucket: 'artifacts', endpoint: 'https://objects.example.test' });
 * ```
 */
export * from '../artifacts/public.js';
export { s3Artifacts, type S3ArtifactsOptions } from '../artifacts/s3Artifacts.js';
export { gcsArtifacts, type GcsArtifactsOptions } from '../artifacts/gcsArtifacts.js';

export {
  AdapterConfigurationError,
  type AdapterConfigurationAdapter,
  type AdapterConfigurationReason,
} from '../lib/adapterConfiguration.js';
