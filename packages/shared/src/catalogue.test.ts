import { describe, expect, it } from "vitest";
import { cartItemSchema, slugSchema } from "./catalogue";
import { deliveryEstimate } from "./shipping";
import { sizeForThumbWidth } from "./sizing";

describe("deliveryEstimate", () => {
  it.each(["110017", "122002", "201301"])("treats %s as Delhi NCR", (pin) => {
    expect(deliveryEstimate(pin)?.standardDays).toEqual([1, 2]);
  });

  it.each(["400001", "560001", "600001", "700001"])("gives %s the longer window", (pin) => {
    expect(deliveryEstimate(pin)?.standardDays).toEqual([4, 6]);
  });

  it.each(["302001", "141001", "800001"])("gives %s the default window", (pin) => {
    expect(deliveryEstimate(pin)?.standardDays).toEqual([3, 5]);
  });

  it.each(["", "12345", "1234567", "abcdef"])("rejects %j", (pin) => {
    expect(deliveryEstimate(pin)).toBeNull();
  });
});

describe("sizeForThumbWidth", () => {
  it("maps the prototype's default 13 mm to size 5", () => {
    expect(sizeForThumbWidth(13)).toEqual({ size: 5, wide: false });
  });

  it("clamps to the kit's range and flags very wide thumbs", () => {
    expect(sizeForThumbWidth(18)).toEqual({ size: 0, wide: true });
    expect(sizeForThumbWidth(17)).toEqual({ size: 1, wide: true });
    expect(sizeForThumbWidth(9)).toEqual({ size: 9, wide: false });
    expect(sizeForThumbWidth(4)).toEqual({ size: 9, wide: false });
  });
});

describe("schemas", () => {
  it("accepts kebab-case slugs only", () => {
    expect(slugSchema.safeParse("rose-chrome").success).toBe(true);
    expect(slugSchema.safeParse("Rose Chrome").success).toBe(false);
    expect(slugSchema.safeParse("../etc").success).toBe(false);
  });

  it("limits cart quantities to 1 to 9", () => {
    expect(cartItemSchema.safeParse({ slug: "milk-bath", option: "standard", qty: 9 }).success).toBe(true);
    expect(cartItemSchema.safeParse({ slug: "milk-bath", option: "standard", qty: 0 }).success).toBe(false);
    expect(cartItemSchema.safeParse({ slug: "milk-bath", option: "standard", qty: 10 }).success).toBe(false);
    expect(cartItemSchema.safeParse({ slug: "milk-bath", option: "gift", qty: 1 }).success).toBe(false);
  });
});
