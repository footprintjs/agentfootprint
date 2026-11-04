import type { SkillStartRule, SkillRouteOptions } from './graphRoutes.js';
import type { IntentScorer } from '../intentScorer.js';
import type { RoutingPolicy } from '../routingPolicy.js';
import type { EntryScorer } from '../entryScorer.js';
import type { Embedder } from '../../memory/embedding/types.js';

/** Where a turn starts, in the object-literal (flat) form. */
export type SkillGraphStart =
  | string
  | { readonly use: string }
  | {
      readonly rules: ReadonlyArray<SkillStartRule>;
      /** The intent classifier (SG-C) — REQUIRED iff any rule declares
       *  `match: { intent }`. Same machine as `.classify(scorer)`. */
      readonly classify?: IntentScorer;
      /** Tie-policy override — the ONE override home, beside the scorer it
       *  governs. Same machine as `.classify(scorer, policy)`. */
      readonly routing?: Partial<RoutingPolicy>;
    }
  | {
      readonly entries: readonly string[];
      /** Rank the entries with a scorer strategy (`keywordScorer()`,
       *  `embeddingScorer(e)`, or your own). Takes precedence over `byRelevance`. */
      readonly scoredBy?: EntryScorer;
      /** Sugar: rank the entries with an embedder (cosine/softmax). Omit both → the
       *  LLM reads the menu and picks (`.entryByRead()`) — no model call. */
      readonly byRelevance?: Embedder;
    };

/** One tool-result transition in the object-literal (flat) form. */
export interface SkillGraphStep {
  readonly from: string;
  readonly to: string;
  readonly when?: SkillRouteOptions['when'];
  readonly onToolReturn?: string | RegExp;
  /** Route on the result's declared outcome status (9.19.0) — see
   *  {@link SkillRouteOptions.onToolStatus}. */
  readonly onToolStatus?: SkillRouteOptions['onToolStatus'];
  /** The edge's condition as DATA (9.51.0) — see
   *  {@link SkillRouteOptions.guard}. */
  readonly guard?: SkillRouteOptions['guard'];
  readonly label?: string;
}
