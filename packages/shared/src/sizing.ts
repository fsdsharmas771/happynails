/**
 * Size finder: thumbnail width in millimetres to a kit size, ported from the design prototype.
 * PLACEHOLDER: the width-to-size chart has not been confirmed against the real kits.
 */
export const THUMB_WIDTH_MM = { min: 9, max: 18, step: 0.5, initial: 13 } as const;

export interface SizeSuggestion {
  /** Kit size for the thumb, 0 (widest) to 9 (narrowest). */
  size: number;
  /** So wide that the custom-fit option is the better choice. */
  wide: boolean;
}

export function sizeForThumbWidth(mm: number): SizeSuggestion {
  const size = Math.max(0, Math.min(9, Math.round(18 - mm)));
  return { size, wide: size <= 1 };
}
