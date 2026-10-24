import { describe, it, expect } from "bun:test";
import { generateCode } from "../utils";

describe("generateCode", () => {
  it("returns a 6-digit code by default", () => {
    const code = generateCode();
    expect(code).toHaveLength(6);
  });

  it("returns a code of the requested length", () => {
    expect(generateCode(4)).toHaveLength(4);
    expect(generateCode(8)).toHaveLength(8);
    expect(generateCode(10)).toHaveLength(10);
  });

  it("returns only numeric characters", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateCode();
      expect(code).toMatch(/^\d+$/);
    }
  });

  it("generates different codes across multiple calls", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add(generateCode());
    }
    // With 6-digit codes and 50 samples, we should have many unique values
    expect(codes.size).toBeGreaterThan(10);
  });

  it("handles edge case of length 1", () => {
    const code = generateCode(1);
    expect(code).toHaveLength(1);
    expect(code).toMatch(/^\d$/);
  });
});
