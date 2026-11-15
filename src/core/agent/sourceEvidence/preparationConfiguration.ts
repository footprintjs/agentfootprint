/** The compatible Agent's existing declarations, read by the same preparation lifecycle. */
import type { ToolRegistryEntry } from '../../../tools/tools.js';
import type { ToolProvider } from '../../../tools/toolProvider.js';
import type { Injection } from '../../../injection-engine/types.js';
import type { ArtifactStore } from '../../../artifacts/types.js';
import type { PermissionChecker } from '../../../provider-contract/types.js';
import type { ResolvedSourceEvidenceOptions } from '../../../tools/sourceEvidence.js';

export interface SourcePreparationConfiguration {
  readonly registry: readonly ToolRegistryEntry[];
  readonly injections: readonly Injection[];
  readonly externalToolProvider?: ToolProvider;
  readonly artifactStore?: ArtifactStore;
  readonly permissionChecker?: PermissionChecker;
  readonly sourceEvidenceConfig?: ResolvedSourceEvidenceOptions;
  readonly explicitId?: string;
}
