import { formatINR, formatIstTime, istDateOf, istTimeOf, istToUtc, rupeesToPaise } from "@happynails/shared";

export { formatINR };

const dayFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Sat 4 Oct, 10:00 am" in India time. */
export function when(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = Object.fromEntries(dayFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${formatIstTime(istTimeOf(d))}`;
}

export const timeOnly = (iso: string) => formatIstTime(istTimeOf(new Date(iso)));
export const istDate = (iso: string) => istDateOf(new Date(iso));
export const istTime = (iso: string) => istTimeOf(new Date(iso));

/** Date + time inputs (India time) to an ISO instant. */
export const toInstant = (date: string, time: string) => istToUtc(date, time).toISOString();

/** "1,199.00" style rupee input to paise; null when not a valid amount. */
export function parseRupees(input: string): number | null {
  const n = Number(input.replace(/[,\s₹]/g, ""));
  return Number.isFinite(n) && n >= 0 ? rupeesToPaise(n) : null;
}

export const rupeesInput = (paise: number) => (paise / 100).toFixed(paise % 100 ? 2 : 0);

export const label = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const dayOnlyFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});
/** "Monday 6 October" for an India calendar day "YYYY-MM-DD". */
export function dayHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const p = Object.fromEntries(
    dayOnlyFmt.formatToParts(new Date(Date.UTC(y, m - 1, d))).map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month}`;
}
