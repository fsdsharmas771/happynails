export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Smooth-scrolls to an in-page section ("top" means the page start). Missing sections are ignored. */
export function scrollToSection(id: string): void {
  const target = id === "top" ? document.body : document.getElementById(id);
  target?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}
