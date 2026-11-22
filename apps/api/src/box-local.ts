import { createBoxOAuth } from "./integrations/box/oauth";
import { MAX_CSV_BYTES } from "./integrations/box/student-folder-names";
import { createLocalBoxApp, readLocalBoxConfig } from "./routes/box-local";

const config = readLocalBoxConfig();
const app = createLocalBoxApp(
  config.origin,
  createBoxOAuth(config),
  undefined,
  Date.now,
  config.enableFolderCreation
);
Bun.serve({
  hostname: config.hostname,
  port: config.port,
  maxRequestBodySize: config.enableFolderCreation ? MAX_CSV_BYTES + 4096 : 4096,
  fetch(request, server) {
    if (
      config.enableFolderCreation &&
      request.method === "POST" &&
      /^\/folders\/\d+\/import$/.test(new URL(request.url).pathname)
    ) {
      // Each Box call has its own timeout. A CSV import spans multiple calls.
      server.timeout(request, 0);
    }
    return app.fetch(request);
  },
});
console.log(`Local Box viewer is running at ${config.origin}`);
