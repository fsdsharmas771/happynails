import { useId, type ReactNode } from "react";
import { label } from "../lib/format";

export function Field({
  label: text,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={`field${error ? " bad" : ""}`}>
      <label htmlFor={id}>{text}</label>
      {children(id)}
      {hint && !error && <span className="note">{hint}</span>}
      <div className="err" aria-live="polite">
        {error}
      </div>
    </div>
  );
}

const TONE: Record<string, "good" | "warn" | "bad" | "muted"> = {
  placed: "warn",
  packed: "warn",
  shipped: "good",
  delivered: "good",
  confirmed: "good",
  completed: "good",
  captured: "good",
  paid_after_visit: "good",
  pending_payment: "muted",
  pending: "muted",
  due: "warn",
  cancelled: "bad",
  refunded: "muted",
  failed: "bad",
  no_show: "bad",
};

export function Chip({ value }: { value: string }) {
  return <span className={`chip-s ${TONE[value] ?? "muted"}`}>{label(value)}</span>;
}

export function Message({ ok, children }: { ok?: boolean; children: ReactNode }) {
  if (!children) return null;
  return (
    <p className={`msg ${ok ? "ok" : "no"}`} role="status">
      {children}
    </p>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-h">
      <h1>{title}</h1>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
