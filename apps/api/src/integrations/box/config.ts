export const BOX_ENV_VARS = [
  "BOX_CLIENT_ID",
  "BOX_CLIENT_SECRET",
  "BOX_REDIRECT_URI",
  "BOX_TOKEN_ENCRYPTION_KEY",
] as const;

type Environment = Record<string, string | undefined>;

export type BoxOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: Uint8Array;
};

export type BoxConfiguration =
  | { status: "disabled" }
  | { status: "invalid"; errors: string[] }
  | { status: "ready"; config: BoxOAuthConfig };

// Pure validation: safe to call at startup without making a Box request.
// Error messages contain variable names and instructions, never their values.
export function inspectBoxConfiguration(
  env: Environment = process.env
): BoxConfiguration {
  const values = BOX_ENV_VARS.map((name) => env[name]?.trim() ?? "");
  if (values.every((value) => !value)) return { status: "disabled" };

  const errors: string[] = [];
  for (const [index, name] of BOX_ENV_VARS.entries()) {
    if (!values[index]) errors.push(`${name} is required to enable Box OAuth`);
  }

  const clientId = env.BOX_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.BOX_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.BOX_REDIRECT_URI?.trim() ?? "";
  const encryptionKey = env.BOX_TOKEN_ENCRYPTION_KEY?.trim() ?? "";

  for (const name of ["BOX_CLIENT_ID", "BOX_CLIENT_SECRET"] as const) {
    if (/\s/.test(env[name]?.trim() ?? "")) {
      errors.push(`${name} must not contain whitespace`);
    }
  }

  if (redirectUri) {
    try {
      const url = new URL(redirectUri);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      const allowedProtocol =
        url.protocol === "https:" ||
        (url.protocol === "http:" && loopback && env.NODE_ENV !== "production");
      if (
        !allowedProtocol ||
        !/^https?:\/\//.test(redirectUri) ||
        redirectUri.includes("\\") ||
        /\s/.test(redirectUri) ||
        url.username ||
        url.password ||
        redirectUri.includes("?") ||
        redirectUri.includes("#") ||
        url.pathname !== "/api/box/oauth/callback"
      ) {
        errors.push(
          "BOX_REDIRECT_URI must use HTTPS and /api/box/oauth/callback without credentials, query, or fragment (HTTP loopback is allowed outside production)"
        );
      }
    } catch {
      errors.push("BOX_REDIRECT_URI must be an absolute URL");
    }
  }

  // Check the encoding as well as length: Buffer.from alone accepts malformed input.
  const decodedKey = Buffer.from(encryptionKey, "base64");
  if (
    encryptionKey &&
    (decodedKey.length !== 32 || decodedKey.toString("base64") !== encryptionKey)
  ) {
    errors.push(
      "BOX_TOKEN_ENCRYPTION_KEY must be exactly 32 random bytes in standard base64"
    );
  }

  if (errors.length) return { status: "invalid", errors };
  return {
    status: "ready",
    config: { clientId, clientSecret, redirectUri, tokenEncryptionKey: decodedKey },
  };
}
