import { z } from "zod";

export const dependencyStatusSchema = z.enum(["ok", "down"]);

export const healthResponseSchema = z.object({
  status: dependencyStatusSchema,
  checks: z.object({
    mongo: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
