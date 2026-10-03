import { describe, expect, it } from "vitest";
import { assertPaise, formatINR, rupeesToPaise } from "./money";

describe("money", () => {
  it("converts rupees to integer paise", () => {
    expect(rupeesToPaise(1199)).toBe(119900);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });

  it("rejects fractional or negative paise", () => {
    expect(() => assertPaise(10.5)).toThrow(RangeError);
    expect(() => assertPaise(-1)).toThrow(RangeError);
  });

  it("formats whole rupees without decimals and keeps paise when present", () => {
    expect(formatINR(119900)).toBe("₹1,199");
    expect(formatINR(10000000)).toBe("₹1,00,000");
    expect(formatINR(4950)).toBe("₹49.50");
    expect(formatINR(0)).toBe("₹0");
  });
});
