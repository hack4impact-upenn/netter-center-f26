import { Hono } from "hono";
import { chat, ask } from "../integrations/llm";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const llm = new Hono<AppEnv>();

llm.use("*", requireAuth);

llm.post("/chat", async (c) => {
  const body = await c.req.json<{
    messages?: { role: "system" | "user" | "assistant"; content: string }[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }>();

  if (!body.messages || body.messages.length === 0) {
    return c.json({ error: "Messages array is required" }, 400);
  }

  const response = await chat(body.messages, {
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.maxTokens,
  });

  return c.json({ response });
});

llm.post("/ask", async (c) => {
  const body = await c.req.json<{
    prompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }>();

  if (!body.prompt) {
    return c.json({ error: "Prompt is required" }, 400);
  }

  const response = await ask(body.prompt, {
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.maxTokens,
  });

  return c.json({ response });
});

export default llm;
