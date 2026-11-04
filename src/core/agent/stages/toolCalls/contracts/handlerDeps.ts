import type { ToolCatalogPort } from './catalog.js';
import type { ToolAccessPort } from './access.js';
import type { ToolEvidencePort } from './evidence.js';
import type { ToolRoutingPort } from './routing.js';
import type { ToolResourcesPort } from './resources.js';
import type { ToolArtifactsPort } from './artifacts.js';
import type { ToolObservationPort } from './observation.js';
import type { ToolResultsPort } from './results.js';

/** The composed dependency contract consumed by the existing tool-call handler. */
export interface ToolCallsHandlerDeps
  extends ToolCatalogPort,
    ToolAccessPort,
    ToolEvidencePort,
    ToolRoutingPort,
    ToolResourcesPort,
    ToolArtifactsPort,
    ToolObservationPort,
    ToolResultsPort {}
