import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // CommonJS for the worker, ESM for everything else. The slot vocabulary is bundled in, so the engine always agrees
  // with the core version it was built against.
  format: ["esm", "cjs"],
  dts: { resolve: ["@plinth-pages/core"] },
  clean: true,
  noExternal: ["@plinth-pages/core"],
  external: ["typescript", "prettier", "react", "react/jsx-runtime", "zod"],
});
