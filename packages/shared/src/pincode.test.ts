import { describe, expect, it } from "vitest";
import { visitCityForPincode } from "./pincode";

describe("visitCityForPincode", () => {
  it.each([
    ["110017", "Delhi"],
    ["110001", "Delhi"],
    ["122002", "Gurgaon"],
    ["201301", "Noida"],
    ["201310", "Noida"],
  ])("%s is covered as %s", (pin, city) => {
    expect(visitCityForPincode(pin)).toBe(city);
  });

  it.each(["201311", "201300", "400001", "560001"])("%s is not covered", (pin) => {
    expect(visitCityForPincode(pin)).toBeNull();
  });

  it.each(["11001", "1100171", "abcdef", ""])("rejects malformed %j", (pin) => {
    expect(visitCityForPincode(pin)).toBeNull();
  });
});
