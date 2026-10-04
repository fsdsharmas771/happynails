/**
 * Storefront copy. Anything still marked PLACEHOLDER is a business statement the owner has not
 * confirmed yet; the rest was confirmed or written for the owner to adjust (2026-10-04).
 */

/** Written for the owner to adjust (2026-10-04); each is backed by a confirmed fact or practice. */
export const PROMISES = [
  {
    title: "Done by Anamika",
    body: "Every home visit is done by Anamika herself, from the first file to the final coat.",
  },
  {
    title: "Clean tools, every visit",
    body: "Tools are cleaned and sanitised between clients, and files and buffers are fresh for every visit.",
  },
  {
    title: "Free cancellation",
    body: "Plans change. Cancel free of charge up to 24 hours before your visit.",
  },
  {
    title: "Travel included",
    body: "No travel charge anywhere in Delhi, Noida or Gurgaon.",
  },
] as const;

export const FAQ = [
  {
    q: "How long do press-on sets last?",
    a: "With adhesive tabs, a few days to a week. With nail glue and proper prep, two to three weeks is common. Care and nail growth change this.",
  },
  {
    q: "Where do you deliver?",
    // PLACEHOLDER: delivery windows (same rules as the delivery estimate in packages/shared/src/shipping.ts).
    a: "Everywhere in India. Delhi NCR orders usually arrive in one to two days, other cities in three to six.",
  },
  {
    q: "Can I reuse a set?",
    a: "Yes. Soak off the adhesive, clean the nails with alcohol, and press again with fresh tabs.",
  },
  {
    q: "Which areas do home visits cover?",
    a: "Delhi, Noida and Gurgaon. Enter your pincode in the booking steps and we check it right away.",
  },
  {
    q: "What if I need to cancel a visit?",
    a: "Cancelling is free up to 24 hours before your slot. After that, message us on WhatsApp and we will find another time.",
  },
  {
    q: "How do I pay?",
    // Owner decisions (2026-10-04): no cash on delivery for orders; visits can be paid now or after.
    a: "Orders are paid online on Razorpay's secure page, by UPI, card or netbanking. Home visits can be paid online when you book, or after the visit by UPI or cash.",
  },
] as const;

export const BEFORE_AFTER = {
  // PLACEHOLDER: "about two hours" and naming sets on photos are from the prototype.
  body: "Drag the line. A full set is built, shaped and finished in about two hours at your home, and the set name goes on every photo so you can ask for it again.",
} as const;

export const SEO = {
  title: "Happy Nails by Anamika · Press-on nails and home visits in Delhi NCR",
  description:
    "Hand-finished press-on nail sets delivered across India, and at-home nail services in Delhi, Noida and Gurgaon. Book a home visit or find your size online.",
} as const;
