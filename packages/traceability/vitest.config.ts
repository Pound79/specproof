import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 大きい manifest の解析が他の worker の変換処理と競合しないようにする。
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**"],
      thresholds: {"lines":84,"statements":84,"functions":89,"branches":81},
    },
  },
});
