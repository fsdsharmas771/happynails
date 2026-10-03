import { Collection } from "../catalogue/Collection";
import { ProductDrawer } from "../catalogue/ProductDrawer";
import { SizeFinder } from "../catalogue/SizeFinder";
import { Hero, Marquee } from "./Hero";

/** The storefront is one long page. Booking, stories and FAQ join in later phases. */
export function HomePage() {
  return (
    <>
      <Hero />
      <Marquee />
      <Collection />
      <SizeFinder />
      <ProductDrawer />
    </>
  );
}
