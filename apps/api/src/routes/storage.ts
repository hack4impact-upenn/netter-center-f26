import { Hono } from "hono";
import { upload, download, remove, list } from "../integrations/storage";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const storage = new Hono<AppEnv>();

storage.use("*", requireAuth);

storage.post("/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const key = formData.get("key") as string | null;

  if (!file || !key) {
    return c.json({ error: "File and key are required" }, 400);
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  await upload(key, buffer, file.type);

  return c.json({ key });
});

storage.get("/download/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const data = await download(key);

  if (!data) {
    return c.json({ error: "File not found" }, 404);
  }

  return new Response(data, {
    headers: { "Content-Type": "application/octet-stream" },
  });
});

storage.delete("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  await remove(key);
  return c.body(null, 204);
});

storage.get("/list", async (c) => {
  const prefix = c.req.query("prefix");
  const keys = await list(prefix);
  return c.json({ keys });
});

export default storage;
