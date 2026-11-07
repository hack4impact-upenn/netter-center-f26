import { verifyBoxPermissions } from "../src/integrations/box/permission-probe";

// Deliberately separate from `bun test` and application startup: real Box access
// must be explicitly requested, with synthetic fixtures and a user OAuth token.
try {
  const result = await verifyBoxPermissions({
    accessToken: process.env.BOX_PERMISSION_TEST_ACCESS_TOKEN ?? "",
    folderId: process.env.BOX_PERMISSION_TEST_FOLDER_ID ?? "",
    fileId: process.env.BOX_PERMISSION_TEST_FILE_ID ?? "",
    outsideFolderId: process.env.BOX_PERMISSION_TEST_OUTSIDE_FOLDER_ID ?? "",
    confirmSyntheticFixtures: process.env.BOX_PERMISSION_TEST_SYNTHETIC === "YES",
  });
  for (const check of result.checks) console.log(`${check.status}: ${check.check}`);
  console.log(
    result.verified ? "Synthetic fixture checks passed" : "Box permissions NOT verified"
  );
  process.exitCode = result.verified ? 0 : 1;
} catch (error) {
  // Input validation throws only fixed messages, never environment values.
  console.error(
    error instanceof Error ? error.message : "Permission probe could not start"
  );
  process.exitCode = 1;
}
