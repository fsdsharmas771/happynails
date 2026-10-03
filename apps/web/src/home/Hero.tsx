import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatIstTime, istDateOf, istTimeOf, type VisitCity } from "@happynails/shared";
import { NailArt } from "@happynails/ui";
import { SectionLink } from "../layout/Nav";
import { api } from "../lib/api";
import { formatIstDate } from "../lib/dates";
import { prefersReducedMotion } from "../lib/motion";
import "./hero.css";

const MARQUEE_WORDS = [
  "Almond",
  "Coffin",
  "Rose chrome",
  "French tip",
  "Cat-eye",
  "Bridal",
  "Stiletto",
  "Glazed",
  "Hand finished",
  "Delhi NCR visits",
  "Shipped across India",
];

/** The real next open home-visit slot, from the booking engine. */
function NextSlot({ city }: { city: VisitCity }) {
  const next = useQuery({
    queryKey: ["nextSlot", city],
    queryFn: () => api.nextSlot(city),
    staleTime: 60_000,
  });
  const at = next.data?.startsAt ? new Date(next.data.startsAt) : null;
  return (
    <div className="nextslot" aria-live="polite">
      <span className="pulse" />
      {next.isPending ? (
        <span>Checking the calendar</span>
      ) : at ? (
        <span>
          Next home visit in {city}:{" "}
          <b>
            {formatIstDate(istDateOf(at))}, {formatIstTime(istTimeOf(at))}
          </b>
        </span>
      ) : (
        <span>Home visit slots open soon</span>
      )}
    </div>
  );
}

export function Hero() {
  const setRef = useRef<HTMLDivElement>(null);

  // Gentle parallax on the floating set while the hero is on screen.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const onScroll = () => {
      const y = scrollY;
      if (setRef.current && y < 900) {
        setRef.current.style.transform = `translateY(${y * 0.06}px) rotate(${y * 0.008}deg)`;
      }
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="hero" aria-label="Welcome">
      <div className="hero-copy">
        <p className="eyebrow">Press-on extensions &nbsp;/&nbsp; Home visits in Delhi NCR</p>
        <h1>
          <span className="ln">
            <span>Salon nails,</span>
          </span>
          <span className="ln">
            <span>
              <em>wherever</em>
            </span>
          </span>
          <span className="ln">
            <span>you are.</span>
          </span>
        </h1>
        <p className="lead">
          Hand-finished sets delivered across India. Or book Anamika&rsquo;s team to do them at your home in
          Delhi, Noida or Gurgaon.
        </p>
        <div className="cta">
          <SectionLink to="shop" className="btn mag">
            Shop the collection <span className="arrow" />
          </SectionLink>
          <SectionLink to="book" className="btn ghost mag">
            Book a home visit
          </SectionLink>
        </div>
        <NextSlot city="Delhi" />
      </div>
      <div className="hero-art">
        <svg className="ring" viewBox="0 0 600 600" aria-hidden="true">
          <ellipse cx="300" cy="300" rx="286" ry="280" strokeWidth="5" transform="rotate(-24 300 300)" />
          <ellipse
            className="b"
            cx="300"
            cy="304"
            rx="276"
            ry="288"
            strokeWidth="1.6"
            transform="rotate(8 300 300)"
          />
        </svg>
        <div className="hero-set" ref={setRef}>
          <NailArt shape="almond" finish="chrome" color="#D49C8B" label="A set of rose chrome almond nails" />
        </div>
        <span className="chip c1">Delhi &middot; Noida &middot; Gurgaon</span>
        <span className="chip c2">Delivery across India</span>
      </div>
    </section>
  );
}

export function Marquee() {
  // Two copies side by side so the -50% loop is seamless.
  const words = [...MARQUEE_WORDS, ...MARQUEE_WORDS];
  return (
    <div className="marq" aria-hidden="true">
      <div className="marq-in">
        {words.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
    </div>
  );
}
