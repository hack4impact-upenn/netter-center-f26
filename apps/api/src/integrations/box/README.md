# Box user OAuth integration

This integration will list direct-child file names and Box creation/update
timestamps. It will not expose content, download URLs, previews, or thumbnails.
Students continue uploading directly through Box. A staff user can authorize
an account that already has access to the folders they need to inspect.

## Current implementation

Step 1 provides local configuration validation and an opt-in permissions
experiment. OAuth connection routes, token persistence, and the public listing
route are not implemented yet. See [the implementation steps](../../../../../docs/box-integration-plan.md).

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

The redirect URI must match the registered value exactly. No manual access or
refresh token belongs in the normal application configuration: the eventual
OAuth callback will acquire and persist those. The client ID and client secret
cannot obtain a user token without user authorization.

Box remains disabled if entirely unconfigured. Partial/invalid configuration
produces safe startup warnings without stopping unrelated API features.
Consumers must require `inspectBoxConfiguration().status === "ready"` before
using Box. Required D1 environment variables are unchanged; see the
[database setup guide](../database/README.md).

## Content-access boundary

The listing component must receive only a folder-restricted token with
`base_explorer`, excluding `item_download`, `item_preview`, and `base_preview`.
The original OAuth token can have broader permissions. Its exchange, refresh,
storage encryption key, and downscoping belong inside a private credential
component, separate from the public listing service. Ordinary users must not
be able to choose a token scope, substitute another connection, or mint tokens.

This separation is not implemented in step 1. It remains necessary before
claiming that compromising the listing service cannot expose parent tokens.
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
it for exactly `base_explorer` on the fixture folder, verifies listing including
names and timestamps, and requires downloads, thumbnails, preview capabilities,
and outside-folder listing to be denied. Metadata responses containing preview
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
- [Downscoping](https://developer.box.com/guides/authentication/tokens/downscope/)
- [Explorer scopes](https://developer.box.com/guides/embed/ui-elements/explorer/)
- [Folder items](https://developer.box.com/reference/get-folders-id-items/)
- [Thumbnail endpoint](https://developer.box.com/reference/get-files-id-thumbnail-id/)
