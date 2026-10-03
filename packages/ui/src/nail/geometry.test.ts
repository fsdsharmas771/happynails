import { describe, expect, it } from "vitest";
import { NAIL_SHAPES } from "@happynails/shared";
import { glitterDots, mix, shapePath } from "./geometry";

describe("mix", () => {
  it("returns the endpoints at 0 and 1", () => {
    expect(mix("#d49c8b", "#ffffff", 0)).toBe("#d49c8b");
    expect(mix("#d49c8b", "#ffffff", 1)).toBe("#ffffff");
  });

  it("blends each channel", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#D49C8B", "#000000", 0.4)).toBe("#7f5e53");
  });
});

describe("shapePath", () => {
  it.each(NAIL_SHAPES)("draws a closed path for %s", (shape) => {
    const d = shapePath(shape, 38, 82);
    expect(d).toMatch(/^M/);
    expect(d).toMatch(/Z$/);
    expect(d).not.toContain("NaN");
  });
});

describe("glitterDots", () => {
  it("is deterministic so server and client renders agree", () => {
    expect(glitterDots(2, 38, 82)).toEqual(glitterDots(2, 38, 82));
    expect(glitterDots(2, 38, 82)).toHaveLength(26);
  });
});
