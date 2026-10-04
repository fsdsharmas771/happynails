import { z } from "zod";

// The Content-Security-Policy forbids eval; this stops Zod probing for it (it falls back anyway).
// Imported first in main.tsx so it runs before any schema is used.
z.config({ jitless: true });
