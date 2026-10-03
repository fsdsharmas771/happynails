import { Hero, Marquee } from "./Hero";

/** The storefront is one long page. Collection, size finder, booking, stories and FAQ join in later phases. */
export function HomePage() {
  return (
    <>
      <Hero />
      <Marquee />
    </>
  );
}
