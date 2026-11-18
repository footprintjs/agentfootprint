/** Only locally constructed operation labels reach CI failure output. */
const details = new WeakMap();
export function failureDetails(error) {
  if (details.has(error)) return details.get(error);
  const firstLine = typeof error?.message === 'string' ? error.message.split('\n')[0] : '';
  const code = /^docs-input-[a-z-]+$/.test(firstLine) ? firstLine : 'docs-input-intake-refused';
  return { code };
}

export function inputFailure(error, operation, httpStatus) {
  if (details.has(error)) return error;
  const result = new Error(failureDetails(error).code);
  details.set(result, { code: result.message, ...operation,
    ...(httpStatus ? { httpStatus } : {}) });
  return result;
}

export function apiOperation(path) {
  const match = /^repos\/(footprintjs\/(?:agentfootprint|agentfootprint-lens|explainable-ui))\/(git\/commits\/[a-f0-9]{40}|actions\/runs\/\d+(?:\/attempts\/\d+\/jobs\?per_page=100)?|actions\/artifacts\/\d+(?:\/zip)?)$/.exec(path);
  if (!match) throw new Error('docs-input-fixed-api-path');
  return { repository: match[1], operation: path.endsWith('/zip') ? 'original-archive' : 'metadata',
    target: match[2] };
}
