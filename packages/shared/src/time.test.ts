import { describe, expect, it } from "vitest";
import { addIstDays, daysOfMonth, formatIstTime, istDateOf, istTimeOf, istToUtc, istWeekday } from "./time";

describe("IST helpers", () => {
  it("converts India wall-clock time to UTC and back", () => {
    const t = istToUtc("2026-10-05", "10:00");
    expect(t.toISOString()).toBe("2026-10-05T04:30:00.000Z");
    expect(istDateOf(t)).toBe("2026-10-05");
    expect(istTimeOf(t)).toBe("10:00");
  });

  it("keeps late-evening India times on the right India day", () => {
    const t = istToUtc("2026-10-05", "00:30");
    expect(t.toISOString()).toBe("2026-10-04T19:00:00.000Z");
    expect(istDateOf(t)).toBe("2026-10-05");
  });

  it("knows weekdays, month lengths and day arithmetic", () => {
    expect(istWeekday("2026-10-04")).toBe(0); // Sunday
    expect(daysOfMonth("2028-02")).toHaveLength(29);
    expect(daysOfMonth("2026-10")[30]).toBe("2026-10-31");
    expect(addIstDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("formats 12-hour times", () => {
    expect(formatIstTime("10:00")).toBe("10:00 am");
    expect(formatIstTime("12:30")).toBe("12:30 pm");
    expect(formatIstTime("19:30")).toBe("7:30 pm");
    expect(formatIstTime("00:15")).toBe("12:15 am");
  });
});
