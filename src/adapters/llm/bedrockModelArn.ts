/** Bedrock model resource syntax. Each consumer still owns its capability policy. */
const MODEL_ARN =
  /^arn:aws(?:-us-gov|-cn)?:bedrock:[a-z0-9-]+:(\d{12}|):(foundation-model|inference-profile|application-inference-profile)\/([a-zA-Z0-9:.-]+)$/;

export function bedrockModelArn(model: string):
  | {
      readonly kind: 'foundation-model' | 'inference-profile' | 'application-inference-profile';
      readonly id: string;
    }
  | undefined {
  if (model !== model.trim()) return undefined;
  const match = MODEL_ARN.exec(model);
  if (match === null) return undefined;
  const [, account, kind, id] = match;
  if (kind === 'foundation-model' && account === '') return { kind, id };
  if ((kind === 'inference-profile' || kind === 'application-inference-profile') && account !== '')
    return { kind, id };
  return undefined;
}
