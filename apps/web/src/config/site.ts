import { VISIT_CITIES } from "@happynails/shared";

/**
 * Storefront facts that are not in the database.
 * Anything marked PLACEHOLDER has not been confirmed by the owner and must be replaced before launch.
 */
export const SITE = {
  name: "Happy Nails",
  byline: "by Anamika",
  visitCities: VISIT_CITIES,
  contact: {
    // PLACEHOLDER: real WhatsApp number not provided yet.
    whatsappDisplay: "+91 00000 00000",
    // PLACEHOLDER: real Instagram handle not confirmed yet.
    instagramHandle: "@happynails",
  },
} as const;

/** In-page sections the nav links to. Sections land in later phases; links to missing ones do nothing. */
export const NAV_LINKS = [
  { id: "shop", label: "Collection" },
  { id: "fit", label: "Find your size" },
  { id: "book", label: "Home visits" },
  { id: "stories", label: "Stories" },
  { id: "faq", label: "Questions" },
] as const;
