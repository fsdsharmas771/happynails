import { z } from "zod";
import { isValidPincode } from "./pincode";

export const etaRequestSchema = z.object({
  pincode: z.string().regex(/^\d{6}$/, "Enter a 6 digit pincode"),
});

export const etaResponseSchema = z.object({
  standard: z.string(),
  express: z.string(),
  /** Business days for standard delivery, for date estimates. */
  standardDays: z.tuple([z.number().int(), z.number().int()]),
});
export type DeliveryEstimate = z.infer<typeof etaResponseSchema>;

/**
 * Delivery estimate by pincode, using the rules from the design prototype:
 * Delhi NCR (110, 122, 2013xx) 1 to 2 days; west and south (first digit 4 to 7) 4 to 6 days; elsewhere 3 to 5.
 * PLACEHOLDER: these windows have not been confirmed against a courier yet.
 */
export function deliveryEstimate(pincode: string): DeliveryEstimate | null {
  if (!isValidPincode(pincode)) return null;
  if (/^(110|122|2013)/.test(pincode)) {
    return { standard: "1 to 2 days", express: "Next day", standardDays: [1, 2] };
  }
  if ("4567".includes(pincode[0]!)) {
    return { standard: "4 to 6 days", express: "2 to 3 days", standardDays: [4, 6] };
  }
  return { standard: "3 to 5 days", express: "2 to 3 days", standardDays: [3, 5] };
}
