import { readAnswerRows } from './answer/stage.js';
import { readSourceConsultation } from './choose/sourceConsultation.js';
import { readIntegrityFindings } from './choose/stage.js';
import { composeWarning } from './compose/stage.js';
import { gatherWarning, prepareWarning, readPause } from './gather/stage.js';
import { readArgumentAsk, readContingentRows, readInputs } from './inputs/stage.js';
import type { RetainedReasonState } from './reasonDetails.js';
import { readInitialResults, readResultEvidence, readResultsCoverage } from './results/stage.js';
import type { AnswerAssessment, AssessmentDeclarations } from './types.js';

/**
 * One warning sub-flow for live assessment and replay. The sequence retains
 * the observed order of checks and of witnesses within each reason.
 */
export function foldState(
  recorded: Readonly<Record<string, unknown>>,
  declarations: AssessmentDeclarations | undefined,
  served: boolean,
  retainedHistory?: (history: readonly unknown[]) => unknown,
  declarationAddresses?: ReadonlyMap<number, number>,
  legacyEvents?: unknown,
  retain: RetainedReasonState = (_key, value) => value,
): AnswerAssessment {
  const prepared = prepareWarning(recorded, served, declarationAddresses, legacyEvents);
  readInitialResults(prepared);
  const gathered = gatherWarning(prepared, declarationAddresses);
  const { state, argumentVerdicts, resolveCurrent, admission, g, places } = gathered;
  readPause(state, g);
  readArgumentAsk(state, argumentVerdicts, g);
  const enteredArguments = readInputs(state, argumentVerdicts, resolveCurrent, admission, g);
  readResultsCoverage(gathered);
  readContingentRows(state, places, g);
  readResultEvidence(gathered, declarations, enteredArguments, retainedHistory);
  readAnswerRows(state, g);
  const integrity = readIntegrityFindings(state, g);
  const consultation =
    g.fired.has('asked') || g.fired.has('argument-asked')
      ? undefined
      : readSourceConsultation(recorded, g, retain);
  return composeWarning(gathered, integrity, declarationAddresses, retain, consultation);
}
