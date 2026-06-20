---
title: browserAzureOpenai
---

# Function: browserAzureOpenai()

> **browserAzureOpenai**(`options`): [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/adapters/llm/BrowserOpenAIProvider.ts:305](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/BrowserOpenAIProvider.ts#L305)

Fetch-based **Azure OpenAI** provider for the browser/edge — no SDK, no Node.

The browser can't use the Node `azureOpenai()` (it needs the `openai` SDK), so
use this in a browser "bring your own (company) key" flow. Builds the
deployment-scoped Azure URL + `api-key` header + `api-version`, and reuses all
of `browserOpenai()`'s body/streaming/tool logic. The request `model` is the
deployment; `'azure'` resolves to the configured `deployment`.

**CORS:** an `*.openai.azure.com` resource may not allow direct browser calls;
if blocked, point `endpoint` at a same-origin proxy (e.g. a Vite `/azure`
proxy) or a backend. Same trade-off as `browserOpenai`.

## Parameters

### options

[`BrowserAzureOpenAIProviderOptions`](/docs/api/interfaces/BrowserAzureOpenAIProviderOptions)

## Returns

[`LLMProvider`](/docs/api/interfaces/LLMProvider)

## Example

```ts
import { browserAzureOpenai } from 'agentfootprint';
  const provider = browserAzureOpenai({
    endpoint: 'https://my-co.openai.azure.com',
    apiKey: userKey, apiVersion: '2024-12-01-preview', deployment: 'gpt-4o-128k',
  });
  // Agent.create({ provider, model: 'azure' })
```
