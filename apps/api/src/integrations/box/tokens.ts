import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type BoxTokenPair = { accessToken: string; refreshToken: string };

export type BoxTokenContext = {
  connectionId: string;
  userId: string;
  boxUserId: string;
  tokenVersion: number;
};

export function validateBoxTokens(value: unknown): asserts value is BoxTokenPair {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid Box token pair");
  }
  const tokens = value as Record<string, unknown>;
  for (const field of ["accessToken", "refreshToken"]) {
    const token = tokens[field];
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > 16_384 ||
      /[\s\x00-\x1f\x7f]/.test(token)
    ) {
      throw new Error("Invalid Box token pair");
    }
  }
}

function associatedData(context: BoxTokenContext): Buffer {
  if (
    !context.connectionId ||
    !context.userId ||
    !context.boxUserId ||
    !Number.isSafeInteger(context.tokenVersion) ||
    context.tokenVersion < 0
  ) {
    throw new Error("Invalid Box token context");
  }
  return Buffer.from(
    JSON.stringify([
      "box-oauth-tokens",
      "v1",
      context.connectionId,
      context.userId,
      context.boxUserId,
      context.tokenVersion,
    ])
  );
}

function validateKey(key: Uint8Array): void {
  if (key.byteLength !== 32)
    throw new Error("Box token encryption requires a 32-byte key");
}

/** Encrypt both tokens together and authenticate their owner, connection and version. */
export function encryptBoxTokens(
  tokens: BoxTokenPair,
  key: Uint8Array,
  context: BoxTokenContext
): string {
  validateKey(key);
  validateBoxTokens(tokens);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(context));
  // Construct the plaintext explicitly so unrelated fields cannot be persisted.
  const plaintext = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptBoxTokens(
  encrypted: string,
  key: Uint8Array,
  context: BoxTokenContext
): BoxTokenPair {
  validateKey(key);
  try {
    if (encrypted.length > 65_536) throw new Error();
    const [version, ivValue, ciphertextValue, tagValue, extra] = encrypted.split(".");
    if (
      version !== "v1" ||
      !ivValue ||
      !ciphertextValue ||
      !tagValue ||
      extra !== undefined
    ) {
      throw new Error();
    }
    const parts = [ivValue, ciphertextValue, tagValue].map((value) => {
      const decoded = Buffer.from(value, "base64url");
      if (decoded.toString("base64url") !== value) throw new Error();
      return decoded;
    });
    const [iv, ciphertext, tag] = parts;
    if (!iv || iv.length !== 12 || !ciphertext || !tag || tag.length !== 16)
      throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const tokens: unknown = JSON.parse(plaintext.toString("utf8"));
    validateBoxTokens(tokens);
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  } catch {
    // Avoid exposing ciphertext, key material, plaintext, or parser diagnostics.
    throw new Error("Unable to decrypt Box tokens");
  }
}
