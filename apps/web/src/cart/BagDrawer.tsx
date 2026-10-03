import { useRef } from "react";
import { useNavigate } from "react-router";
import { formatINR, MAX_QTY_PER_LINE } from "@happynails/shared";
import { scrollToSection } from "../lib/motion";
import { useDialog } from "../lib/useDialog";
import { LineThumb } from "./LineThumb";
import { useBagDrawer, useCart } from "./store";
import { useQuote } from "./useQuote";
import "./cart.css";

export function BagDrawer() {
  const { open, hide } = useBagDrawer();
  const items = useCart((s) => s.items);
  const { setQty, remove } = useCart.getState();
  const quote = useQuote();
  const navigate = useNavigate();
  const ref = useRef<HTMLElement>(null);
  useDialog(open, ref, hide);

  const q = quote.data;
  const empty = items.length === 0;
  const subtotal = q?.totals.subtotalPaise ?? 0;
  const threshold = q?.pricing.freeShippingThresholdPaise ?? 0;
  const left = Math.max(0, threshold - subtotal);

  return (
    <>
      <div className={`scrim${open ? " on" : ""}`} onClick={hide} aria-hidden="true" />
      <aside
        className={`drawer${open ? " on" : ""}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Your bag"
        tabIndex={-1}
        aria-hidden={!open}
      >
        <header>
          <h3>Your bag</h3>
          <button className="x" type="button" aria-label="Close" onClick={hide} />
        </header>
        <div className="body" aria-live="polite">
          {empty && (
            <div className="empty-bag">
              <p>Your bag is empty.</p>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  hide();
                  scrollToSection("shop");
                }}
              >
                Browse the collection
              </button>
            </div>
          )}
          {!empty && quote.isError && !q && <p className="msg no">Your bag could not be priced just now.</p>}
          {!empty && q && (
            <>
              <div>
                <p style={{ fontSize: 14 }}>
                  {left > 0 ? `Add ${formatINR(left)} more for free delivery.` : "Your order ships free."}
                </p>
                <div className="freebar" aria-hidden="true">
                  <i style={{ width: `${threshold ? Math.min(100, (subtotal / threshold) * 100) : 100}%` }} />
                </div>
              </div>
              {q.lines.map((l) => (
                <div className="line" key={`${l.slug}|${l.option}`}>
                  <LineThumb product={l.product} />
                  <div>
                    <h4>{l.product?.name ?? "A removed set"}</h4>
                    <small>{l.optionLabel}</small>
                    {!l.available && <small className="na">No longer available in this quantity</small>}
                    <div className="qty" role="group" aria-label={`Quantity of ${l.product?.name ?? "set"}`}>
                      <button
                        type="button"
                        aria-label="Fewer"
                        disabled={l.qty <= 1}
                        onClick={() => setQty(l.slug, l.option, l.qty - 1)}
                      >
                        &minus;
                      </button>
                      <span>{l.qty}</span>
                      <button
                        type="button"
                        aria-label="More"
                        disabled={l.qty >= MAX_QTY_PER_LINE}
                        onClick={() => setQty(l.slug, l.option, l.qty + 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="rt">
                    <b>{l.available ? formatINR(l.linePaise) : "–"}</b>
                    <button className="tlink" type="button" onClick={() => remove(l.slug, l.option)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        {!empty && q && (
          <div className="foot2">
            <div className="rows">
              <div>
                <span>Subtotal</span>
                <span>{formatINR(q.totals.subtotalPaise)}</span>
              </div>
              <div>
                <span>Delivery</span>
                <span>{q.totals.shippingPaise ? formatINR(q.totals.shippingPaise) : "Free"}</span>
              </div>
            </div>
            {!q.allAvailable && <p className="note">Remove the unavailable sets to continue.</p>}
            <button
              className="btn"
              type="button"
              disabled={!q.allAvailable || quote.isFetching}
              onClick={() => {
                hide();
                navigate("/checkout");
              }}
            >
              Checkout <span className="arrow" />
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
