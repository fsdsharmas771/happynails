import { BUSINESS, VISIT_CITIES } from "@happynails/shared";
import { Addon, AvailabilityRule, Service, Technician } from "../models/Booking";

/**
 * Home-visit services and add-ons from the design prototype.
 * Prices and durations confirmed by the owner (2026-10-04); editable in the admin.
 */
export const SEED_SERVICES = [
  {
    name: "Gel manicure",
    minutes: 60,
    pricePaise: 119900,
    description: "Shape, cuticle care and a long-wear colour",
  },
  {
    name: "Gel-X extensions, full set",
    minutes: 120,
    pricePaise: 249900,
    description: "New length and shape, built to last about three weeks",
  },
  {
    name: "Extension refill",
    minutes: 90,
    pricePaise: 159900,
    description: "Fill the grow-out and refresh the colour",
  },
  {
    name: "Bridal trial",
    minutes: 90,
    pricePaise: 199900,
    description: "Try your wedding set before the day",
  },
].map((s, i) => ({ ...s, sortOrder: (i + 1) * 10 }));

export const SEED_ADDONS = [
  { name: "Nail art", unitNote: "per hand", minutes: 20, pricePaise: 40000, description: "" },
  { name: "Chrome or cat-eye finish", minutes: 15, pricePaise: 30000, description: "" },
  { name: "Removal of old gel", minutes: 20, pricePaise: 50000, description: "" },
  { name: "Hand massage", minutes: 10, pricePaise: 20000, description: "" },
].map((a, i) => ({ ...a, sortOrder: (i + 1) * 10 }));

/**
 * Anamika does every visit (owner, 2026-10-04) and can work any hours: these default start times
 * every day are only a starting point; she sets her real availability in the admin calendar.
 */
export const SEED_TECHNICIANS = [
  { name: "Anamika", phone: BUSINESS.whatsappNumber.slice(2), cities: [...VISIT_CITIES] },
];
export const SEED_SLOT_TIMES = ["10:00", "12:30", "15:00", "17:30", "19:30"];

/** bulkWrite ops that insert each doc only if no record with that name exists. */
const insertMissingByName = <T extends { name: string }>(docs: T[]) =>
  docs.map((d) => ({ updateOne: { filter: { name: d.name }, update: { $setOnInsert: d }, upsert: true } }));

/** Inserts what is missing, matched by name. Existing records (the owner's edits) are left alone. */
export async function seedBookingSetup(): Promise<{ services: number; addons: number; technicians: number }> {
  const [s, a, t] = await Promise.all([
    Service.bulkWrite(insertMissingByName(SEED_SERVICES)),
    Addon.bulkWrite(insertMissingByName(SEED_ADDONS)),
    Technician.bulkWrite(insertMissingByName(SEED_TECHNICIANS)),
  ]);
  // Working hours only for technicians created just now.
  const newTechIds = Object.values(t.upsertedIds);
  if (newTechIds.length) {
    await AvailabilityRule.insertMany(
      newTechIds.flatMap((technicianId) =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ technicianId, weekday, slotTimes: SEED_SLOT_TIMES })),
      ),
    );
  }
  return { services: s.upsertedCount, addons: a.upsertedCount, technicians: t.upsertedCount };
}
