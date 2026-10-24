const OPENROUTER_API = "https://openrouter.ai/api/v1";

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

type ChatResponse = {
  id: string;
  choices: {
    message: Message;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export async function chat(
  messages: Message[],
  options: ChatOptions = {}
): Promise<string> {
  const {
    model = "x-ai/grok-4.1-fast",
    temperature = 0.7,
    maxTokens,
  } = options;

  const res = await fetch(`${OPENROUTER_API}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      ...(maxTokens && { max_tokens: maxTokens }),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter request failed: ${err}`);
  }

  const json = (await res.json()) as ChatResponse;
  return json.choices[0].message.content;
}

export async function ask(
  prompt: string,
  options: ChatOptions = {}
): Promise<string> {
  return chat([{ role: "user", content: prompt }], options);
}
