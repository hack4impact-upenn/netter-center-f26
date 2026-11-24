import { inspectListingWorker } from "./integrations/box/listing-worker-client";
import { BOX_ENV_VARS, inspectBoxConfiguration } from "./integrations/box/config";

type EnvVar = {
  name: string;
  required: boolean;
  integration: string;
};

const ENV_VARS: EnvVar[] = [
  // Core
  { name: "PORT", required: false, integration: "core" },

  // Cloudflare (shared by D1, R2)
  { name: "CLOUDFLARE_ACCOUNT_ID", required: true, integration: "cloudflare" },
  { name: "CLOUDFLARE_API_TOKEN", required: true, integration: "cloudflare" },

  // D1
  { name: "D1_DATABASE_ID", required: true, integration: "database" },

  // Box is optional. Partial/invalid configuration disables Box, not the API.
  ...BOX_ENV_VARS.map((name) => ({ name, required: false, integration: "box" })),

  // R2
  { name: "R2_BUCKET_NAME", required: false, integration: "storage" },
  { name: "R2_ACCESS_KEY_ID", required: false, integration: "storage" },
  { name: "R2_SECRET_ACCESS_KEY", required: false, integration: "storage" },

  // Email (Resend)
  { name: "RESEND_API_KEY", required: false, integration: "email" },
  { name: "EMAIL_FROM", required: false, integration: "email" },
  { name: "ADMIN_EMAILS", required: false, integration: "email" },
  { name: "FILE_NAME_FORMAT", required: false, integration: "email" },

  // LLM
  { name: "OPENROUTER_API_KEY", required: false, integration: "llm" },

  // Payments
  { name: "STRIPE_SECRET_KEY", required: false, integration: "payments" },
  { name: "STRIPE_WEBHOOK_SECRET", required: false, integration: "payments" },

  // Intake
  { name: "X_BEARER_TOKEN", required: false, integration: "intake" },

  // CORS
  { name: "CORS_ORIGIN", required: false, integration: "core" },
];

export function validateEnv(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const v of ENV_VARS) {
    if (!process.env[v.name]) {
      if (v.required) {
        missing.push(`  ✗ ${v.name} (${v.integration})`);
      } else {
        warnings.push(`  - ${v.name} (${v.integration})`);
      }
    }
  }

  const box = inspectBoxConfiguration();
  if (box.status === "invalid") {
    warnings.push(...box.errors.map((error) => `  - Box unavailable: ${error}`));
  }

  if (
    (process.env.BOX_LISTING_WORKER_URL || process.env.BOX_LISTING_WORKER_SECRET) &&
    !inspectListingWorker()
  ) {
    warnings.push(
      "  - Box listing unavailable: check BOX_LISTING_WORKER_URL, BOX_LISTING_WORKER_SECRET, and BOX_LISTING_PERMISSIONS_VERIFIED"
    );
  }

  if (warnings.length > 0) {
    console.log(
      `\n⚠ Optional env vars not set (integrations will be unavailable):\n${warnings.join("\n")}\n`
    );
  }

  if (missing.length > 0) {
    console.error(
      `\n✗ Missing required environment variables:\n${missing.join("\n")}\n\nCopy .env.example to .env and fill in the values.\n`
    );
    process.exit(1);
  }
}
