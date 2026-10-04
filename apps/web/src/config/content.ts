/**
 * Marketing copy from the design reference. Statements about service, delivery and policy are
 * business facts the owner has not confirmed: each is marked PLACEHOLDER until they do.
 */

export const PROMISES = [
  {
    title: "Clean tools, every visit",
    // PLACEHOLDER: hygiene practice, confirm with the owner.
    body: "Metal tools are sterilised between clients. Files and buffers are single use and opened in front of you.",
  },
  {
    title: "Fit or we fix it",
    // PLACEHOLDER: re-size policy and its seven-day window.
    body: "If a set does not fit, send us your measurements within seven days and we re-size it free.",
  },
  {
    title: "Tracked, packed with care",
    // PLACEHOLDER: packaging claim.
    body: "Every order leaves with a tracking link and a rigid box so your set arrives unbent.",
  },
  {
    title: "Named technicians",
    // PLACEHOLDER: technician photos are not shown to customers yet.
    body: "You see who is coming before they ring the bell.",
  },
] as const;

export const FAQ = [
  {
    q: "How long do press-on sets last?",
    // PLACEHOLDER: wear time.
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
    // PLACEHOLDER: cancellation policy.
    a: "Free up to 24 hours before your slot. After that, message us and we will find another time.",
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
