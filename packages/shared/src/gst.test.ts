import { describe, expect, it } from "vitest";
import { financialYear, placeOfSupply, splitInclusive, stateForVisitCity } from "./gst";

describe("GST", () => {
  it("splits an inclusive price into taxable value and CGST + SGST within Uttar Pradesh", () => {
    const s = splitInclusive(119900, 18, true);
    expect(s).toEqual({
      taxablePaise: 101610,
      cgstPaise: 9145,
      sgstPaise: 9145,
      igstPaise: 0,
      totalPaise: 119900,
    });
  });

  it("uses IGST across states, and always adds up to the price", () => {
    for (const total of [1, 7900, 89900, 249900, 333333]) {
      for (const intra of [true, false]) {
        const s = splitInclusive(total, 18, intra);
        expect(s.taxablePaise + s.cgstPaise + s.sgstPaise + s.igstPaise).toBe(total);
      }
    }
    expect(splitInclusive(149900, 18, false)).toMatchObject({ igstPaise: 22866, cgstPaise: 0 });
  });

  it("places home visits where they happen", () => {
    expect(placeOfSupply(stateForVisitCity("Noida"))).toEqual({
      state: "Uttar Pradesh",
      code: "09",
      intraState: true,
    });
    expect(placeOfSupply(stateForVisitCity("Delhi"))).toMatchObject({ code: "07", intraState: false });
    expect(placeOfSupply(stateForVisitCity("Gurgaon"))).toMatchObject({ code: "06", intraState: false });
  });

  it("knows the financial year", () => {
    expect(financialYear("2026-10-04")).toBe("26-27");
    expect(financialYear("2027-03-31")).toBe("26-27");
    expect(financialYear("2027-04-01")).toBe("27-28");
  });
});
