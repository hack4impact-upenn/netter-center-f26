import { createListingWorker } from "./integrations/box/listing-worker";
import { validListingWorkerSecret } from "./integrations/box/listing-contract";

const secret = process.env.BOX_LISTING_WORKER_SECRET;
if (!validListingWorkerSecret(secret)) {
  throw new Error(
    "BOX_LISTING_WORKER_SECRET must be a 64-character lowercase hex secret"
  );
}
if (
  process.env.BOX_CLIENT_SECRET ||
  process.env.BOX_TOKEN_ENCRYPTION_KEY ||
  process.env.CLOUDFLARE_API_TOKEN
) {
  throw new Error(
    "Start the Box listing worker with only its own configuration and secrets"
  );
}
const port = Number(process.env.PORT ?? 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid worker PORT");

export default {
  port,
  hostname: process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
  maxRequestBodySize: 32_768,
  fetch: createListingWorker(secret),
};
