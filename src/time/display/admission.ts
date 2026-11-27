import { isZoneName, type ZoneName } from '../zone.js';

/** A recorded viewer declaration. It never supplies the interpretation clock's zone. */
export interface TimeDisplay {
  readonly purpose: 'display-only';
  readonly viewerZone: ZoneName;
}

/** Admit one own-data viewer zone, without evaluating accessors. */
export function readTimeDisplay(value: unknown): TimeDisplay | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== 'viewerZone') return undefined;
    const zone = Object.getOwnPropertyDescriptor(value, 'viewerZone');
    if (zone === undefined || !('value' in zone) || !isZoneName(zone.value)) return undefined;
    return Object.freeze({ purpose: 'display-only', viewerZone: zone.value });
  } catch {
    return undefined;
  }
}
