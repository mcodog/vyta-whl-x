import { defineConfig } from "vitest/config";
import path from "node:path";

// Resolve the `@/…` path alias (from tsconfig `paths`) for tests, so unit tests
// can import source modules that reference sibling files via `@/lib/…`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
