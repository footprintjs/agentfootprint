import type { TimeDate, TimeRelative, TimeWall } from '../../reader.js';

/** One v1 phrase found in the text: its span and the parts it says. */
export interface Atom {
  readonly start: number;
  end: number;
  readonly kind: 'instant' | 'date' | 'wall' | 'bare' | 'day' | 'span';
  readonly date?: TimeDate;
  readonly wall?: TimeWall;
  readonly relative?: TimeRelative;
  zoneToken?: string;
}
