/** Decode declared stored JSON once; the shared viewer owns ordinary-JSON admission. */
import { decodeCanonicalPayload, measureArtifactBytes } from './payload.js';
import { DETAIL_LIMITS } from './detailRequest.js';
import { unavailableDetail } from './detailError.js';
import type { ArtifactRecord } from './types.js';

export function storedJson(record: ArtifactRecord): unknown {
  if (record.meta.mediaType !== 'application/json') return record.data;
  if (typeof record.data !== 'string') return record.data;
  if (measureArtifactBytes(record.data) > DETAIL_LIMITS.inputBytes) return unavailableDetail();
  return decodeCanonicalPayload('json', new TextEncoder().encode(record.data));
}
