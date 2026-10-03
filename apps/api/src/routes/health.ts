import { Router } from "express";
import type { HealthResponse } from "@happynails/shared";

export type HealthCheck = () => Promise<boolean>;

const CHECK_TIMEOUT_MS = 2000;

async function run(check: HealthCheck): Promise<"ok" | "down"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([check(), timeout])) ? "ok" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export function healthRouter(checks: { mongo: HealthCheck; redis: HealthCheck }): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    const [mongo, redis] = await Promise.all([run(checks.mongo), run(checks.redis)]);
    const body: HealthResponse = {
      status: mongo === "ok" && redis === "ok" ? "ok" : "down",
      checks: { mongo, redis },
      uptimeSeconds: Math.round(process.uptime()),
    };
    res.status(body.status === "ok" ? 200 : 503).json(body);
  });
  return router;
}
