import { BookingSection } from "../booking/BookingSection";
import { Collection } from "../catalogue/Collection";
import { ProductDrawer } from "../catalogue/ProductDrawer";
import { SizeFinder } from "../catalogue/SizeFinder";
import { Hero, Marquee } from "./Hero";

/** The storefront is one long page. Stories, promises and FAQ join in phase 7. */
export function HomePage() {
  return (
    <>
      <Hero />
      <Marquee />
      <Collection />
      <SizeFinder />
      <BookingSection />
      <ProductDrawer />
    </>
  );
}
