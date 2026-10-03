import type { VisitCity } from "@happynails/shared";

/**
 * Travel time a technician needs between the end of one visit and the start of the next
 * (owner decision, 2026-10-04). Noida sits across the Yamuna from Delhi and Gurgaon, so moving
 * between the two sides takes much longer. The owner said 4 to 5 hours; 4 is the minimum.
 */
export const TRAVEL_GAP_MINUTES = { sameSide: 60, crossSide: 240 } as const;

export type TravelSide = "noida" | "delhi_gurgaon";

export function travelSide(city: VisitCity): TravelSide {
  return city === "Noida" ? "noida" : "delhi_gurgaon";
}

export interface Visit {
  /** Epoch milliseconds. */
  start: number;
  end: number;
  side: TravelSide;
}

export function gapMs(a: TravelSide, b: TravelSide): number {
  return (a === b ? TRAVEL_GAP_MINUTES.sameSide : TRAVEL_GAP_MINUTES.crossSide) * 60_000;
}

/** True when one technician cannot do both visits: they overlap or leave too little travel time. */
export function visitsClash(a: Visit, b: Visit): boolean {
  const gap = gapMs(a.side, b.side);
  return a.start < b.end + gap && b.start < a.end + gap;
}

/** Unpaid online bookings are cancelled and their slot freed after this long, as for orders. */
export const BOOKING_PAYMENT_TIMEOUT_MS = 30 * 60 * 1000;
