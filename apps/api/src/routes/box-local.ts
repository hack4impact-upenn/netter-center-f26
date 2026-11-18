import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { readBoxFolderMetadata } from "../integrations/box/folder-metadata";
import {
  BoxListingError,
  isBoxId,
  isBoxMarker,
  record,
  type BoxFetch,
} from "../integrations/box/listing-contract";
import type { createBoxOAuth } from "../integrations/box/oauth";

const CALLBACK = "/api/box/oauth/callback";
const ATTEMPT_COOKIE = "netter_box_local_attempt";
const SESSION_COOKIE = "netter_box_local_session";
const PAGE_SIZE = 100;
const cookie = { httpOnly: true, sameSite: "Lax", path: "/" } as const;

type OAuth = Pick<
  ReturnType<typeof createBoxOAuth>,
  "authorizationUrl" | "exchange" | "revoke"
>;

export function readLocalBoxConfig(
  env: Record<string, string | undefined> = process.env
) {
  const clientId = env.BOX_CLIENT_ID?.trim();
  const clientSecret = env.BOX_CLIENT_SECRET?.trim();
  const redirectUri = env.BOX_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri || /\s/.test(clientId + clientSecret)) {
    throw new Error(
      "Set BOX_CLIENT_ID, BOX_CLIENT_SECRET, and BOX_REDIRECT_URI in apps/api/.env"
    );
  }
  const match =
    /^http:\/\/(localhost|127\.0\.0\.1):([1-9]\d{3,4})\/api\/box\/oauth\/callback$/.exec(
      redirectUri
    );
  const hostname = match?.[1];
  const port = Number(match?.[2]);
  if (
    !hostname ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    env.NODE_ENV === "production"
  ) {
    throw new Error(
      "The local viewer requires a registered HTTP loopback callback with a port outside production"
    );
  }
  // Preserve the registered hostname, including localhost on IPv6 systems.
  const origin = redirectUri.slice(0, -CALLBACK.length);
  return { clientId, clientSecret, redirectUri, origin, hostname, port };
}

function page(content: ReturnType<typeof html>) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Local Box viewer</title>
        <link rel="icon" href="data:," />
        <style>
          body {
            max-width: 44rem;
            margin: 1rem auto;
            padding: 0 1rem;
            overflow-wrap: anywhere;
          }
          li {
            margin-block: 0.35em;
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <h1>Local Box viewer</h1>
        ${content}
      </body>
    </html>`;
}

const signIn = html`<form method="post" action="/signin">
  <button>Sign in with Box</button>
</form>`;
const navigation = html`<p><a href="/">All files and folders</a></p>
  <form method="post" action="/signout"><button>Sign out</button></form>`;

export function createLocalBoxApp(
  origin: string,
  oauth: OAuth,
  request?: BoxFetch,
  now = Date.now
) {
  const app = new Hono();
  let attempt:
    | { state: string; nonce: string; expiresAt: number; claimed: boolean }
    | undefined;
  let session: (Awaited<ReturnType<OAuth["exchange"]>> & { id: string }) | undefined;
  const secret = () => randomBytes(32).toString("base64url");

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", c.req.path === CALLBACK ? "no-referrer" : "same-origin");
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://account.box.com"
    );
    // Refuse alternate hosts and cross-origin forms on the loopback listener.
    if (
      new URL(c.req.url).origin !== origin ||
      (c.req.method === "POST" && c.req.header("Origin") !== origin)
    ) {
      return c.text("Use the configured localhost address.", 403);
    }
    await next();
  });

  app.post("/signin", (c) => {
    attempt = {
      state: secret(),
      nonce: secret(),
      expiresAt: now() + 600_000,
      claimed: false,
    };
    setCookie(c, ATTEMPT_COOKIE, attempt.nonce, { ...cookie, maxAge: 600 });
    return c.redirect(oauth.authorizationUrl(attempt.state), 303);
  });

  app.get(CALLBACK, async (c) => {
    const pending = attempt;
    const params = new URL(c.req.url).searchParams;
    if (
      c.req.method !== "GET" ||
      !pending ||
      pending.claimed ||
      pending.expiresAt <= now() ||
      params.getAll("state").length !== 1 ||
      params.get("state") !== pending.state ||
      getCookie(c, ATTEMPT_COOKIE) !== pending.nonce
    ) {
      return c.html(
        page(
          html`<p>
            Box sign-in expired or belongs to another browser. <a href="/">Try again</a>.
          </p>`
        ),
        400
      );
    }
    pending.claimed = true;
    deleteCookie(c, ATTEMPT_COOKIE, cookie);
    const code = params.get("code");
    if (
      params.has("error") ||
      params.getAll("code").length !== 1 ||
      !code ||
      !/^[\x21-\x7e]{1,2048}$/.test(code)
    ) {
      attempt = undefined;
      return c.redirect("/?signin=failed", 303);
    }

    try {
      const grant = await oauth.exchange(code);
      if (attempt !== pending || pending.expiresAt <= now()) {
        await oauth.revoke(grant.tokens.refreshToken);
        return c.redirect("/?signin=failed", 303);
      }
      const old = session;
      session = { ...grant, id: secret() };
      setCookie(c, SESSION_COOKIE, session.id, {
        ...cookie,
        maxAge: Math.max(1, Math.floor((grant.accessExpiresAt - now()) / 1000)),
      });
      if (old) await oauth.revoke(old.tokens.refreshToken);
      return c.redirect("/", 303);
    } catch {
      return c.redirect("/?signin=failed", 303);
    } finally {
      if (attempt === pending) attempt = undefined;
    }
  });

  app.post("/signout", async (c) => {
    if (attempt?.nonce === getCookie(c, ATTEMPT_COOKIE)) attempt = undefined;
    const old = session;
    if (old && getCookie(c, SESSION_COOKIE) === old.id) {
      session = undefined;
      await oauth.revoke(old.tokens.refreshToken);
    }
    deleteCookie(c, SESSION_COOKIE, cookie);
    deleteCookie(c, ATTEMPT_COOKIE, cookie);
    return c.redirect("/", 303);
  });

  async function browse(c: Context, folderId: string) {
    const params = new URL(c.req.url).searchParams;
    const suppliedMarker = params.get("marker");
    const signInFailed =
      folderId === "0" && params.size === 1 && params.get("signin") === "failed";
    if (
      (folderId !== "0" && !isBoxId(folderId)) ||
      (!signInFailed && params.size > (suppliedMarker === null ? 0 : 1)) ||
      (suppliedMarker !== null && !isBoxMarker(suppliedMarker))
    )
      return c.html(
        page(html`<p>Invalid folder or page marker. <a href="/">Start over</a>.</p>`),
        400
      );

    if (session && session.accessExpiresAt <= now()) session = undefined;
    const active = session;
    if (signInFailed || !active || getCookie(c, SESSION_COOKIE) !== active.id) {
      if (folderId !== "0" && !active) return c.redirect("/", 303);
      return c.html(
        page(html`
          ${signInFailed
            ? html`<p>Box sign-in did not complete. Please try again.</p>`
            : ""}
          <p>Browse the names of folders and files accessible to your Box account.</p>
          ${signIn}
        `)
      );
    }

    try {
      const { folderName, entries, nextMarker } = await readBoxFolderMetadata(
        { folderId, limit: PAGE_SIZE, marker: suppliedMarker ?? undefined },
        active.tokens.accessToken,
        request
      );
      if (session !== active || active.accessExpiresAt <= now())
        return c.redirect("/", 303);
      if (
        nextMarker !== null &&
        (!isBoxMarker(nextMarker) || nextMarker === suppliedMarker)
      ) {
        throw new BoxListingError("upstream");
      }
      const items = [];
      for (const raw of entries) {
        const item = record(raw);
        if (item.type === "web_link") continue;
        if (!isBoxId(item.id) || typeof item.name !== "string" || !item.name) {
          throw new BoxListingError("upstream");
        }
        if (item.type === "folder") {
          items.push(
            html`<li>Folder: <a href="/folders/${item.id}">${item.name}</a></li>`
          );
        } else if (item.type === "file") {
          items.push(html`<li>File: ${item.name}</li>`);
        } else throw new BoxListingError("upstream");
      }
      const path = folderId === "0" ? "/" : "/folders/" + folderId;
      return c.html(
        page(
          html`${navigation}
            <h2>${folderName}</h2>
            ${items.length
              ? html`<ul>
                  ${items}
                </ul>`
              : html`<p>
                  ${nextMarker
                    ? "No files or folders on this page."
                    : "No files or folders."}
                </p>`}
            ${nextMarker
              ? html`<p>
                  <a
                    href="${path}?${new URLSearchParams({
                      marker: nextMarker,
                    }).toString()}"
                    >Next page</a
                  >
                </p>`
              : ""} `
        )
      );
    } catch (error) {
      if (error instanceof BoxListingError && error.code === "token_rejected") {
        if (session === active) session = undefined;
        return c.redirect("/?signin=failed", 303);
      }
      const status = error instanceof BoxListingError ? error.status : 502;
      return c.html(
        page(
          html`${navigation}
            <p>Could not list this folder (${status}).</p>`
        ),
        status
      );
    }
  }

  app.get("/", (c) => browse(c, "0"));
  app.get("/folders/:id", (c) => browse(c, c.req.param("id")));
  return app;
}
