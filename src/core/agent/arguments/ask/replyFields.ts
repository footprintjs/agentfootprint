/** New reply siblings are wire fields, never additional logical tool arguments. */
import type { InputField } from '../../../../tools/inputRequest.js';
import type { ArgumentAskState, AskField } from './types.js';
import { MAX_ASK_FIELDS } from './constants.js';

export function replyBinding(field: AskField, id: string) {
  return field.window?.format === 'time-range' && field.window.reply !== undefined
    ? { version: 1 as const, correction: `${id}-correction` }
    : undefined;
}
export function physicalPrefix(state: ArgumentAskState, wanted: readonly number[]): number[] {
  const indexes: number[] = [];
  let count = 0;
  for (const index of wanted) {
    const width = replyBinding(state.fields[index], `f${indexes.length + 1}`) === undefined ? 1 : 2;
    if (count + width > MAX_ASK_FIELDS) break;
    indexes.push(index);
    count += width;
  }
  return indexes;
}
export function roundFields(state: ArgumentAskState, indexes: readonly number[]): InputField[] {
  const siblings: InputField[] = [];
  const fields: InputField[] = indexes.map((index, position) => {
    const field = state.fields[index],
      id = `f${position + 1}`,
      binding = replyBinding(field, id);
    if (binding !== undefined)
      siblings.push({
        id: binding.correction,
        type: 'string',
        required: false,
        description: field.window!.reply!.description,
      });
    return {
      id,
      type: field.type,
      required: binding === undefined,
      description: field.question,
      ...(field.choices !== undefined && { enum: [...field.choices] }),
      ...(field.window !== undefined && { format: field.window.format }),
      ...(field.window?.labels !== undefined && { labels: [...field.window.labels] }),
    };
  });
  return [...fields, ...siblings];
}
