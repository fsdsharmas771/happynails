export const VISIT_CITIES = ["Delhi", "Noida", "Gurgaon"] as const;
export type VisitCity = (typeof VISIT_CITIES)[number];

const PINCODE = /^\d{6}$/;

export function isValidPincode(pincode: string): boolean {
  return PINCODE.test(pincode);
}

/**
 * Home-visit coverage by pincode: Delhi 110xxx, Noida 201301 to 201310, Gurgaon 122xxx.
 * Returns null when the pincode is valid but not covered, or not a pincode at all.
 */
export function visitCityForPincode(pincode: string): VisitCity | null {
  if (!isValidPincode(pincode)) return null;
  if (pincode.startsWith("110")) return "Delhi";
  if (pincode.startsWith("122")) return "Gurgaon";
  const n = Number(pincode);
  if (n >= 201301 && n <= 201310) return "Noida";
  return null;
}
