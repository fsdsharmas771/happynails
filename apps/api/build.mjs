// Production bundle: our code (including @happynails/shared) in one file per entry point.
// Packages from node_modules stay external and are installed in the image with `pnpm deploy --prod`.
import { build } from "esbuild";

await build({
  entryPoints: {
    index: "src/index.ts",
    seed: "src/scripts/seed.ts",
    "backfill-invoices": "src/scripts/backfill-invoices.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  plugins: [
    {
      name: "external-node-modules",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.kind === "entry-point" || args.path.startsWith("@happynails/")
            ? undefined
            : { path: args.path, external: true },
        );
      },
    },
  ],
});
