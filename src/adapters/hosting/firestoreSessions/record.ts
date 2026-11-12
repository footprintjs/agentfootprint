import type { FlowChartExecutor } from 'footprintjs';

export interface SessionRunRecord {
  readonly operation: string;
  readonly snapshot: ReturnType<FlowChartExecutor['getSnapshot']>;
}

export type SessionRunObserver = (record: SessionRunRecord) => void;
