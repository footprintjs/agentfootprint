/**
 * ag-ui — the AG-UI protocol adapter over agentfootprint's event stream.
 *
 * `agUi()` is the adapter a host takes (`streamHandler` on
 * `agentfootprint/hosting`): it reads an untrusted `RunAgentInput`, plans the
 * turn against what the server holds, and translates the run.
 * `agUiSerializer` turns one run's served events into AG-UI events; `agUiSse`
 * frames them for the wire with the official `@ag-ui/encoder`. Published
 * through the `agentfootprint/ag-ui` door. The fixed sentences and the id
 * grammar stay internal — tests import them by module path.
 */

export {
  agUiSerializer,
  AG_UI_CUSTOM_EVENTS,
  type AgUiCustomContext,
  type AgUiCustomProjection,
  type AgUiSerializerOptions,
  type AgUiTranslation,
} from './serializer.js';
export { agUiSse, type AgUiEncoderModule, type AgUiSseOptions } from './framing.js';
export { agUi, type AgUiOptions } from './adapter.js';
export type { AgUiFrontendTool } from './frontendTools.js';
export { AG_UI_MAX_ID_LENGTH, readAgUiRunInput, type AgUiValidator } from './request.js';
export {
  AG_UI_PROTOCOL_VERSION,
  type AgUiAddress,
  type AgUiEvent,
  type AgUiEventType,
  type AgUiInterrupt,
  type AgUiMessage,
  type AgUiMetadata,
  type AgUiResumeEntry,
  type AgUiRunInput,
  type AgUiRunOutcome,
  type AgUiSuspendedCall,
  type AgUiSuspendedScope,
  type AgUiSuspension,
} from './types.js';
