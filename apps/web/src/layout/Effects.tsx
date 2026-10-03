import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../lib/motion";

/** Thin gold bar across the top that fills as the page scrolls. */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      el.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update, { passive: true });
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, []);
  return <div className="progress" ref={ref} aria-hidden="true" />;
}

/** Cursor follower: a gold ring in light theme, a soft rose-gold spotlight in dark. Mouse only. */
export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    let tx = 0;
    let ty = 0;
    let raf = 0;
    // Ease towards the pointer; stop the loop once it has caught up.
    const tick = () => {
      sx += (tx - sx) * 0.16;
      sy += (ty - sy) * 0.16;
      el.style.transform = `translate(${sx}px,${sy}px)`;
      raf = Math.abs(tx - sx) + Math.abs(ty - sy) > 0.5 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      el.classList.add("on");
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onLeave = () => el.classList.remove("on");
    addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  return <div className="spot" ref={ref} aria-hidden="true" />;
}

/** Buttons marked `.mag` lean towards the pointer while hovered. */
export function useMagneticButtons(): void {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let active: HTMLElement | null = null;
    const onMove = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>(".mag") : null;
      if (active && active !== target) active.style.translate = "";
      active = target;
      if (!target) return;
      const r = target.getBoundingClientRect();
      target.style.translate = `${(e.clientX - r.left - r.width / 2) * 0.18}px ${(e.clientY - r.top - r.height / 2) * 0.28}px`;
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (active) active.style.translate = "";
    };
  }, []);
}
