import { captureOwn } from './causeCapture.js';

type ControlMap = Record<string, { deciderId: string }>;

/** Read the public producer snapshot, never its class or live recorder internals. */
export function capturedControl(snapshot: unknown): ControlMap | undefined {
  try {
    const entries = captureOwn(snapshot, 'recorders');
    if (!Array.isArray(entries) || entries.length > 32) return undefined;
    let control: ControlMap | undefined;
    for (let index = 0; index < entries.length; index++) {
      const entry = captureOwn(entries, String(index));
      if (captureOwn(entry, 'name') !== 'control-dependencies') continue;
      if (control !== undefined) return undefined; // Conflicting producers are not merged or guessed.
      const acknowledgement = captureOwn(entry, 'capture');
      if (
        captureOwn(acknowledgement, 'version') !== 1 ||
        captureOwn(acknowledgement, 'runId') !== captureOwn(snapshot, 'runId') ||
        captureOwn(acknowledgement, 'control') !== 'captured'
      )
        return undefined;
      const data = captureOwn(captureOwn(entry, 'data'), 'controlDeps');
      if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
      const prototype = Object.getPrototypeOf(data);
      if (prototype !== null && prototype !== Object.prototype) return undefined;
      control = Object.create(null) as ControlMap;
      let count = 0;
      for (const id in data) {
        if (!Object.hasOwn(data, id)) continue;
        if (++count > 4096 || id.length === 0 || id.length > 128) return undefined;
        const deciderId = captureOwn(captureOwn(data, id), 'deciderId');
        if (typeof deciderId !== 'string' || deciderId.length === 0 || deciderId.length > 128)
          return undefined;
        control[id] = { deciderId };
      }
    }
    return control;
  } catch {
    return undefined;
  }
}
