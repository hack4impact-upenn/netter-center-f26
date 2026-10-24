# LLM — OpenRouter

OpenRouter gives you access to hundreds of models (OpenAI, Anthropic, Meta, Google, etc.) through a single API key.

## Setup

1. Sign up at https://openrouter.ai
2. Add credits (or use free models to start)
3. Create an API key at https://openrouter.ai/keys
4. Add to your `.env`:
   ```
   OPENROUTER_API_KEY=sk-or-your-api-key
   ```

## Usage

### Simple prompt

```ts
import { ask } from "./integrations/llm";

const answer = await ask("What is the capital of France?");
```

### Conversation with message history

```ts
import { chat } from "./integrations/llm";

const response = await chat([
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "Summarize this article: ..." },
]);
```

### Using different models

```ts
import { ask } from "./integrations/llm";

// Use Claude
// Use the smartest model for complex tasks
const response = await ask("Explain monads", {
  model: "anthropic/claude-opus-4.6",
});

// Use a mid-range model for simpler tasks
const response2 = await ask("Summarize this text", {
  model: "qwen/qwen3.6-plus",
});
```

### Structured JSON output

A common pattern: ask the LLM to respond in JSON format, then parse it.

```ts
import { chat } from "./integrations/llm";

const response = await chat([
  {
    role: "system",
    content: `Analyze the text and respond in this exact JSON format:
{"summary": "...", "tags": ["tag1", "tag2"]}`,
  },
  { role: "user", content: "The text to analyze..." },
], { temperature: 0.3 });

try {
  const parsed = JSON.parse(response);
  console.log(parsed.summary, parsed.tags);
} catch {
  // LLM didn't return valid JSON — handle gracefully
}
```

Use low temperature (0.3) for structured output to reduce randomness. Always wrap `JSON.parse` in a try/catch — LLMs occasionally return malformed JSON.

## Available models

Browse all models at https://openrouter.ai/models. Some popular options:

| Model | ID | Notes |
|---|---|---|
| Grok 4.1 Fast | `x-ai/grok-4.1-fast` | Fast, capable, default |
| Qwen 3.6 Plus | `qwen/qwen3.6-plus` | Mid-range, good value |
| Claude Opus 4.6 | `anthropic/claude-opus-4.6` | Smartest, best reasoning |

## Notes

- OpenRouter uses the OpenAI-compatible API format
- Pricing varies per model — check https://openrouter.ai/models
- Free models are available for development and testing
