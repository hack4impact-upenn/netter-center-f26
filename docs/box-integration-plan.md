# Box integration implementation steps

Work on the existing `joshua/box-integration` branch. Make local commits after
meaningful changes and keep existing user changes out of unrelated commits.
Use OAuth user authorization now; keep credential acquisition separate from
folder listing so a new server-auth Box application can replace OAuth later.

## 1. Configuration and permission-verification foundation

- Validate OAuth configuration without exposing secret values. Register the
  configuration with API startup validation; leave Box optional when unconfigured.
- Document Box Developer Console setup, redirect URIs, required environment
  variables, credential isolation, and the metadata-only security boundary.
- Build an explicit, opt-in permissions probe for synthetic Box fixtures. Verify
  listing, expected file membership, and rejection of downloads, thumbnails,
  preview capabilities, and out-of-folder access using a folder-downscoped token.
- Test validation and probe behavior with mocked HTTP transport, including failure
  and inconclusive responses. Do not treat an expired token or missing fixture as
  proof that permissions are enforced.
- Run the real probe only after user OAuth authorization and suitable synthetic
  fixtures exist. Record live verification as pending until it actually passes.
- No HTTP routes are introduced in this step.

## 2. Persistent authorization data and token protection

- Add Box connections, short-lived OAuth attempts, exact folder grants, and
  database-backed refresh coordination to D1.
- Encrypt persisted tokens with authenticated encryption and a dedicated key.
- Test actual SQL constraints and authorization queries using local SQLite, and
  test encryption integrity and refresh ownership/concurrency behavior.

## 3. User OAuth connection lifecycle

- Add authenticated `POST /api/box/connect`, `GET /api/box/connection`, and
  `DELETE /api/box/connection`, plus the Box redirect callback.
- Bind single-use, expiring OAuth state to the initiating application session and
  browser; the callback must not require a Bearer header from a browser redirect.
- Exchange codes and refresh rotated tokens inside the credential boundary.
  Store each replacement pair atomically and require reconnection after expiry
  or revocation. Never expose parent tokens to the browser or listing service.
- Test every route using Hono `app.request()`: auth, invalid input, state expiry,
  replay, browser/session binding, connection ownership, safe responses, and
  upstream errors. Test refresh rotation and concurrent refresh attempts.

## 4. Authorized, paginated folder metadata listing

- Add `GET /api/box/folders/:folderId/files` with application authentication,
  exact folder/connection authorization, strict pagination validation, and
  `Cache-Control: no-store`.
- Obtain a folder-restricted `base_explorer` token through the credential
  component. Keep the listing component independent of OAuth vs. server auth.
- Request only `id,type,name,created_at,modified_at`; return only direct-child
  files via explicitly constructed response objects and marker pagination.
- Keep file names exact and timestamps nullable. Creation/update on Box is not
  necessarily submission into the student's folder.
- Add meaningful route and integration tests for cross-user access, no upstream
  calls on denial, pagination, filtering, metadata leakage, and error mapping.
- Do not add content, preview, thumbnail, upload, shared-link, or generic proxy
  endpoints. Keep the existing R2 integration separate.

## 5. Live verification and delivery

- Complete the synthetic-fixture permissions experiment before claiming Box
  enforces metadata-only access. Fail closed if that cannot be established.
- Verify OAuth connection, refresh, disconnect, and listing with real Box calls.
- Provide documented curl/Postman examples, including fetching every page.
- Run the API tests, monorepo tests, type checks, build, and formatting checks;
  record pre-existing failures separately from regressions.
- A frontend viewer, requirement matching, clearance decisions, events/webhooks,
  and document-content processing are outside this milestone.

## Later migration to server authentication

Create and authorize a new Box server application (Box does not allow changing
an OAuth app to server auth). Grant its service account access to the existing
folders, add a CCG credential provider, verify permissions, update credential
bindings, and revoke retired user connections. Retain folder IDs, grants,
metadata response types, pagination, and future requirement-checking logic.

## Verification status

- Step 1 code implemented: optional OAuth configuration validation, safe startup
  diagnostics, documented setup, and opt-in synthetic permissions probe. No
  public routes have been added; route auth/validation/business tests begin with
  step 3 and accompany each route implementation.
- Automated verification: 102 new Box tests and all 59 existing tests pass
  (`bun run test`: 161 total). `bun run build` passes. New Box source, scripts,
  tests, and startup integration pass an isolated strict TypeScript check using
  installed Bun types. Changed files pass Prettier and `git diff --check`.
- Pre-existing type-check failures: `bun run lint` fails because the API tsconfig
  names `bun-types`, which is not resolved by the installed dependencies. Running
  the API compiler with `--types bun` also reveals existing errors in auth,
  database, intake, LLM, storage, and older tests. These existed before step 1
  and have not been changed as part of the Box foundation.
- Existing local environment: `BOX_CLIENT_ID` and `BOX_CLIENT_SECRET` are populated;
  their validity and the app's Developer Console configuration are unverified.
- Live permissions experiment: pending user-authorized token and synthetic
  fixtures. Mocked tests do not establish Box permission enforcement.
