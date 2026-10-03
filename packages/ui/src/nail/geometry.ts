import type { NailShape } from "@happynails/shared";

// Ported from nailSet() in docs/design-reference.html. Keep the numbers in step with it.

/** Five fingers laid out on a 320x240 canvas: base position, rotation and nail width/height. */
export const FINGERS = [
  { x: 50, y: 176, r: -24, w: 32, h: 60 },
  { x: 112, y: 146, r: -11, w: 36, h: 74 },
  { x: 172, y: 132, r: 0, w: 38, h: 82 },
  { x: 232, y: 146, r: 11, w: 36, h: 74 },
  { x: 288, y: 190, r: 34, w: 44, h: 64 },
] as const;

/** Length multiplier per shape. */
export const SHAPE_LENGTH: Record<NailShape, number> = {
  almond: 1,
  coffin: 1.08,
  square: 0.9,
  oval: 0.94,
  stiletto: 1.22,
};

/** Short, slightly uneven natural nails for the "before" picture. */
export const BARE_LENGTH = 0.62;
export const BARE_TILT = [3, -4, 2, -3, 5] as const;

/** Path for one nail, tip at y=0 and cuticle at y=h, centred on x=0. */
export function shapePath(shape: NailShape, w: number, h: number): string {
  const a = w / 2;
  const b = h - w * 0.3;
  const base = `L${a},${b}Q${a},${h} 0,${h}Q${-a},${h} ${-a},${b}Z`;
  switch (shape) {
    case "square":
      return `M${-a},${b}L${-a},3Q${-a},0 ${-a + 3},0L${a - 3},0Q${a},0 ${a},3${base}`;
    case "oval":
      return `M${-a},${b}L${-a},${a}A${a},${a} 0 0 1 ${a},${a}${base}`;
    case "coffin":
      return `M${-a},${b}L${-a},${h * 0.5}L${-a * 0.58},0L${a * 0.58},0L${a},${h * 0.5}${base}`;
    case "stiletto":
      return `M${-a},${b}L${-a},${h * 0.55}Q${-a * 0.35},${h * 0.22} 0,0Q${a * 0.35},${h * 0.22} ${a},${h * 0.55}${base}`;
    case "almond":
      return `M${-a},${b}L${-a},${h * 0.46}C${-a},${h * 0.2} ${-a * 0.3},0 0,0C${a * 0.3},0 ${a},${h * 0.2} ${a},${h * 0.46}${base}`;
  }
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** Linear blend of two #rrggbb colours; amount 0 returns `from`, 1 returns `to`. */
export function mix(from: string, to: string, amount: number): string {
  const c = channels(from);
  const d = channels(to);
  return (
    "#" +
    c
      .map((v, i) =>
        Math.round(v + (d[i]! - v) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export interface GlitterDot {
  x: number;
  y: number;
  r: number;
  fill: string;
}

/** Deterministic sparkle positions for one nail, so server and client renders match. */
export function glitterDots(finger: number, w: number, h: number): GlitterDot[] {
  const dots: GlitterDot[] = [];
  for (let j = 0; j < 26; j++) {
    const rx = Math.sin((finger * 31 + j) * 12.9898) * 43758.5453;
    const ry = Math.sin((finger * 17 + j) * 78.233) * 12543.31;
    dots.push({
      x: Number(((rx - Math.floor(rx) - 0.5) * w).toFixed(1)),
      y: Number(((ry - Math.floor(ry)) * h).toFixed(1)),
      r: Number((0.8 + (j % 3) * 0.5).toFixed(1)),
      fill: j % 2 ? "#fff" : "#E7CFA0",
    });
  }
  return dots;
}
