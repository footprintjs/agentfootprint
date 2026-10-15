/**
 * ag-ui — the AG-UI protocol adapter over agentfootprint's event stream.
 *
 * `agUiSerializer` turns one run's served events into AG-UI events; `agUiSse`
 * frames them for the wire with the official `@ag-ui/encoder`. Published
 * through the `agentfootprint/ag-ui` door. The fixed sentences and the id
 * grammar stay internal — tests import them by module path.
 */

export { agUiSerializer, type AgUiSerializerOptions } from './serializer.js';
export { agUiSse, type AgUiEncoderModule, type AgUiSseOptions } from './framing.js';
export {
  AG_UI_PROTOCOL_VERSION,
  type AgUiAddress,
  type AgUiEvent,
  type AgUiEventType,
  type AgUiInterrupt,
  type AgUiMetadata,
  type AgUiRunOutcome,
} from './types.js';
