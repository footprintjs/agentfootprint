/**
 * time-travel/ — the agent's stops on a reader's cursor.
 *
 * Role: Fold. See README.md for what a milestone stop is, why the strategy is
 * composed from footprintjs's own per-stage axis rather than re-derived, and
 * how the same strategy serves both chart shapes.
 */

export { milestoneOf, milestoneStops, milestoneStopsStrategy } from './milestoneStops.js';
