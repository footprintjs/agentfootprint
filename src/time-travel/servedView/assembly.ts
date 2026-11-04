import { joinSystemPrompt } from '../../core/agent/composeRequest.js';
import type { EpochLocation } from '../epochs.js';
import type { ServedView } from '../servedView.js';
import { systemInputs, systemPieces } from './system.js';
import { conversationAt } from './conversation.js';
import { findingsAt } from './findings.js';
import { ontologyAt } from './ontology.js';
import { toolsAt } from './tools.js';
import { requestOnlyAt } from './requestOnly.js';
import { gapsOf } from './gaps.js';
import { readReceipt } from './recordReads.js';
import { detachedList, frozenView } from './value.js';

/** Rebuild one epoch's view through ordered, synchronous domain projections. */
export function viewOf(location: EpochLocation, served: boolean): ServedView {
  const read = readReceipt(location);
  const receipt = read.receipt;
  const [injections, iteration, recovery] = systemInputs(location, served);
  const [conversation, committed, history] = conversationAt(location, served);
  const [findings, asSent, lateLayout, recordedBound, initialLayoutUnknown] = findingsAt(
    location,
    served,
    committed,
    history,
  );
  const ontology = ontologyAt(location, served);
  const [composedPieces, pieces] = systemPieces(injections, recovery, ontology, findings);
  const [registered, withheld, forced] = toolsAt(location, served);
  const [requestOnly, layoutUnknown] = requestOnlyAt(
    location,
    served,
    asSent,
    registered,
    withheld,
    iteration,
    committed,
    lateLayout,
    recordedBound,
    initialLayoutUnknown,
  );
  const gaps = gapsOf(location, layoutUnknown, conversation, read, forced);

  return frozenView({
    epoch: location.epoch,
    callRuntimeStageId: location.callRuntimeStageId,
    ...(receipt !== undefined && {
      basis: {
        model: receipt.basis.model,
        provider: receipt.basis.provider,
        runId: receipt.basis.runId,
      },
    }),
    system: { text: joinSystemPrompt(composedPieces), pieces },
    messages: { asSent: detachedList(asSent), requestOnly },
    tools: {
      names: [...registered.map((t) => t.name), ...(forced !== undefined ? [forced] : [])],
      schemas: detachedList(registered),
      ...(forced !== undefined && { forced }),
      ...(withheld !== null && { withheld }),
    },
    gaps,
  });
}
