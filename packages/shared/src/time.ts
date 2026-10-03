/**
 * India Standard Time helpers. IST is UTC+05:30 all year (no daylight saving), so a fixed
 * offset is exact. Store UTC; show and reason about days and slot times in IST.
 */
export const IST_OFFSET_MINUTES = 330;
const OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** "YYYY-MM-DD" calendar day in India. */
export type IstDate = string;
/** "HH:MM" wall-clock time in India, 24-hour. */
export type IstTime = string;

export const IST_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const IST_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const IST_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** UTC instant for a calendar day and wall-clock time in India. */
export function istToUtc(date: IstDate, time: IstTime): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - OFFSET_MS);
}

/** India calendar day of an instant. */
export function istDateOf(instant: Date): IstDate {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** India wall-clock time of an instant. */
export function istTimeOf(instant: Date): IstTime {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

/** Day of the week in India, 0 = Sunday. */
export function istWeekday(date: IstDate): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** Every calendar day of a "YYYY-MM" month. */
export function daysOfMonth(month: string): IstDate[] {
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const count = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function addIstDays(date: IstDate, days: number): IstDate {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** "10:00 am", "7:30 pm". */
export function formatIstTime(time: IstTime): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}
