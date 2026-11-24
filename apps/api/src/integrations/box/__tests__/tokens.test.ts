import { describe, expect, it } from "bun:test";
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

  it.each([
    { ...context, userId: "user-2" },
    { ...context, tokenVersion: 1 },
  ])("rejects ciphertext copied to another identity or token version %#", (other) => {
    expect(() =>
      decryptBoxTokens(encryptBoxTokens(TOKENS, KEY, context), KEY, other)
    ).toThrow("Unable to decrypt Box tokens");
  });

  it("rejects tampered ciphertext", () => {
    const part = 2;
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
});
