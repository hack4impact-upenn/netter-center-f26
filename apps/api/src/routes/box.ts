import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { inspectBoxConfiguration } from "../integrations/box/config";
import { createBoxConnectionService } from "../integrations/box/connection-service";
import { createBoxOAuth } from "../integrations/box/oauth";
import { BoxStore } from "../integrations/box/store";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

type Service = ReturnType<typeof createBoxConnectionService>;
const CALLBACK = "/api/box/oauth/callback";
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const resultMessage = {
  connected: "Box connected. You can close this tab.",
  denied: "Box authorization was declined. Return to the app to try again.",
  invalid_state:
    "This Box authorization attempt is invalid or expired. Start again in the app.",
  invalid_code: "Box rejected the authorization code. Start again in the app.",
  conflict:
    "The Box connection could not be saved. Check your connection in the app and try again.",
  unavailable: "Box authorization is temporarily unavailable. Start again in the app.",
} as const;

export function createBoxRoutes(
  setup: { service: Service; secureCookies: boolean } | null,
  auth = requireAuth
) {
  const box = new Hono<AppEnv>();
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: setup?.secureCookies,
  };
  const cookie = setup?.secureCookies ? "__Host-box_oauth_nonce" : "box_oauth_nonce";

  const responseHeaders = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  box.use("*", async (c, next) => {
    for (const [key, value] of Object.entries(responseHeaders)) c.header(key, value);
    await next();
  });
  box.onError((_error, c) => {
    // OAuth and database exceptions can include credentials or request data.
    console.error("Box connection operation failed");
    return c.json({ error: "Box connection operation failed" }, 500, responseHeaders);
  });

  box.post("/connect", auth, async (c) => {
    if (!setup) return c.json({ error: "Box is unavailable" }, 503);
    if (c.req.raw.body !== null || new URL(c.req.url).search) {
      return c.json({ error: "Connect does not accept a body or query parameters" }, 400);
    }
    const sessionToken = c.req.header("Authorization")?.slice(7);
    if (!sessionToken) return c.json({ error: "Invalid session" }, 401);
    const attempt = await setup.service.start(c.get("userId"), sessionToken);
    if (!attempt) return c.json({ error: "Invalid or expired session" }, 401);
    setCookie(c, cookie, attempt.browserNonce, { ...cookieOptions, maxAge: 600 });
    return c.json({ authorizationUrl: attempt.authorizationUrl });
  });

  box.get("/oauth/callback", async (c) => {
    if (!setup) return c.text("Box is unavailable.", 503);
    const params = new URL(c.req.url).searchParams;
    const result = params.get("result");
    if (result && [...params].length === 1 && Object.hasOwn(resultMessage, result)) {
      const outcome = result as keyof typeof resultMessage;
      return c.text(
        resultMessage[outcome],
        outcome === "unavailable"
          ? 502
          : outcome === "conflict"
            ? 409
            : outcome === "invalid_state" || outcome === "invalid_code"
              ? 400
              : 200
      );
    }

    const state = params.get("state");
    const code = params.get("code");
    const error = params.get("error");
    const nonce = getCookie(c, cookie);
    if (
      !state ||
      !STATE_PATTERN.test(state) ||
      !nonce ||
      !STATE_PATTERN.test(nonce) ||
      ["state", "code", "error"].some((key) => params.getAll(key).length > 1) ||
      params.has("result") ||
      (error !== null
        ? error !== "access_denied" || code !== null
        : !code || !/^[\x21-\x7e]{1,2048}$/.test(code))
    ) {
      return c.text(resultMessage.invalid_state, 400);
    }

    const outcome = await setup.service.finish(state, nonce, code);
    if (outcome !== "invalid_state") deleteCookie(c, cookie, cookieOptions);
    return c.redirect(`${CALLBACK}?result=${outcome}`, 303);
  });

  box.get("/connection", auth, async (c) => {
    if (!setup) return c.json({ error: "Box is unavailable" }, 503);
    if (new URL(c.req.url).search)
      return c.json({ error: "Unexpected query parameters" }, 400);
    return c.json({ connection: await setup.service.status(c.get("userId")) });
  });

  box.delete("/connection", auth, async (c) => {
    if (!setup) return c.json({ error: "Box is unavailable" }, 503);
    if (c.req.raw.body !== null || new URL(c.req.url).search) {
      return c.json(
        { error: "Disconnect does not accept a body or query parameters" },
        400
      );
    }
    const result = await setup.service.disconnect(c.get("userId"));
    deleteCookie(c, cookie, cookieOptions);
    return c.json(result);
  });

  return box;
}

const settings = inspectBoxConfiguration();
const configured =
  settings.status === "ready"
    ? {
        service: createBoxConnectionService(
          new BoxStore({ encryptionKey: settings.config.tokenEncryptionKey }),
          createBoxOAuth(settings.config)
        ),
        secureCookies: settings.config.redirectUri.startsWith("https:"),
      }
    : null;

export default createBoxRoutes(configured);
