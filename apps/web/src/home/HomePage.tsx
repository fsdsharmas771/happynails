import { lazy, Suspense } from "react";
import { Collection } from "../catalogue/Collection";
import { ProductDrawer } from "../catalogue/ProductDrawer";
import { SizeFinder } from "../catalogue/SizeFinder";
import { useDocumentMeta } from "../lib/meta";
import { Hero, Marquee } from "./Hero";
import { BeforeAfter, Faq, Promises, Stories } from "./Sections";

// The booking flow is the heaviest part of the page and sits below the fold: load it separately.
const BookingSection = lazy(() =>
  import("../booking/BookingSection").then((m) => ({ default: m.BookingSection })),
);

/** The storefront is one long page, in the order of the design reference. */
export function HomePage() {
  useDocumentMeta();
  return (
    <>
      <Hero />
      <Marquee />
      <Collection />
      <SizeFinder />
      <Suspense
        fallback={<section className="sec" id="book" aria-busy="true" style={{ minHeight: "60vh" }} />}
      >
        <BookingSection />
      </Suspense>
      <Stories />
      <BeforeAfter />
      <Promises />
      <Faq />
      <ProductDrawer />
    </>
  );
}
