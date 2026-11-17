import type { ArtifactMeta } from '../../../artifacts/types.js';
import type { ToolArtifacts } from '../../../artifacts/capability.js';

// Capability identity is native, invocation-local authority. Artifact kind and
// descriptive origin metadata never manufacture an association to a call.
export type SourcePublicationReceipt = Pick<ReadonlyMap<string, ArtifactMeta>, 'get'>;

interface PublicationOwner {
  open: boolean;
  closed: boolean;
  readonly held: Map<string, ArtifactMeta>;
  readonly accept: (meta: ArtifactMeta) => void;
  receipt?: SourcePublicationReceipt;
}
const publications = new WeakMap<ToolArtifacts, PublicationOwner>();
const EMPTY_RECEIPT: SourcePublicationReceipt = Object.freeze({ get: () => undefined });

function publicationOwner(open: boolean): PublicationOwner {
  const held = new Map<string, ArtifactMeta>();
  const owner: PublicationOwner = {
    open,
    closed: false,
    held,
    accept: (meta) => {
      if (owner.open && held.size < 32 && !held.has(meta.ref))
        held.set(
          meta.ref,
          Object.freeze({
            ref: meta.ref,
            kind: meta.kind,
            mediaType: meta.mediaType,
            bytes: meta.bytes,
            createdAt: meta.createdAt,
            ...(meta.digest !== undefined && { digest: meta.digest }),
            ...(meta.expiresAt !== undefined && { expiresAt: meta.expiresAt }),
          }),
        );
    },
  };
  return owner;
}

export function sourcePublicationSink(artifacts: ToolArtifacts): (meta: ArtifactMeta) => void {
  let owner = publications.get(artifacts);
  if (owner === undefined) {
    owner = publicationOwner(true);
    publications.set(artifacts, owner);
  }
  return owner.accept;
}
/** Seal once at actual execute return; all native consumers share this same inert receipt. */
export function finalizeSourcePublications(artifacts: ToolArtifacts): SourcePublicationReceipt {
  let owner = publications.get(artifacts);
  if (owner === undefined) {
    owner = publicationOwner(false);
    owner.receipt = EMPTY_RECEIPT;
    publications.set(artifacts, owner);
  }
  if (owner.closed) return EMPTY_RECEIPT;
  if (owner.receipt !== undefined) return owner.receipt;
  owner.open = false;
  const sealed = new Map(owner.held);
  owner.held.clear();
  owner.receipt = Object.freeze({ get: (ref: string) => sealed.get(ref) });
  return owner.receipt;
}
export function closeSourcePublications(artifacts: ToolArtifacts): void {
  let owner = publications.get(artifacts);
  if (owner === undefined) {
    owner = publicationOwner(false);
    publications.set(artifacts, owner);
  }
  owner.open = false;
  owner.closed = true;
  owner.held.clear();
  owner.receipt = undefined;
  // Keep only a weak tombstone until the native capability is collected;
  // another consumer cannot reopen this invocation by binding a new sink.
}
