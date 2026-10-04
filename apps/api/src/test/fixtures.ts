import { VISIT_CITIES } from "@happynails/shared";
import { AvailabilityRule, Technician } from "../models/Booking";
import { SEED_SLOT_TIMES, seedBookingSetup } from "../seed/bookings";

/**
 * The real seed has one technician (Anamika). Many booking rules only show with two people
 * (one busy, one free), so tests add a second, test-only technician on the same hours.
 */
export async function seedTwoTechnicians() {
  await seedBookingSetup();
  const second = await Technician.create({
    name: "Test technician",
    phone: "9999999999",
    cities: [...VISIT_CITIES],
  });
  await AvailabilityRule.insertMany(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      technicianId: second._id,
      weekday,
      slotTimes: SEED_SLOT_TIMES,
    })),
  );
}
