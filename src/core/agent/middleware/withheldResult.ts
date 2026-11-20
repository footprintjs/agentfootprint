/** Read the anonymous return-withholding fact for this exact committed turn. */
export function withheldToolResultOnTurn(state: unknown): boolean {
  if (state === null || typeof state !== 'object') return false;
  const turn: unknown = Object.getOwnPropertyDescriptor(state, 'turnNumber')?.value;
  const stamp: unknown = Object.getOwnPropertyDescriptor(state, 'withheldToolResultTurn')?.value;
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn > 0 && stamp === turn;
}
