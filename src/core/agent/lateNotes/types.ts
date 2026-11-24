import type { FlowChart, TypedScope } from 'footprintjs';
import type { AgentRunValues } from '../runValues.js';
import type { AgentState } from '../types.js';
import type { LateNotePoint } from './compose/render.js';

export interface LateRecordWork {
  readonly iteration: number;
  readonly points?: readonly LateNotePoint[];
  readonly note?: string;
}

export interface LateRecordNoteMount {
  readonly read: (scope: TypedScope<AgentState>) => void;
  readonly chart: FlowChart;
}

export type LateNoteRunValues = (scope: object) => AgentRunValues;

export interface NoteChartState {
  hasPoints: boolean;
}
