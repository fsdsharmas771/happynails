/**
 * Delivery and payment charges. The server is the only place totals are computed.
 * PLACEHOLDER: all four amounts come from the design prototype and are not confirmed by the owner.
 */
export const PRICING = {
  freeShippingThresholdPaise: 149900,
  standardShippingPaise: 7900,
  /** Express is charged even above the free-delivery threshold. */
  expressShippingPaise: 14900,
  codFeePaise: 4900,
} as const;

/** Unpaid Razorpay orders are cancelled and their stock released after this long (build plan, section 6). */
export const PAYMENT_TIMEOUT_MS = 30 * 60 * 1000;
