import { BUSINESS, VISIT_CITIES } from "@happynails/shared";

/**
 * Storefront facts that are not in the database.
 * Anything marked PLACEHOLDER has not been confirmed by the owner and must be replaced before launch.
 */
export const SITE = {
  name: BUSINESS.brand,
  byline: BUSINESS.byline,
  visitCities: VISIT_CITIES,
  // Owner-confirmed (2026-10-04): pay now or after the visit; travel included in Delhi, Noida and Gurgaon.
  bookingPaymentNote:
    "Pay online now, or after your visit by UPI or cash. Travel is included in Delhi, Noida and Gurgaon.",
  contact: {
    whatsappDisplay: BUSINESS.phoneDisplay,
    whatsappLink: `https://wa.me/${BUSINESS.whatsappNumber}`,
    phoneDisplay: BUSINESS.phoneDisplay,
  },
} as const;

/**
 * What comes in every press-on kit, as shown in the product drawer and size finder.
 * PLACEHOLDER: kit contents and the re-size promise come from the design prototype and are not confirmed.
 */
export const KIT = {
  nails: 24,
  sizes: 12,
  features: [
    "24 nails in 12 sizes, a prep kit and adhesive tabs",
    "Reusable with fresh tabs or nail glue",
    "Free re-size within seven days",
  ],
} as const;

/** In-page sections the nav links to. Sections land in later phases; links to missing ones do nothing. */
export const NAV_LINKS = [
  { id: "shop", label: "Collection" },
  { id: "fit", label: "Find your size" },
  { id: "book", label: "Home visits" },
  { id: "stories", label: "Stories" },
  { id: "faq", label: "Questions" },
] as const;
