/** All money in the system is an integer number of paise (1 rupee = 100 paise). */
export type Paise = number;

export function assertPaise(value: number): Paise {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Expected a non-negative integer amount in paise, got ${value}`);
  }
  return value;
}

export function rupeesToPaise(rupees: number): Paise {
  return assertPaise(Math.round(rupees * 100));
}

const wholeRupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const withPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

/** Formats paise for display, e.g. 119900 -> "₹1,199", 4950 -> "₹49.50". */
export function formatINR(paise: Paise): string {
  assertPaise(paise);
  return (paise % 100 === 0 ? wholeRupees : withPaise).format(paise / 100);
}
