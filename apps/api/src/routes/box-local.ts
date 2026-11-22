import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import {
  createBoxFolder,
  FOLDER_CREATION_RESULTS,
} from "../integrations/box/folder-creation";
import {
  readBoxFolderItems,
  readBoxFolderMetadata,
} from "../integrations/box/folder-metadata";
import {
  BoxListingError,
  isBoxId,
  isBoxMarker,
  record,
  type BoxFetch,
} from "../integrations/box/listing-contract";
import type { createBoxOAuth } from "../integrations/box/oauth";
import {
  csvStudentFolderNames,
  manualStudentFolderName,
  MAX_CSV_BYTES,
  MAX_CSV_NAMES,
} from "../integrations/box/student-folder-names";

const CALLBACK = "/api/box/oauth/callback";
const ATTEMPT_COOKIE = "netter_box_local_attempt";
const SESSION_COOKIE = "netter_box_local_session";
const PAGE_SIZE = 100;
const cookie = { httpOnly: true, sameSite: "Lax", path: "/" } as const;
const REQUIREMENT_GROUPS = [
  {
    title: "Required for everyone",
    files: [
      { label: "Pennsylvania Child Abuse", filename: "PCA.pdf" },
      { label: "Pennsylvania Access to Criminal History Search", filename: "PATCH.pdf" },
      { label: "FBI Fingerprint", filename: "FBI.pdf" },
    ],
  },
  {
    title: "Depends",
    files: [
      { label: "Mandated Reporter", filename: "MR.pdf" },
      { label: "SDP Code of Conduct", filename: "SDP.pdf" },
      { label: "International Affidavit", filename: "INTL.pdf" },
    ],
  },
];
const REQUIREMENT_FILENAMES = new Set(
  REQUIREMENT_GROUPS.flatMap(({ files }) => files.map(({ filename }) => filename))
);

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
  const enableFolderCreation = env.BOX_LOCAL_ENABLE_FOLDER_CREATION === "true";
  return {
    clientId,
    clientSecret,
    redirectUri,
    origin,
    hostname,
    port,
    enableFolderCreation,
  };
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
          .requirement-group {
            border: 1px solid #888;
            margin-block: 0.75rem;
            padding-inline: 1rem;
          }
          .requirement-group li {
            white-space: normal;
          }
        </style>
      </head>
      <body>
        <h1>Local Box viewer</h1>
        ${content}
      </body>
    </html>`;
}

const signIn = html`<p><a href="/signin">Sign in with Box</a></p>`;
const navigation = html`<p><a href="/">All files and folders</a></p>
  <form method="post" action="/signout"><button>Sign out</button></form>`;

function folderCreationForms(parentId: string, folderName: string) {
  return html`<section>
    <h3>Add student folders</h3>
    <p>Create folders in <strong>${folderName}</strong>.</p>
    <form method="post" action="/folders/${parentId}/create">
      <label>Student name <input name="name" placeholder="John Smith" required /></label>
      <button>Create folder</button>
    </form>
    <form
      method="post"
      action="/folders/${parentId}/import"
      enctype="multipart/form-data"
    >
      <p>
        CSV format: first name in column A, last name in column B. Up to ${MAX_CSV_NAMES}
        names.
      </p>
      <label
        >Names CSV <input type="file" name="csv" accept=".csv,text/csv" required
      /></label>
      <button>Import CSV</button>
    </form>
  </section>`;
}

function readFolderEntries(rawEntries: unknown[]) {
  const entries = [];
  for (const raw of rawEntries) {
    const { type, id, name } = record(raw);
    if (type === "web_link") continue;
    if (
      (type !== "file" && type !== "folder") ||
      !isBoxId(id) ||
      typeof name !== "string" ||
      !name
    ) {
      throw new BoxListingError("upstream");
    }
    entries.push({ type, id, name });
  }
  return entries;
}

function requirementsView(folderName: string, fileNames?: Set<string>) {
  const [lastName, firstName, extra] = folderName.split("_");
  const studentName =
    lastName?.trim() && firstName?.trim() && extra === undefined
      ? `${firstName} ${lastName}`
      : folderName;
  const heading = html`<h3>Requirements for ${studentName}</h3>`;
  if (!fileNames) {
    return html`<section>
      ${heading}
      <p>Could not check all files in this folder. Try again.</p>
    </section>`;
  }

  const unidentified = Array.from(fileNames).filter(
    (name) => !REQUIREMENT_FILENAMES.has(name)
  );
  return html`<section>
    ${heading}
    ${REQUIREMENT_GROUPS.map(
      ({ title, files }) =>
        html`<section class="requirement-group">
          <h4>${title}</h4>
          <ul>
            ${files.map(
              ({ label, filename }) =>
                html`<li>
                  ${label} (<code>${filename}</code>) —
                  <strong>${fileNames.has(filename) ? "Met" : "Missing"}</strong>
                </li>`
            )}
          </ul>
        </section>`
    )}
    ${unidentified.length
      ? html`<h4>Unidentified files</h4>
          <ul>
            ${unidentified.map((name) => html`<li>${name}</li>`)}
          </ul>`
      : ""}
  </section>`;
}

export function createLocalBoxApp(
  origin: string,
  oauth: OAuth,
  request?: BoxFetch,
  now = Date.now,
  enableFolderCreation = false
) {
  const app = new Hono();
  let attempt:
    | { state: string; nonce: string; expiresAt: number; claimed: boolean }
    | undefined;
  let session: (Awaited<ReturnType<OAuth["exchange"]>> & { id: string }) | undefined;
  const secret = () => randomBytes(32).toString("base64url");

  function activeSession(c: Context) {
    if (session && session.accessExpiresAt <= now()) session = undefined;
    return session?.id === getCookie(c, SESSION_COOKIE) ? session : undefined;
  }

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", c.req.path === CALLBACK ? "no-referrer" : "same-origin");
    c.header("X-Content-Type-Options", "nosniff");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
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

  app.get("/signin", (c) => {
    // Start OAuth through a navigation because Chrome can block cross-origin form redirects.
    if (c.req.method !== "GET" || c.req.header("Sec-Fetch-Site") !== "same-origin") {
      return c.text("Start sign-in from the local viewer.", 403);
    }
    attempt = {
      state: secret(),
      nonce: secret(),
      expiresAt: now() + 600_000,
      claimed: false,
    };
    setCookie(c, ATTEMPT_COOKIE, attempt.nonce, { ...cookie, maxAge: 600 });
    const scope = enableFolderCreation ? "root_readonly root_readwrite" : "root_readonly";
    return c.redirect(oauth.authorizationUrl(attempt.state, scope), 303);
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

  function folderCreationRoute(mode: "create" | "import") {
    return async (c: Context) => {
      const parentId = c.req.param("id");
      if (!enableFolderCreation) return c.notFound();
      const active = activeSession(c);
      if (!active)
        return c.html(
          page(
            html`<p>
              Sign in to create student folders. <a href="/">Back to viewer</a>.
            </p>`
          ),
          401
        );
      if (parentId !== "0" && !isBoxId(parentId))
        return c.text("Invalid parent folder.", 400);

      const destination = parentId === "0" ? "/" : `/folders/${parentId}`;
      const back = html`<p><a href="${destination}">Back to folder</a></p>`;
      function invalid(message: string, status: 400 | 413 | 415 = 400) {
        return c.html(
          page(
            html`<p>${message}</p>
              ${back}`
          ),
          status
        );
      }

      const csvMode = mode === "import";
      const expectedType = csvMode
        ? "multipart/form-data"
        : "application/x-www-form-urlencoded";
      if (
        c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== expectedType
      ) {
        return invalid("Submit the form from the local viewer.", 415);
      }

      const form = await c.req.formData().catch(() => null);
      if (!form) return invalid("Could not read the submitted form.");
      const entries = form.getAll(csvMode ? "csv" : "name");
      const [value] = entries;
      let names: string[];
      if (csvMode) {
        if (entries.length !== 1 || !(value instanceof File) || !value.size) {
          return invalid("Choose one CSV file with student names.");
        }
        if (value.size > MAX_CSV_BYTES)
          return invalid("Use a CSV file no larger than 64 KiB.", 413);
        let csv: string;
        try {
          csv = new TextDecoder("utf-8", { fatal: true }).decode(
            await value.arrayBuffer()
          );
        } catch {
          return invalid("Save the CSV as UTF-8 and try again.");
        }
        const parsed = csvStudentFolderNames(csv);
        if ("error" in parsed) return invalid(parsed.error);
        names = parsed.names;
      } else {
        const name = typeof value === "string" ? manualStudentFolderName(value) : null;
        if (entries.length !== 1 || !name) {
          return invalid("Enter a first and last name, such as John Smith.");
        }
        names = [name];
      }

      const uniqueNames = new Set(names);
      const rows = [];
      const duplicateCount = names.length - uniqueNames.size;
      let stopped = false;
      let status: 200 | keyof typeof FOLDER_CREATION_RESULTS = 200;
      for (const name of uniqueNames) {
        if (stopped) {
          rows.push(html`<li>${name} — Not attempted</li>`);
          continue;
        }
        if (activeSession(c) !== active || c.req.raw.signal.aborted) {
          return c.html(
            page(
              html`<p>Sign in again and check the destination folder before retrying.</p>
                ${back}`
            ),
            401
          );
        }
        const result = await createBoxFolder(
          parentId,
          name,
          active.tokens.accessToken,
          request
        );
        if (activeSession(c) !== active) {
          return c.html(
            page(
              html`<p>Sign in again and check the destination folder before retrying.</p>
                ${back}`
            ),
            401
          );
        }
        if (result.status === 401) session = undefined;
        if (!csvMode) status = result.status;
        stopped = result.status !== 201 && result.status !== 400 && result.status !== 409;
        const item =
          result.status === 201
            ? html`<a href="/folders/${result.id}">${name}</a>`
            : name;
        rows.push(html`<li>${item} — ${FOLDER_CREATION_RESULTS[result.status]}</li>`);
      }

      return c.html(
        page(
          html`<h2>Folder creation results</h2>
            <ul>
              ${rows}
            </ul>
            ${duplicateCount
              ? html`<p>Repeated names skipped: ${duplicateCount}.</p>`
              : ""}
            ${back}`
        ),
        status
      );
    };
  }

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

    const active = activeSession(c);
    if (signInFailed || !active) {
      if (folderId !== "0" && !session) return c.redirect("/", 303);
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

    const canBrowse = () => session === active && active.accessExpiresAt > now();
    const input = { folderId, limit: PAGE_SIZE, marker: suppliedMarker ?? undefined };
    const token = active.tokens.accessToken;
    try {
      const displayedPage = await readBoxFolderMetadata(input, token, request);
      const { folderName, nextMarker } = displayedPage;
      if (!canBrowse()) return c.redirect("/", 303);
      if (
        nextMarker !== null &&
        (!isBoxMarker(nextMarker) || nextMarker === suppliedMarker)
      ) {
        throw new BoxListingError("upstream");
      }
      const entries = readFolderEntries(displayedPage.entries);
      const items = entries.map(({ type, id, name }) =>
        type === "folder"
          ? html`<li>Folder: <a href="/folders/${id}">${name}</a></li>`
          : html`<li>File: ${name}</li>`
      );

      let requirements;
      if (folderId !== "0") {
        try {
          const fileNames = new Set<string>();
          const visitedMarkers = new Set<string>();
          let marker: string | undefined;
          // Scan from the first page, reusing whichever page the browser is viewing.
          while (true) {
            const isDisplayedPage = marker === input.marker;
            const currentPage = isDisplayedPage
              ? displayedPage
              : await readBoxFolderItems({ ...input, marker }, token, request);
            if (!canBrowse()) return c.redirect("/", 303);
            for (const entry of isDisplayedPage
              ? entries
              : readFolderEntries(currentPage.entries)) {
              if (entry.type === "file") fileNames.add(entry.name);
            }
            const next = currentPage.nextMarker;
            if (next === null) break;
            if (!isBoxMarker(next) || visitedMarkers.has(next))
              throw new BoxListingError("upstream");
            visitedMarkers.add(next);
            marker = next;
          }
          requirements = requirementsView(folderName, fileNames);
        } catch (error) {
          if (!(error instanceof BoxListingError) || error.code === "token_rejected")
            throw error;
          if (!canBrowse()) return c.redirect("/", 303);
          requirements = requirementsView(folderName);
        }
      }
      const path = folderId === "0" ? "/" : "/folders/" + folderId;
      return c.html(
        page(
          html`${navigation}
            <h2>${folderName}</h2>
            ${enableFolderCreation ? folderCreationForms(folderId, folderName) : ""}
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
              : ""}
            ${requirements ?? ""}`
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
  app.post("/folders/:id/create", folderCreationRoute("create"));
  app.post("/folders/:id/import", folderCreationRoute("import"));
  return app;
}
