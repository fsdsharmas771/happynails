import { useMemo, useState, type PointerEvent } from "react";
import {
  FINISH_LABELS,
  formatINR,
  NAIL_SHAPES,
  OCCASION_LABELS,
  OCCASIONS,
  type NailShape,
  type Occasion,
  type PublicProduct,
} from "@happynails/shared";
import { useReveal } from "../lib/useReveal";
import { ProductVisual } from "./ProductVisual";
import { useProducts } from "./queries";
import { useProductParam } from "./useProductParam";
import "./catalogue.css";

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function Chips<T extends string>({
  label,
  values,
  current,
  name,
  onChange,
}: {
  label: string;
  values: readonly T[];
  current: T | "all";
  name: (v: T) => string;
  onChange: (v: T | "all") => void;
}) {
  return (
    <div className="frow" role="group" aria-label={label}>
      <span className="k" aria-hidden="true">
        {label}
      </span>
      {(["all", ...values] as const).map((v) => (
        <button key={v} type="button" className="fb" aria-pressed={v === current} onClick={() => onChange(v)}>
          {v === "all" ? "All" : name(v)}
        </button>
      ))}
    </div>
  );
}

/** Cards lean slightly towards the pointer (reference: --mx/--my). */
function tilt(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", ((e.clientX - r.left) / r.width - 0.5).toFixed(2));
  el.style.setProperty("--my", ((e.clientY - r.top) / r.height - 0.5).toFixed(2));
}

function ProductCard({ product, onOpen }: { product: PublicProduct; onOpen: () => void }) {
  return (
    <button
      className="card"
      type="button"
      aria-label={`${product.name}, ${formatINR(product.pricePaise)}${product.inStock ? "" : ", sold out"}`}
      onClick={onOpen}
      onPointerMove={tilt}
    >
      <span className="pic">
        <span className="tg">{FINISH_LABELS[product.finish]}</span>
        {!product.inStock && <span className="tg soldout">Sold out</span>}
        <ProductVisual product={product} decorative />
        <span className="btn sm quick" aria-hidden="true">
          Quick view
        </span>
      </span>
      <span className="ttl">{product.name}</span>
      <span className="meta">
        <span>
          {cap(product.shape)} &middot; {OCCASION_LABELS[product.occasion]}
        </span>
        <span className="price">{formatINR(product.pricePaise)}</span>
      </span>
    </button>
  );
}

export function Collection() {
  const { data, isPending, isError, refetch } = useProducts();
  const { open } = useProductParam();
  const [shape, setShape] = useState<NailShape | "all">("all");
  const [occasion, setOccasion] = useState<Occasion | "all">("all");
  const headRef = useReveal<HTMLDivElement>();
  const filtersRef = useReveal<HTMLDivElement>();

  const shown = useMemo(
    () =>
      (data?.products ?? []).filter(
        (p) => (shape === "all" || p.shape === shape) && (occasion === "all" || p.occasion === occasion),
      ),
    [data, shape, occasion],
  );

  return (
    <section className="sec" id="shop" aria-labelledby="shopH">
      <div className="sec-head rv" ref={headRef}>
        <div>
          <p className="eyebrow">The collection</p>
          <h2 className="h2" id="shopH">
            Sets made to be <em>worn</em>, then kept.
          </h2>
        </div>
        <p className="sub">
          Each set ships with a prep kit and adhesive tabs. Choose a shape, pick an occasion, then size it in
          the drawer.
        </p>
      </div>
      <div className="filters rv" ref={filtersRef}>
        <Chips label="Shape" values={NAIL_SHAPES} current={shape} name={cap} onChange={setShape} />
        <Chips
          label="Occasion"
          values={OCCASIONS}
          current={occasion}
          name={(o) => OCCASION_LABELS[o]}
          onChange={setOccasion}
        />
      </div>
      <div className="grid" aria-live="polite" aria-busy={isPending}>
        {isPending && <div className="empty">Loading the collection</div>}
        {isError && (
          <div className="empty">
            <p>The collection could not be loaded.</p>
            <button className="btn sm ghost" type="button" onClick={() => void refetch()}>
              Try again
            </button>
          </div>
        )}
        {data && shown.length === 0 && (
          <div className="empty">
            {data.products.length === 0
              ? "New sets are on their way."
              : "No sets in that combination yet. Try another shape."}
          </div>
        )}
        {shown.map((p) => (
          <ProductCard key={p.slug} product={p} onOpen={() => open(p.slug)} />
        ))}
      </div>
    </section>
  );
}
