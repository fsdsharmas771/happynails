import { useCallback, useEffect, useRef, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { useTheme } from "@happynails/ui";
import { selectCount, useBagDrawer, useCart } from "../cart/store";
import { NAV_LINKS, SITE } from "../config/site";
import { scrollToSection } from "../lib/motion";
import { useDialog } from "../lib/useDialog";

/** Anchor that smooth-scrolls to an in-page section instead of jumping. */
export function SectionLink({
  to,
  onNavigate,
  ...rest
}: { to: string; onNavigate?: () => void } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onNavigate?.();
    scrollToSection(to);
  };
  return <a href={`#${to}`} onClick={onClick} {...rest} />;
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      className="theme"
      type="button"
      aria-pressed={dark}
      aria-label="Switch between light and dark theme"
      onClick={toggle}
    >
      <span className="orb" />
      <span className="tl">{dark ? "Light" : "Dark"}</span>
    </button>
  );
}

export function BagButton() {
  const count = useCart(selectCount);
  const showBag = useBagDrawer((s) => s.show);
  const ref = useRef<HTMLButtonElement>(null);
  const first = useRef(true);

  // Bump the badge whenever the count changes (not on first render).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const b = ref.current;
    if (!b) return;
    b.classList.remove("bump");
    void b.offsetWidth;
    b.classList.add("bump");
  }, [count]);

  return (
    <button
      className="bagbtn"
      type="button"
      ref={ref}
      onClick={showBag}
      aria-label={`Bag, ${count} ${count === 1 ? "item" : "items"}`}
    >
      Bag <b>{count}</b>
    </button>
  );
}

export function Brand() {
  return (
    <SectionLink to="top" className="brand" aria-label={`${SITE.name} ${SITE.byline}, home`}>
      <span className="mono">HN</span>
      <span className="bn">
        {SITE.name}
        <small>{SITE.byline}</small>
      </span>
    </SectionLink>
  );
}

function MenuOverlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(true, ref, onClose);
  return (
    <div className="menuov" ref={ref} role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1}>
      <div className="top">
        <span className="bn">{SITE.name}</span>
        <button className="x" type="button" aria-label="Close menu" onClick={onClose} />
      </div>
      {NAV_LINKS.map((l) => (
        <SectionLink key={l.id} to={l.id} onNavigate={onClose}>
          {l.label}
        </SectionLink>
      ))}
    </div>
  );
}

export function Nav() {
  const ref = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Slide away while scrolling down past the hero, come back on any scroll up.
  useEffect(() => {
    let lastY = scrollY;
    const onScroll = () => {
      const y = scrollY;
      ref.current?.classList.toggle("hide", y > lastY && y > 400);
      lastY = y;
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header className="nav" ref={ref}>
        <Brand />
        <nav className="links" aria-label="Main">
          {NAV_LINKS.map((l) => (
            <SectionLink key={l.id} to={l.id}>
              {l.label}
            </SectionLink>
          ))}
        </nav>
        <div className="tools">
          <ThemeToggle />
          <BagButton />
          <SectionLink to="book" className="btn sm mag">
            Book a visit
          </SectionLink>
          <button className="menu" type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            Menu
          </button>
        </div>
      </header>
      {menuOpen && <MenuOverlay onClose={closeMenu} />}
    </>
  );
}
