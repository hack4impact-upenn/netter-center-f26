import { describe, expect, it } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import { decryptBoxTokens, encryptBoxTokens, type BoxTokenContext } from "../tokens";
import { KEY, TOKENS } from "./fixtures";

const context: BoxTokenContext = {
  connectionId: "connection-1",
  userId: "user-1",
  boxUserId: "123",
  tokenVersion: 0,
};

describe("Box token authenticated encryption", () => {
  it("round trips both tokens in a versioned envelope without plaintext", () => {
    const ciphertext = encryptBoxTokens(TOKENS, KEY, context);
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(ciphertext).not.toContain(TOKENS.accessToken);
    expect(ciphertext).not.toContain(TOKENS.refreshToken);
    expect(decryptBoxTokens(ciphertext, KEY, context)).toEqual(TOKENS);
  });

  it("uses a fresh nonce when encrypting the same pair", () => {
    const first = encryptBoxTokens(TOKENS, KEY, context);
    const second = encryptBoxTokens(TOKENS, KEY, context);
    expect(first.split(".")[1]).not.toBe(second.split(".")[1]);
    expect(first).not.toBe(second);
    expect(decryptBoxTokens(second, KEY, context)).toEqual(TOKENS);
  });

  it.each([
    { ...context, connectionId: "connection-2" },
    { ...context, userId: "user-2" },
    { ...context, boxUserId: "456" },
    { ...context, tokenVersion: 1 },
  ])("rejects ciphertext copied to another identity or token version %#", (other) => {
    expect(() =>
      decryptBoxTokens(encryptBoxTokens(TOKENS, KEY, context), KEY, other)
    ).toThrow("Unable to decrypt Box tokens");
  });

  it("rejects the wrong encryption key", () => {
    expect(() =>
      decryptBoxTokens(encryptBoxTokens(TOKENS, KEY, context), randomBytes(32), context)
    ).toThrow("Unable to decrypt Box tokens");
  });

  it.each([1, 2, 3])("authenticates envelope component %i", (part) => {
    const parts = encryptBoxTokens(TOKENS, KEY, context).split(".");
    const value = parts[part];
    if (!value) throw new Error("Missing fixture part");
    const bytes = Buffer.from(value, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    parts[part] = bytes.toString("base64url");
    expect(() => decryptBoxTokens(parts.join("."), KEY, context)).toThrow(
      "Unable to decrypt Box tokens"
    );
  });

  it.each([
    "",
    "v2.a.b.c",
    "v1.a.b",
    "v1.a.b.c.extra",
    "v1.@@.@@.@@",
    "x".repeat(65_537),
  ])("rejects malformed or oversized envelopes %#", (value) => {
    expect(() => decryptBoxTokens(value, KEY, context)).toThrow(
      "Unable to decrypt Box tokens"
    );
  });

  it.each([0, 16, 31, 33])("requires a 32-byte key, received %i", (length) => {
    expect(() => encryptBoxTokens(TOKENS, new Uint8Array(length), context)).toThrow(
      "32-byte key"
    );
    expect(() => decryptBoxTokens("v1.fake", new Uint8Array(length), context)).toThrow(
      "32-byte key"
    );
  });

  it.each([
    { accessToken: "", refreshToken: "secret" },
    { accessToken: "secret", refreshToken: "" },
    { accessToken: "unsafe\r\ntoken", refreshToken: "secret" },
    { accessToken: "secret", refreshToken: "unsafe token" },
    { accessToken: "x".repeat(16_385), refreshToken: "secret" },
  ])("rejects invalid plaintext tokens without echoing them %#", (tokens) => {
    expect(() => encryptBoxTokens(tokens, KEY, context)).toThrow(
      "Invalid Box token pair"
    );
  });

  it("persists only the two explicitly allowed token fields", () => {
    const value = { ...TOKENS, unrelatedSecret: "other-secret" };
    expect(decryptBoxTokens(encryptBoxTokens(value, KEY, context), KEY, context)).toEqual(
      TOKENS
    );
  });

  it.each(["not JSON", JSON.stringify({ accessToken: "only-one-token" }), "null"])(
    "rejects authenticated but invalid payloads %#",
    (plaintext) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", KEY, iv);
      cipher.setAAD(
        Buffer.from(
          JSON.stringify([
            "box-oauth-tokens",
            "v1",
            context.connectionId,
            context.userId,
            context.boxUserId,
            context.tokenVersion,
          ])
        )
      );
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope = [
        "v1",
        iv.toString("base64url"),
        ciphertext.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
      ].join(".");
      expect(() => decryptBoxTokens(envelope, KEY, context)).toThrow(
        "Unable to decrypt Box tokens"
      );
    }
  );
});
