import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * Modal behaviour for overlays: moves focus in, keeps Tab inside, closes on Escape,
 * locks page scroll, and returns focus to whatever opened it.
 */
export function useDialog(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;

    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = setTimeout(() => el.focus({ preventScroll: true }), 50);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.({ preventScroll: true });
    };
  }, [open, ref, onClose]);
}
