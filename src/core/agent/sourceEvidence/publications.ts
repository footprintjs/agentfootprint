import type { ArtifactMeta } from '../../../artifacts/types.js';
import type { ToolArtifacts } from '../../../artifacts/capability.js';

// Capability identity is native, invocation-local authority. Artifact kind and
// descriptive origin metadata never manufacture an association to a call.
const publications = new WeakMap<ToolArtifacts, Map<string, ArtifactMeta>>();

export function sourcePublicationSink(artifacts: ToolArtifacts): (meta: ArtifactMeta) => void {
  const held = new Map<string, ArtifactMeta>();
  publications.set(artifacts, held);
  return (meta) => {
    if (held.size < 32 && !held.has(meta.ref))
      held.set(meta.ref, {
        ref: meta.ref,
        kind: meta.kind,
        mediaType: meta.mediaType,
        bytes: meta.bytes,
        createdAt: meta.createdAt,
        ...(meta.digest !== undefined && { digest: meta.digest }),
        ...(meta.expiresAt !== undefined && { expiresAt: meta.expiresAt }),
      });
  };
}
export function takeSourcePublications(
  artifacts: ToolArtifacts,
): ReadonlyMap<string, ArtifactMeta> {
  const observed = publications.get(artifacts);
  publications.delete(artifacts);
  return new Map([...(observed ?? [])].map(([ref, meta]) => [ref, structuredClone(meta)]));
}
export function closeSourcePublications(artifacts: ToolArtifacts): void {
  publications.delete(artifacts);
}
