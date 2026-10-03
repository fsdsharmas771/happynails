import { useState } from "react";
import { sizeForThumbWidth, THUMB_WIDTH_MM } from "@happynails/shared";
import { KIT } from "../config/site";
import { useReveal } from "../lib/useReveal";

const NUMBER_WORDS: Record<number, string> = { 10: "ten", 12: "twelve", 14: "fourteen" };

export function SizeFinder() {
  const [mm, setMm] = useState<number>(THUMB_WIDTH_MM.initial);
  const { size, wide } = sizeForThumbWidth(mm);
  const left = useReveal<HTMLDivElement>();
  const right = useReveal<HTMLDivElement>();
  const sizes = NUMBER_WORDS[KIT.sizes] ?? String(KIT.sizes);

  return (
    <section className="fit" id="fit" aria-labelledby="fitH">
      <div className="l rv" ref={left}>
        <p className="eyebrow">Find your size</p>
        <h2 className="h2" id="fitH">
          Measure once. <em>Order with confidence.</em>
        </h2>
        <p>
          Press your thumbnail against a ruler, read the width at the widest point, and slide to match. We
          suggest the closest size for the thumb. The other fingers follow from there.
        </p>
        <div className="steps3">
          <div>
            <b>Choose</b>Pick a shape and finish you love.
          </div>
          <div>
            <b>Fit</b>Match sizes from the kit to each nail.
          </div>
          <div>
            <b>Press</b>Prep, press, hold for thirty seconds.
          </div>
        </div>
      </div>
      <div className="r rv" ref={right}>
        <div className="gauge">
          <div className="rule" aria-hidden="true">
            <div className="nailw" style={{ width: `${mm * 6}px` }} />
          </div>
          <div className="sizeline">
            <output htmlFor="mm" aria-live="polite">
              Size {size}
              <small>{mm.toFixed(1)} mm</small>
            </output>
            <span className="note">Thumb width, in millimetres</span>
          </div>
          <input
            type="range"
            id="mm"
            min={THUMB_WIDTH_MM.min}
            max={THUMB_WIDTH_MM.max}
            step={THUMB_WIDTH_MM.step}
            value={mm}
            aria-label="Thumb nail width in millimetres"
            aria-valuetext={`${mm.toFixed(1)} millimetres, size ${size}`}
            onChange={(e) => setMm(Number(e.target.value))}
          />
          <p className="note">
            {wide
              ? "A wide thumbnail. Choose the custom-fit option for the best result."
              : `Each kit holds ${sizes} sizes, so a size either side still fits.`}
          </p>
        </div>
      </div>
    </section>
  );
}
