/**
 * The run options without the time layer's `time` — what the engine is handed.
 * The SAME object when it carries no `time` key, so a run that passed none
 * hands the executor exactly the options it always did.
 */
export function withoutTime<T extends { time?: unknown }>(options: T | undefined): T | undefined {
  if (options === undefined || !('time' in options)) return options;
  const { time: _time, ...rest } = options;
  void _time;
  return rest as T;
}
