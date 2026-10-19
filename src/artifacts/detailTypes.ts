import type { ArtifactRef } from './types.js';

/** A reference and a bounded direct-child page, never a storage location. */
export interface ArtifactDetailArgs {
  readonly ref: ArtifactRef;
  /** JSON pointer; the empty string opens the admitted root. */
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
}

/** An action the same mounted detail tool can execute. */
export interface ArtifactDetailAction {
  readonly tool: string;
  readonly args: ArtifactDetailArgs;
}

/** One direct child; its value is available through its action, not implied by its name. */
export interface ArtifactDetailChild {
  readonly path: string;
  readonly type: 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
  readonly count?: number;
  readonly action: ArtifactDetailAction;
}

interface DetailBase {
  readonly ref: ArtifactRef;
  readonly path: string;
  readonly kind: ArtifactDetailChild['type'];
  /** Host presentation data, isolated from navigation fields and counted in the response limit. */
  readonly context?: Readonly<Record<string, unknown>>;
}

/** A whole small value, an exact child page, or an explicitly withheld scalar. */
export type ArtifactDetailResult =
  | (DetailBase & { readonly mode: 'value'; readonly value: unknown; readonly complete: true })
  | (DetailBase & {
      readonly mode: 'children';
      readonly children: readonly ArtifactDetailChild[];
      readonly offset: number;
      readonly shown: number;
      readonly total: number;
      readonly complete: boolean;
      readonly nextOffset?: number;
    })
  | (DetailBase & {
      readonly mode: 'scalar-omitted';
      readonly omitted: true;
      readonly scalarBytes: number;
      readonly complete: false;
      readonly reason: string;
    });
