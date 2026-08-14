/**
 * azureUrl — the one place that turns an Azure resource endpoint into a URL.
 *
 * Pattern: shared pure helper. No SDK, no fetch, no environment.
 * Role:    Outer ring, leaf. Imported by BOTH Azure doors — the Node
 *          `azureOpenai()` (which hands the result to the `openai` SDK as its
 *          `baseURL`) and the SDK-free `browserAzureOpenai()` (which builds the
 *          whole URL itself). It lives alone in this file so the browser door
 *          never has to import the SDK-loading one to get it.
 * Emits:   N/A.
 *
 * Why it exists at all: `AZURE_OPENAI_ENDPOINT` and `OPENAI_BASE_URL` are two
 * spellings of the same thing in this library's docs, and people write the
 * value in more than one shape — with a trailing slash, and occasionally with
 * the `/openai` segment already on it (which is what the `openai` SDK calls a
 * `baseURL`). All of those must reach the same URL. Appending a second
 * `/openai` would 404 every call: accepted, and silently wrong.
 */

/**
 * Resource root → the base every Azure OpenAI path hangs off.
 *
 * `https://my-co.openai.azure.com` → `https://my-co.openai.azure.com/openai`
 * `https://my-co.openai.azure.com/` → the same
 * `https://my-co.openai.azure.com/openai` → the same (idempotent)
 *
 * This is the rule the `openai` SDK applies to its own `endpoint` option, plus
 * that idempotence.
 */
export function azureBaseUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/openai') ? trimmed : `${trimmed}/openai`;
}

/**
 * Resource root + deployment → the full chat-completions URL Azure serves.
 *
 * The deployment-scoped path is Azure's routing model: the deployment is in the
 * URL, not only in the body.
 */
export function azureChatCompletionsUrl(
  endpoint: string,
  deployment: string,
  apiVersion: string,
): string {
  return (
    `${azureBaseUrl(endpoint)}/deployments/${encodeURIComponent(deployment)}` +
    `/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
  );
}
