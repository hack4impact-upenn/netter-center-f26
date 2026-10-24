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

  // R2
  { name: "R2_BUCKET_NAME", required: false, integration: "storage" },
  { name: "R2_ACCESS_KEY_ID", required: false, integration: "storage" },
  { name: "R2_SECRET_ACCESS_KEY", required: false, integration: "storage" },

  // Auth
  { name: "RESEND_API_KEY", required: false, integration: "auth" },

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
