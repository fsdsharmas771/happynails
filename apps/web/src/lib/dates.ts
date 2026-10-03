const IST = "Asia/Kolkata";

const dayFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Sat 4 Oct", in India time whatever the visitor's clock says. */
export function formatDay(d: Date | string): string {
  return dayFmt.format(typeof d === "string" ? new Date(d) : d);
}

export function addDays(d: Date | string, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}
