import { useEffect } from "react";
import { create } from "zustand";

interface ToastState {
  message: string;
  /** Bumps on every show so repeating the same message restarts the timer. */
  seq: number;
  visible: boolean;
  show: (message: string) => void;
  hide: () => void;
}

export const useToast = create<ToastState>()((set) => ({
  message: "",
  seq: 0,
  visible: false,
  show: (message) => set((s) => ({ message, seq: s.seq + 1, visible: true })),
  hide: () => set({ visible: false }),
}));

export function Toast() {
  const { message, seq, visible, hide } = useToast();
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(hide, 2400);
    return () => clearTimeout(t);
  }, [seq, visible, hide]);
  return (
    <div className={`toast${visible ? " on" : ""}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
