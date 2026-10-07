import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // scaffold と子プロセス試験を過剰に並列化しない。
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**"],
      thresholds: {"lines":72,"statements":72,"functions":79,"branches":65},
    },
  },
});
