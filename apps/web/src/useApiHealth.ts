import { useEffect, useState } from "react";
import { healthResponseSchema, type HealthResponse } from "@happynails/shared";

export type ApiHealth =
  { state: "loading" } | { state: "unreachable" } | { state: "ready"; body: HealthResponse };

/** Polls /api/health so the boot screen shows whether the API, Mongo and Redis are reachable. */
export function useApiHealth(intervalMs = 5000): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/health");
        const body = healthResponseSchema.parse(await res.json());
        if (!cancelled) setHealth({ state: "ready", body });
      } catch {
        if (!cancelled) setHealth({ state: "unreachable" });
      }
    }
    void check();
    const id = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return health;
}
