import { CONSENT_PAUSE_KEY } from '../../../../../identity/consent.js';

/**
 * Keys of `pauseData` the library reads to recognise a pause of its OWN: which
 * call paused (`toolCallId` / `toolName`), which consent gate or typed ask is
 * open (`src/core/pause.ts` · `pauseDemandsDecision` reads `checkIn` / `ask`;
 * `RunnerBase` reads `awaitingInput`), and credential consent
 * (`identity/consent.ts` · `CONSENT_PAUSE_KEY`, minted only by
 * `credentialAdmission.ts`, whose URL the caller is told to open). A tool's
 * own data never carries them, whatever their value: a gate opened by a tool
 * is a request the library never minted, so no decision can answer it, and a
 * consent link from a tool would be shown as the library's.
 *
 * One library pause IS raised by a tool: an AG-UI frontend tool's
 * (`agUiFrontendTool`). Its reader does not trust the key; it asks whether the
 * call's real `toolName` (written below) is one the app declared
 * (`ag-ui/frontendTools.ts` · `isFrontendToolPause`).
 */
const LIBRARY_PAUSE_KEYS = [
  'toolCallId',
  'toolName',
  'checkIn',
  'ask',
  'awaitingInput',
  CONSENT_PAUSE_KEY,
] as const;

/**
 * The checkpoint's `pauseData` for a tool's own `pauseHere(data)` /
 * `askHuman(data)`: the REAL call's `toolCallId` / `toolName`, then the
 * tool's fields minus the library's keys, so nothing a tool writes can rename
 * the call or open a gate. Every other field is copied exactly as before
 * (a spread, so an own `__proto__` key stays a plain field), and the real
 * keys stay first, the order every plain pause has always serialized in.
 *
 * @example a tool raising askHuman({ question: 'ok?', toolName: 'transfer_funds', ask: 'later' })
 *   from `lookup_weather` call `c1` pauses with
 *   { toolCallId: 'c1', toolName: 'lookup_weather', question: 'ok?' }
 */
export function toolPauseData(
  tc: { readonly id: string; readonly name: string },
  raised: unknown,
): Record<string, unknown> {
  if (typeof raised !== 'object' || raised === null) {
    return { toolCallId: tc.id, toolName: tc.name, data: raised };
  }
  const own: Record<PropertyKey, unknown> = { ...raised };
  for (const key of LIBRARY_PAUSE_KEYS) delete own[key];
  return { toolCallId: tc.id, toolName: tc.name, ...own };
}
