import { createBoxOAuth } from "./integrations/box/oauth";
import { createLocalBoxApp, readLocalBoxConfig } from "./routes/box-local";

const config = readLocalBoxConfig();
const app = createLocalBoxApp(config.origin, createBoxOAuth(config));
Bun.serve({
  hostname: config.hostname,
  port: config.port,
  maxRequestBodySize: 4096,
  fetch: app.fetch,
});
console.log(`Box metadata viewer is running at ${config.origin}`);
