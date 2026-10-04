import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  FINISH_LABELS,
  formatINR,
  isValidPincode,
  MAX_QTY_PER_LINE,
  OCCASION_LABELS,
  type ProductDetailResponse,
  type SizingOptionKey,
} from "@happynails/shared";
import { useCart } from "../cart/store";
import { KIT } from "../config/site";
import { ApiError, api } from "../lib/api";
import { useDocumentMeta } from "../lib/meta";
import { useDialog } from "../lib/useDialog";
import { useToast } from "../layout/Toast";
import { ProductVisual } from "./ProductVisual";
import { useProduct } from "./queries";
import { useProductParam } from "./useProductParam";

function DeliveryCheck() {
  const id = useId();
  const [pincode, setPincode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const eta = useMutation({ mutationFn: api.deliveryEstimate });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const pin = pincode.trim();
    if (!isValidPincode(pin)) {
      setInvalid(true);
      eta.reset();
      return;
    }
    setInvalid(false);
    eta.mutate(pin);
  }

  const message = invalid
    ? { ok: false, text: "Enter a valid 6 digit pincode." }
    : eta.isError
      ? { ok: false, text: "Could not check that pincode just now. Please try again." }
      : eta.data
        ? { ok: true, text: `Standard delivery in ${eta.data.standard}. Express in ${eta.data.express}.` }
        : null;

  return (
    <form className="pin-check" onSubmit={onSubmit} noValidate>
      <div className="pin">
        <div className={`field${invalid ? " bad" : ""}`}>
          <label htmlFor={id}>Delivery pincode</label>
          <input
            id={id}
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
            placeholder="6 digits"
            value={pincode}
            aria-invalid={invalid}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <button className="btn ghost sm" type="submit" disabled={eta.isPending}>
          Check
        </button>
      </div>
      <div role="status" aria-live="polite">
        {message && <p className={`msg ${message.ok ? "ok" : "no"}`}>{message.text}</p>}
      </div>
    </form>
  );
}

/** Drawer contents for one set. Keyed by slug so choices reset when another set opens. */
function ProductBody({ data, onAdded }: { data: ProductDetailResponse; onAdded: () => void }) {
  const { product, sizingOptions } = data;
  const [option, setOption] = useState<SizingOptionKey>("standard");
  const [qty, setQty] = useState(1);
  const add = useCart((s) => s.add);
  const toast = useToast((s) => s.show);
  const optionsName = useId();

  // Display only: the server re-quotes every price at checkout.
  const unit = product.pricePaise + (sizingOptions.find((o) => o.key === option)?.pricePaise ?? 0);

  function addToBag() {
    add({ slug: product.slug, option, qty });
    onAdded();
    toast(`${product.name} added to your bag`);
  }

  return (
    <>
      <div className="body pd">
        <div className="pd-pic">
          <ProductVisual product={product} />
        </div>
        <div>
          <div className="row">
            <h2>{product.name}</h2>
            <span className="price">{formatINR(unit)}</span>
          </div>
          <p className="eyebrow" style={{ marginTop: 8 }}>
            {product.shape} &middot; {FINISH_LABELS[product.finish]} &middot;{" "}
            {OCCASION_LABELS[product.occasion]}
          </p>
        </div>
        {product.description && <p style={{ color: "var(--muted)" }}>{product.description}</p>}
        <fieldset className="opts-group">
          <legend className="lbl">Sizing</legend>
          <div className="opts">
            {sizingOptions.map((o) => (
              <label className="opt" key={o.key}>
                <input
                  type="radio"
                  name={optionsName}
                  value={o.key}
                  checked={option === o.key}
                  onChange={() => setOption(o.key)}
                />
                <span className="t">
                  <b>{o.label}</b>
                  <span>{o.description}</span>
                </span>
                <span className="pr">{o.pricePaise ? `+${formatINR(o.pricePaise)}` : "Included"}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <DeliveryCheck />
        <ul>
          {KIT.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      <div className="foot2">
        <div className="addrow">
          <div className="qty" role="group" aria-label="Quantity">
            <button type="button" aria-label="Fewer" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>
              &minus;
            </button>
            <span aria-live="polite">{qty}</span>
            <button
              type="button"
              aria-label="More"
              disabled={qty >= MAX_QTY_PER_LINE}
              onClick={() => setQty((q) => q + 1)}
            >
              +
            </button>
          </div>
          <button className="btn" type="button" disabled={!product.inStock} onClick={addToBag}>
            {product.inStock ? (
              <>
                Add to bag &middot; <span>{formatINR(unit * qty)}</span>
              </>
            ) : (
              "Sold out"
            )}
          </button>
        </div>
      </div>
    </>
  );
}

export function ProductDrawer() {
  const { slug, close } = useProductParam();
  const open = !!slug;
  // Keep showing the last set while the drawer slides away.
  const [shown, setShown] = useState<string | null>(slug);
  useEffect(() => {
    if (slug) setShown(slug);
  }, [slug]);

  const ref = useRef<HTMLElement>(null);
  useDialog(open, ref, close);
  const { data, isError, error } = useProduct(shown);
  // An open set gets its own title and description, so a shared ?set= link reads well.
  useDocumentMeta(
    open && data
      ? {
          title: `${data.product.name} press-on nails · Happy Nails by Anamika`,
          description: data.product.description || undefined,
        }
      : {},
  );
  const missing = isError && error instanceof ApiError && error.status === 404;

  return (
    <>
      <div className={`scrim${open ? " on" : ""}`} onClick={close} aria-hidden="true" />
      <aside
        className={`drawer${open ? " on" : ""}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={data ? data.product.name : "Product details"}
        tabIndex={-1}
        aria-hidden={!open}
      >
        <header>
          <h3>The set</h3>
          <button className="x" type="button" aria-label="Close" onClick={close} />
        </header>
        {data && <ProductBody key={data.product.slug} data={data} onAdded={close} />}
        {!data && (
          <div className="body pd">
            <p className={`msg${isError ? " no" : ""}`} role="status">
              {missing
                ? "This set is no longer available."
                : isError
                  ? "This set could not be loaded."
                  : "Loading the set"}
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
