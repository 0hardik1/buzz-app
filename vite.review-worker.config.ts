import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  ssr: { noExternal: true, target: "node" },
  build: {
    outDir: "dist-review-worker",
    emptyOutDir: true,
    ssr: "src/bundled/review-configuration/server/main.ts",
    rolldownOptions: {
      output: { entryFileNames: "review-worker.mjs", codeSplitting: false },
    },
  },
});
