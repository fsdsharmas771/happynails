import { useId, type ReactNode } from "react";
import type { NailFinish, NailShape } from "@happynails/shared";
import { BARE_LENGTH, BARE_TILT, FINGERS, SHAPE_LENGTH, glitterDots, mix, shapePath } from "./geometry";

export interface NailArtProps {
  shape: NailShape;
  finish: NailFinish;
  /** Base colour, #rrggbb. */
  color: string;
  /** Second colour for ombre (the tip). Falls back to a pale tint of `color`. */
  color2?: string;
  /** Accessible name. Omit when the surrounding control already names the set; the SVG is then hidden. */
  label?: string;
  /** Natural, unpolished short nails (the "before" picture). Ignores shape and finish. */
  bare?: boolean;
  /** Length multiplier on top of the shape's own length. */
  scale?: number;
  className?: string;
}

const FRENCH_TIP = "#FBF8F4";
const GOLD_LINE = "#B8975A";

function gradient(id: string, finish: NailFinish, c: string, c2: string): ReactNode {
  switch (finish) {
    case "ombre":
      return (
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c2} />
          <stop offset="1" stopColor={c} />
        </linearGradient>
      );
    case "chrome":
      return (
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={mix(c, "#ffffff", 0.65)} />
          <stop offset=".3" stopColor={c} />
          <stop offset=".6" stopColor={mix(c, "#000000", 0.4)} />
          <stop offset=".8" stopColor={mix(c, "#ffffff", 0.25)} />
          <stop offset="1" stopColor={mix(c, "#ffffff", 0.7)} />
        </linearGradient>
      );
    case "cateye":
      return (
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={mix(c, "#000000", 0.45)} />
          <stop offset=".45" stopColor={mix(c, "#ffffff", 0.5)} />
          <stop offset=".6" stopColor={c} />
          <stop offset="1" stopColor={mix(c, "#000000", 0.5)} />
        </linearGradient>
      );
    default:
      return null;
  }
}

function decoration(finish: NailFinish, finger: number, w: number, h: number, clip: string): ReactNode {
  switch (finish) {
    case "french":
      return (
        <path
          d={`M${-w},0L${w},0L${w},${h * 0.3}Q0,${h * 0.16} ${-w},${h * 0.3}Z`}
          fill={FRENCH_TIP}
          clipPath={clip}
        />
      );
    case "glitter":
      return (
        <g clipPath={clip}>
          {glitterDots(finger, w, h).map((d, j) => (
            <circle key={j} cx={d.x} cy={d.y} r={d.r} fill={d.fill} opacity=".85" />
          ))}
        </g>
      );
    case "art":
      return (
        <>
          <path
            d={`M${-w * 0.3},${h * 0.95}Q${w * 0.5},${h * 0.55} ${-w * 0.1},${h * 0.1}`}
            fill="none"
            stroke={GOLD_LINE}
            strokeWidth="1.4"
            strokeLinecap="round"
            clipPath={clip}
          />
          <circle cx={w * 0.18} cy={h * 0.62} r="2.2" fill={GOLD_LINE} />
        </>
      );
    default:
      return null;
  }
}

/** A hand of five press-on nails drawn in SVG. Port of nailSet() from the design reference. */
export function NailArt({
  shape,
  finish,
  color,
  color2,
  label,
  bare = false,
  scale = 1,
  className,
}: NailArtProps) {
  // useId gives ":r1:"-style ids; colons are awkward inside url(#...), so strip them.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tip = color2 ?? mix(color, "#ffffff", 0.7);

  const nails = FINGERS.map((f, i) => {
    const h = f.h * (bare ? BARE_LENGTH : SHAPE_LENGTH[shape]) * scale;
    const w = f.w;
    const d = shapePath(bare ? "square" : shape, w, h);
    const gradId = `${uid}g${i}`;
    const clipId = `${uid}k${i}`;
    const clip = `url(#${clipId})`;
    const grad = bare ? null : gradient(gradId, finish, color, tip);
    const rot = f.r + (bare ? BARE_TILT[i]! : 0);

    return {
      defs: (
        <g key={i}>
          <clipPath id={clipId}>
            <path d={d} />
          </clipPath>
          {grad}
        </g>
      ),
      body: (
        <g key={i} transform={`translate(${f.x},${f.y}) rotate(${rot}) translate(0,${-h})`}>
          <path d={d} fill={grad ? `url(#${gradId})` : color} stroke="rgba(0,0,0,.2)" strokeWidth=".8" />
          {!bare && decoration(finish, i, w, h, clip)}
          {!bare && finish !== "matte" && (
            <path
              d={`M${-w * 0.26},${h * 0.78}L${-w * 0.26},${h * 0.3}`}
              stroke="#fff"
              strokeOpacity=".38"
              strokeWidth="3"
              strokeLinecap="round"
              clipPath={clip}
            />
          )}
          {bare && (
            <path
              d={`M${-w * 0.2},${h * 0.2}L${-w * 0.2},${h * 0.8}M${w * 0.15},${h * 0.25}L${w * 0.15},${h * 0.8}`}
              stroke="#000"
              strokeOpacity=".08"
              strokeWidth="1"
            />
          )}
        </g>
      ),
    };
  });

  return (
    <svg
      viewBox="0 0 320 240"
      className={className}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true, focusable: false })}
    >
      <defs>{nails.map((n) => n.defs)}</defs>
      {nails.map((n) => n.body)}
    </svg>
  );
}
