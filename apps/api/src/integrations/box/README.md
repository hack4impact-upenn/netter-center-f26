# Box user OAuth integration

This integration will list direct-child file names and Box creation/update
timestamps. It will not expose content, download URLs, previews, or thumbnails.
Students continue uploading directly through Box. A staff user can authorize
an account that already has access to the folders they need to inspect.

## Current implementation

The backend provides configuration validation, a permissions probe, encrypted
token persistence, OAuth routes, paginated folder metadata listing, and a local
browser test page.
See [the implementation steps](../../../docs/box-integration-plan.md).

## Browse your Box account locally without D1

From `apps/api`, run `bun run dev:box` and open
[http://localhost:3001](http://localhost:3001). Select **Sign in with Box**.
The viewer opens the root of the signed-in account. Click a folder to browse
inside it and **Next page** to see additional names.

The local viewer also shows a checklist for each folder you open. Folder names
in `LastName_FirstName` format appear as `FirstName LastName` in the checklist.
The **Required for everyone** group checks for `PCA.pdf`, `PATCH.pdf`, and
`FBI.pdf`. The **Depends** group checks for `MR.pdf`, `SDP.pdf`, and `INTL.pdf`.
Both groups use **Met** or **Missing** based on exact, case-sensitive filenames
across every page of the folder's direct children. Other filenames appear under
**Unidentified files**.

Set `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, and `BOX_REDIRECT_URI` in
`apps/api/.env` if needed. Register the exact callback in the Box Developer
Console. The default local callback is
`http://localhost:3001/api/box/oauth/callback`. Stop the regular API first if
it is already using the callback port. The viewer refuses to run in production.

The standalone server binds to loopback and keeps its single browser session
and Box tokens in memory. Sign-out clears the session and attempts Box
revocation. When the process stops or the access token expires, sign in again.
D1, an app login, the listing worker, and an encryption key are unnecessary
for this viewer.

By default, the viewer uses the signed-in user's read-only OAuth token. It
renders folder names and filenames as text. The regular API's folder-grant and
live permission checks still apply to its separate listing endpoint.

### Create student folders from the local viewer

1. In the dedicated local OAuth app's Box Developer Console configuration, enable
   **Read and write all files and folders** and keep **Read all files and folders** enabled.
2. Sign in to the local viewer, open the destination, and select **Enable folder
   creation**. Approve the requested access in Box. The viewer returns to the
   destination and displays the creation forms. Box's write scope is broader
   than folder creation. The viewer only sends a folder-create request for
   these forms.
   See [Box API scopes](https://developer.box.com/guides/api-calls/permissions-and-errors/scopes).
3. Open the destination in the viewer and use **Create folder** or **Import CSV**.
   On **All Files**, folders are created at the account root. `John Smith`
   becomes `SMITH_JOHN`. Manual entry treats the last word as the surname.
   Use CSV for surnames that contain spaces.

The CSV is UTF-8 with first names in column A and last names in column B. A
`First Name,Last Name` header is optional. The viewer accepts up to 100 names
in a file of up to 64 KiB, validates the entire file before writing, and skips
duplicate names within the file. Results show which folders were created and
which names are already in use. After a permission error, rate limit, or
unconfirmed write, the results also show which remaining names were unattempted.
The CSV is parsed locally. Only the generated folder names are sent to Box.

This work is limited to backend Box integration. The production frontend is
owned by another team; `apps/web` is outside this work's scope. Step 5 will add
an intentionally basic, development-only test page under `apps/api` that lists
file names alongside their containing folder's name and ID.

**Live Box permission enforcement is unverified.** Passing mocked tests only
verifies the experiment's logic, not Box's actual enforcement.

## Configure OAuth

1. Open the [Box Developer Console](https://app.box.com/developers/console).
   Create or inspect a Platform App using **User / OAuth 2.0** authentication.
   Existing client credentials alone do not identify its authentication type.
2. Copy its client ID and client secret into `apps/api/.env` if not already set.
   Never put them in `apps/web/.env`, client code, or source control.
3. Register the exact callback URI, locally
   `http://localhost:3001/api/box/oauth/callback`. Register the deployed API's
   HTTPS callback separately for production. HTTP is allowed only on loopback
   hosts outside production. No query string, fragment, or URL credentials.
4. Start with the application's read scope (`root_readonly`) and verify actual
   permissions; scope names alone do not prove that previews/content are blocked.
   Do not enable user administration or write permissions for folder listing.
   Institution policy may still require approval of user OAuth applications.
5. Generate a dedicated 32-byte token encryption key:

   ```sh
   bun -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'
   ```

6. Configure:

   ```dotenv
   BOX_CLIENT_ID=<from the Developer Console>
   BOX_CLIENT_SECRET=<from the Developer Console>
   BOX_REDIRECT_URI=http://localhost:3001/api/box/oauth/callback
   BOX_TOKEN_ENCRYPTION_KEY=<generated key>
   ```

The redirect URI must match the registered value exactly. The OAuth callback
acquires and persists tokens automatically. The client ID and client secret
cannot obtain a user token without user authorization.

Box remains disabled if entirely unconfigured. Partial/invalid configuration
produces safe startup warnings without stopping unrelated API features.
Consumers must require `inspectBoxConfiguration().status === "ready"` before
using Box. Required D1 environment variables are unchanged; see the
[database setup guide](../database/README.md).

## Connection routes

| Method and path               | Behavior                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/box/connect`       | Send a live app Bearer session with an empty request. The response sets an HttpOnly browser cookie and returns `{ "authorizationUrl": "…" }`.                                                                                                                                                                                              |
| `GET /api/box/oauth/callback` | Box sends the browser here after authorization. The API matches state and the browser cookie, checks the initiating session, exchanges the code with Box, and verifies the account through `/users/me`. A 303 redirect strips the code and state from the result URL.                                                                      |
| `GET /api/box/connection`     | Send a live app Bearer session. Returns `{ "connection": null }` or a connection with `boxUserId`, `status`, and nullable `accessExpiresAt` in Unix milliseconds.                                                                                                                                                                          |
| `DELETE /api/box/connection`  | Send a live app Bearer session with an empty request. Cancels pending attempts, removes the connection and folder grants, and attempts Box revocation. Returns `{ "disconnected": true, "revocationConfirmed": true }` when Box confirms revocation or no local connection existed. A false value means revocation could not be confirmed. |

Start the flow by calling `/connect` from the browser that will navigate to
`authorizationUrl`. Use the API's own origin or an application reverse proxy
on the callback's hostname so the browser stores the cookie for that host.
The cookie supports one outstanding authorization flow per browser, expires
after ten minutes, and uses `SameSite=Lax` for the top-level Box redirect.
HTTPS uses a Secure, host-only cookie. The callback result page is informational.
Use the authenticated connection endpoint to confirm the connection.

Status returns `active`, `refreshing`, or `reconnect_required`. Checking status
starts a server-side refresh when the access token has at most one minute
remaining. A concurrent status request may see `refreshing` while the first
refresh finishes. A rejected or uncertain refresh returns `reconnect_required`.
All connection routes send `Cache-Control: no-store` and omit Box tokens.

## List files in an authorized folder

Call `GET /api/box/folders/:folderId/files` with the application's Bearer
session. The caller needs an exact D1 grant for the folder on their own Box
connection. Box must also permit that account to access the folder. Provision
grants through trusted D1 operations or the backend `grantFolder` helper.

```sh
curl --get "http://localhost:3001/api/box/folders/123456789/files" \
  --header "Authorization: Bearer ${APP_SESSION_TOKEN}" \
  --data-urlencode "limit=100"
```

```json
{
  "folderId": "123456789",
  "folderName": "Clearance documents",
  "files": [
    {
      "id": "987654321",
      "name": "Clearance.pdf",
      "createdAt": "2026-11-17T12:00:00-05:00",
      "modifiedAt": null
    }
  ],
  "nextMarker": null
}
```

`limit` defaults to 100 and accepts an integer from 1 through 1,000. When
`nextMarker` is present, send it URL-encoded as the next request's `marker`
with the same folder and page size. Continue until it is `null`. A page that
contains only folders or web links has an empty `files` array and may still
have a next marker. Listings contain only direct-child files. Names and Box
timestamps are preserved, with `null` for missing dates. These timestamps
describe creation and updates on Box and may differ from the submission date.

To fetch every page with curl and jq, set `API_ORIGIN`, `FOLDER_ID`, and
`APP_SESSION_TOKEN` in your shell. Use the app session token from
`POST /api/auth/login` for the test account. Running the loop prints one JSON
object per page. Treat the run as complete only when it exits successfully.

```sh
(
  set -eu
  marker=''
  newline='
'
  seen=$newline
  while :; do
    set -- --data-urlencode 'limit=100'
    if [ -n "$marker" ]; then
      set -- "$@" --data-urlencode "marker=$marker"
    fi
    page=$(curl --fail --silent --show-error --get \
      --header "Authorization: Bearer $APP_SESSION_TOKEN" \
      "$@" "$API_ORIGIN/api/box/folders/$FOLDER_ID/files")
    printf '%s\n' "$page"
    next=$(printf '%s\n' "$page" | jq -r '.nextMarker // empty')
    [ -n "$next" ] || break
    case "$seen" in
      *"$newline$next$newline"*)
        printf '%s\n' 'Box repeated a pagination marker.' >&2
        exit 1
        ;;
    esac
    seen="$seen$next$newline"
    marker=$next
  done
)
```

In Postman, use Bearer Token authorization with the app session. Set `limit`
and `marker` in the Params table so Postman encodes the marker. Omit `marker` on
the first request, then use each response's `nextMarker` until it is `null`.
The connection route table and this response shape are the frontend handoff.

Responses use `Cache-Control: no-store`. Failure responses keep Box errors
and credentials private. Use the connection status endpoint to check a
connection that needs attention.

| Status        | Meaning                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `400`         | Invalid folder ID, pagination input, or marker rejected by Box                                             |
| `401`         | Missing or invalid application session                                                                     |
| `404`         | No matching grant, or Box denied access or could not find the folder                                       |
| `409`         | `reconnect_required` for the granted connection                                                            |
| `503`         | Listing unavailable, a refresh is in progress, or Box rate limited the request (may include `Retry-After`) |
| `502` / `504` | Upstream listing failure or timeout                                                                        |

## Run the private listing worker

Generate a dedicated worker secret with `openssl rand -hex 32`. Set
`BOX_LISTING_WORKER_URL` to the worker's origin and
`BOX_LISTING_WORKER_SECRET` to the generated secret in `apps/api/.env`.
The worker and the API use the same worker secret. Only the API gets the
Box OAuth credentials, token encryption key, and Cloudflare D1 credentials.

For local development, set `BOX_LISTING_WORKER_URL=http://127.0.0.1:3002`.
From `apps/api`, enter the shared secret at the prompt and start the worker
in a separate process:

```sh
read -r -s BOX_LISTING_WORKER_SECRET
export BOX_LISTING_WORKER_SECRET
bun run start:box-listing-worker
```

The worker command disables dotenv loading and binds to loopback by default.
For deployment, run `bun --no-env-file dist/box-listing-worker.js` from the
API build directory's parent in a separate service or container. Set its
`NODE_ENV=production`, `PORT`, and `BOX_LISTING_WORKER_SECRET`. Give the worker
its own filesystem and environment, without the API's `.env` or secret mounts.
Put it behind a private HTTPS origin reachable by the API. The worker's single
POST operation authenticates the API before parsing the request. Configure
logging to omit request bodies and Authorization headers on the private origin.

Complete the synthetic Box permission experiment before using the listing route
with student folders. This includes verifying both folder-name lookup and item
listing with the same restricted scope in your Box tenant. Leave
`BOX_LISTING_PERMISSIONS_VERIFIED=false` until the probe succeeds. Record the
sanitized result, set `BOX_LISTING_PERMISSIONS_VERIFIED=true` on the API, and
restart it. This is an operator confirmation of a completed live check. Reset
it and repeat the probe after relevant Box app scope or policy changes. The API
returns `503 unavailable` for listing while the setting is off.

## Local browser test page

Set `NODE_ENV=development` and `BOX_ENABLE_TEST_PAGE=true` in `apps/api/.env`.
Start the API and worker, then open
[the Box test page](http://localhost:3001/api/box/test) on the same hostname
registered in `BOX_REDIRECT_URI`. The page and its script are available only
with both development settings.

1. Sign in with a test app account. Select **Connect Box**, follow the link in
   the new tab, and use **Check connection** after returning from Box.
2. With a trusted D1 client, grant the test user the exact synthetic folder IDs.
   This example grants one folder through that user's active connection.

   ```sql
   INSERT INTO box_folder_access (user_id, box_folder_id, connection_id, created_at)
   SELECT user_id, '<synthetic-folder-id>', id, unixepoch() * 1000
   FROM box_connections
   WHERE user_id = '<test-app-user-id>' AND status = 'active'
   ON CONFLICT (user_id, box_folder_id) DO NOTHING;
   ```

3. Enter the granted IDs and select **List files**. Confirm pagination with a
   folder that spans pages, compare the complete lists with Box, and try an
   ungranted ID to check the failure message. The page lists only file names
   and each containing folder's name and ID.
4. To test refresh with a live connection, check it after the access token
   expires or move its stored expiry into the past on the test database. Confirm
   the status becomes active with a renewed expiry and listing still works.
5. Select **Disconnect Box** and confirm the revocation result. Check that the
   connection is absent and the test grants have been removed. Sign out.

Sign-in credentials go to the existing app login endpoint. The test page keeps
the app session in memory and sends it through the Authorization header.

## Persistent authorization and token storage

Configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `D1_DATABASE_ID` in
`apps/api/.env` using the [database setup guide](../database/README.md). Add
`BOX_TOKEN_ENCRYPTION_KEY` using the generation command above if it is not already
set. Keep the same key across credential-service instances and restarts.

From `apps/api`, apply the additive schema through the existing setup command:

```sh
bun run setup
```

The schema can be reapplied and preserves existing users and sessions. It adds
`box_connections`, `box_oauth_attempts`, `box_folder_access`, and their indexes.
Setup also adds the `users.role` column with the `ta` default on databases
created before roles were introduced.
All new timestamps use integer Unix milliseconds. Existing session timestamps
continue to support both ISO strings and SQLite datetime strings.

Instantiate the store inside the private credential component with the decoded
32-byte key from `inspectBoxConfiguration()`:

```ts
import { BoxStore } from "./integrations/box/store";

const store = new BoxStore({ encryptionKey: config.tokenEncryptionKey });
```

- `createOAuthAttempt(userId, sessionToken)` requires a live application session
  owned by that user. It returns random state and browser nonce values for the
  authorization URL and browser cookie. SHA-256 hashes are persisted for those
  values, alongside a foreign-key reference to the initiating session. Attempts
  expire after ten minutes. Creating a new attempt also removes expired attempts.
- `claimOAuthAttempt(state, browserNonce)` verifies the hashes, deadline, and
  session. It atomically exchanges the state hash for a server-only claim so only
  one callback can proceed. Saving the connection rechecks that claim and session.
  Logout and disconnect can cancel the claim while Box requests are in flight.
- `saveConnection(...)` keeps one Box connection per application user and encrypts
  the access/refresh pair together with AES-256-GCM. Each write uses a random
  12-byte nonce and authenticates the connection ID, application user, Box user,
  and token version. The versioned envelope supports future format changes.
- Reconnecting the same Box account preserves folder grants. Switching accounts
  requires disconnecting through the API, which cascades deletion of that
  connection's folder grants. Concurrent saves use an expected token version,
  returning `null` if another save or disconnect wins the race.
- `grantFolder`, `revokeFolder`, and `getFolderConnection` operate on exact folder
  IDs. Provisioning belongs to trusted backend code. Composite foreign keys
  enforce that each grant uses its application user's own connection.
- `getConnection` and `getFolderConnection` return explicit metadata objects.
  Credential methods are reserved for the private credential component.

Store `null`/`false` results represent rejected or conflicting operations.
Persistence errors throw a sanitized error and must be propagated as errors.
The D1 transport also rejects malformed or failed query envelopes.

### Refresh coordination

1. Read connection metadata and use `getActiveTokens(userId, connectionId)` for
   unexpired credentials. A locked, expired, or missing connection returns `null`.
2. Call `acquireRefresh(userId, connectionId, expectedVersion)` when a refresh is
   needed. Only one database client can acquire the two-minute lease. The lease
   contains the old token pair and identifiers needed to complete the operation.
3. Exchange the refresh token with Box in step 3's credential component, then
   call `completeRefresh(lease, replacementPair, accessExpiresAt)`. This persists
   the entire pair in a single conditional SQL update, increments its version,
   and releases the lease. Completion requires the matching owner, connection,
   Box user, version, lock ID, and an unexpired lease.
4. After a rejected or uncertain refresh outcome, call `failRefresh(lease)`.
   It clears credentials and sets `reconnect_required` only while that lease
   still owns the row. If a successful write merely lost its response, the
   version guard preserves the replacement pair that was already committed.

An expired lease cannot be reacquired using the old refresh token. The next
`acquireRefresh` call clears the uncertain credentials and requires reconnection.
Later refresh completions cannot overwrite a reconnection or recreate a deleted
connection. Credential callers must honor `reconnect_required`, even when an
existing folder grant remains available to identify the affected connection.

Losing or replacing the encryption key makes existing ciphertext unreadable.
Back up the key in the deployment secret store. Reconnection writes credentials
under the configured key. Automated key rotation is a future credential-service
operation.

## Content-access boundary

The listing component must receive only a folder-restricted token with
`base_explorer`, excluding `item_download`, `item_preview`, and `base_preview`.
The original OAuth token can have broader permissions. Its exchange, refresh,
storage encryption key, and downscoping belong inside a private credential
component, separate from the public listing service. Ordinary users must not
be able to choose a token scope, substitute another connection, or mint tokens.

The credential service runs in the API process. It checks the exact grant
before requesting a token and checks the grant and credential version again
before dispatch. It requires Box's response to identify exactly the
`base_explorer` restriction on the requested folder. The separate worker
receives that token, the folder ID, and pagination input. It requests only
`id,name` for the folder and `id,type,name,created_at,modified_at` for its
items. The API validates and projects the worker response again before serving it.
Even with isolation, the credential component is privileged. The feature does
not alter the Box account holder's existing access through Box itself.

## Opt-in synthetic-fixture permissions experiment

Use only folders and a preview-ready PDF containing synthetic data. This script
deliberately calls content/thumbnail endpoints to check access; it cancels their
bodies and never follows redirects. It must never be run with student documents.
It is not mounted as an application route and never runs during startup or tests.

Prepare:

- A small synthetic fixture folder, with the PDF visible in its first 1,000
  items. Confirm its preview and PNG thumbnail have finished generating.
- The PDF's file ID. It must be directly inside that folder.
- A second folder outside the first folder's subtree.
- A user-authorized OAuth parent token that can access both folders and the
  synthetic PDF's download, thumbnail, and preview capabilities. Obtain this
  through a user OAuth flow; the application's client secret is not a token.
  Keep this temporary token out of shell history and source control.

The probe requires positive controls for all these capabilities. If the parent
token already lacks a capability, or Box has not generated a preview/thumbnail,
the result is **inconclusive**. Do not broaden production application scopes just
to make a positive control pass. Use an appropriately configured synthetic test
application or record that the experiment still needs a suitable control.

Provide these temporary variables in your local, ignored environment:

```dotenv
BOX_PERMISSION_TEST_SYNTHETIC=YES
BOX_PERMISSION_TEST_ACCESS_TOKEN=<user OAuth parent token>
BOX_PERMISSION_TEST_FOLDER_ID=<synthetic folder ID>
BOX_PERMISSION_TEST_FILE_ID=<synthetic PDF ID>
BOX_PERMISSION_TEST_OUTSIDE_FOLDER_ID=<accessible outside folder ID>
```

Then, from `apps/api`, run:

```sh
bun run verify:box-permissions
```

The script checks fixture identity and access with the parent token, exchanges
it for exactly `base_explorer` on the fixture folder, verifies folder name lookup
and listing including names and timestamps, and requires downloads, thumbnails,
preview capabilities, and outside-folder listing to be denied. Metadata responses containing preview
capabilities fail the check. Explicit 403/404 denials count only after positive
controls succeed. Authentication errors, network errors, rate limits, invalid
JSON, missing fixtures, and pending thumbnails never count as successful denials.

Exit code 0 means all implemented synthetic-fixture checks passed; 1 means failed
or inconclusive. Output contains fixed check labels only, never tokens, file
names, raw Box errors, or capability URLs. Keep any experiment record limited
to the date, app configuration/scopes, and these sanitized results. Remove the
temporary parent token from the environment afterward. The short-lived exchanged
token is kept only in process memory until the script exits.

This is a targeted experiment, not a proof about every Box API. Review other
content surfaces and rerun the experiment when app scopes or policy change.
Do not release a metadata-only guarantee based on mocked tests or an
inconclusive live experiment.

## Automated checks

From `apps/api`:

```sh
bun test src/integrations/box/__tests__
```

Tests use synthetic responses and an injected HTTP transport; they never contact
Box or read real credentials. Configuration startup checks use subprocesses with
isolated environments and automatic `.env` loading disabled.

## Later server authentication

Keep the listing route independent of token acquisition. Add a CCG provider when
the institution permits server authentication, grant its service account access
to the existing folders, verify restricted tokens, and switch credential
bindings. Box requires a new server application; an OAuth app cannot be converted.

## Official references

- [OAuth setup](https://developer.box.com/guides/authentication/oauth2/oauth2-setup/)
- [OAuth without an SDK](https://developer.box.com/guides/authentication/oauth2/without-sdk/)
- [Single-use refresh token rotation](https://developer.box.com/guides/authentication/tokens/refresh/)
- [Token revocation](https://developer.box.com/guides/authentication/tokens/revoke/)
- [Downscoping](https://developer.box.com/guides/authentication/tokens/downscope/)
- [Explorer scopes](https://developer.box.com/guides/embed/ui-elements/explorer/)
- [Folder items](https://developer.box.com/reference/get-folders-id-items/)
- [Folder information](https://developer.box.com/reference/get-folders-id/)
- [Thumbnail endpoint](https://developer.box.com/reference/get-files-id-thumbnail-id/)
