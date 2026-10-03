const IST = "Asia/Kolkata";

function dayLabel(fmt: Intl.DateTimeFormat, d: Date): string {
  // Intl puts a comma after the weekday ("Sun, 4 Oct"); the design reads "Sun 4 Oct".
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

const short = (timeZone: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short" });
const long = (timeZone: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone, weekday: "short", day: "numeric", month: "long" });
const istShort = short(IST);
const utcShort = short("UTC");
const utcLong = long("UTC");

/** "Sat 4 Oct" for an instant, in India time whatever the visitor's clock says. */
export function formatDay(d: Date | string): string {
  return dayLabel(istShort, typeof d === "string" ? new Date(d) : d);
}

export function addDays(d: Date | string, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** "Mon 6 Oct" (or "Mon 6 October") for an India calendar day "YYYY-MM-DD". */
export function formatIstDate(date: string, longMonth = false): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return dayLabel(longMonth ? utcLong : utcShort, new Date(Date.UTC(y, m - 1, d)));
}
