import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**"],
      thresholds: {"lines":72,"statements":72,"functions":79,"branches":65},
    },
  },
});
