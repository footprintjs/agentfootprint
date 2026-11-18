export interface ScriptState {
  /**
   * Calls of THIS run to a declared code-running tool (`Tool.script`) that
   * filed no `script` row because the turn already held `MAX_SCRIPT_ROWS`
   * (`scripts/rows.ts` · `recordScriptRow`). Written ONLY then — absent on
   * every other run — and read only under `.namesAndNumbersFromEvidence({
   * code: 'match' })` (the verdict's `scriptsDropped`) or
   * `.scriptTravelsWithTheAnswer()` (`omitted`). Those calls are unmatchable.
   */
  scriptsDropped?: number;
}
