import { describe, it, expect } from "vitest";
import { detectAdapter } from "../detect.js";
import type { RepoSnapshot } from "../detect.js";

describe("detectAdapter", () => {
  describe("flutter detection", () => {
    it("returns high confidence for pubspec.yaml with flutter SDK", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["pubspec.yaml", "lib", "test"],
        pubspecYaml: { hasFlutterSdk: true },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "flutter",
        confidence: "high",
        dir: "bdd_tests",
      });
      expect(result.candidates[0].signals).toContain("pubspec.yaml flutter SDK");
    });
  });

  describe("playwright detection", () => {
    it("returns high confidence for @playwright/test in deps", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", "src"],
        packageJson: {
          devDependencies: { "@playwright/test": "^1.60.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "high",
      });
    });

    it("returns high confidence for playwright-bdd in deps", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          devDependencies: { "playwright-bdd": "^8.5.1" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "high",
      });
    });

    it("returns medium confidence for web framework (react)", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", "src"],
        packageJson: {
          dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
      expect(result.candidates[0].signals.some((s) => s.includes("react"))).toBe(true);
    });

    it("returns medium confidence for next.js", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", "pages"],
        packageJson: {
          dependencies: { next: "^14.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
    });

    it("returns medium confidence for vue", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          dependencies: { vue: "^3.4.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
    });

    it("returns medium confidence for svelte", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          devDependencies: { svelte: "^4.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
    });

    it("returns medium confidence for @angular/core", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", "angular.json"],
        packageJson: {
          dependencies: { "@angular/core": "^17.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
    });

    it("returns medium confidence for vite", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", "vite.config.ts"],
        packageJson: {
          devDependencies: { vite: "^5.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
    });

    it("returns low confidence for bare package.json with no web framework", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          dependencies: { express: "^4.18.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "low",
      });
    });
  });

  describe("edge cases", () => {
    it("returns no candidates for empty repo", () => {
      const snapshot: RepoSnapshot = { rootFiles: [] };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(0);
    });

    it("returns no candidates for repo with only non-relevant files", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["README.md", ".gitignore", "Makefile"],
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(0);
    });

    it("returns medium playwright for PHP/Laravel repo without package.json", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["composer.json", "artisan", "app", "routes", "README.md"],
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
        dir: "e2e",
      });
      expect(result.candidates[0].signals.some((s) => s.includes("Laravel"))).toBe(true);
    });

    it("returns medium playwright for Python repo without package.json", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["requirements.txt", "manage.py", "app"],
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
    });

    it("returns medium playwright for Go repo without package.json", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["go.mod", "go.sum", "main.go"],
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
    });

    it("does not add backend-based playwright when package.json already provided one", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", "composer.json", "artisan"],
        packageJson: {
          dependencies: { react: "^18.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      const pwCandidates = result.candidates.filter((c) => c.adapter === "playwright");
      expect(pwCandidates).toHaveLength(1);
      expect(pwCandidates[0].confidence).toBe("medium");
      expect(pwCandidates[0].signals.some((s) => s.includes("react"))).toBe(true);
    });

    it("upgrades bare package.json detection when backend markers are present", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", "composer.json", "artisan"],
        packageJson: {
          dependencies: { axios: "^1.7.0" },
        },
      };
      const result = detectAdapter(snapshot);

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
      });
      expect(result.candidates[0].signals).toContain(
        "package.json present (no web framework detected)",
      );
      expect(result.candidates[0].signals.some((s) => s.includes("Laravel"))).toBe(true);
    });

    it("returns both candidates for monorepo with flutter and web", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["pubspec.yaml", "package.json", "packages"],
        pubspecYaml: { hasFlutterSdk: true },
        packageJson: {
          devDependencies: { "@playwright/test": "^1.60.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(2);
      const adapters = result.candidates.map((c) => c.adapter);
      expect(adapters).toContain("flutter");
      expect(adapters).toContain("playwright");
    });

    it("does not duplicate playwright when both framework and playwright dep exist", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          dependencies: { react: "^18.0.0" },
          devDependencies: { "@playwright/test": "^1.60.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].confidence).toBe("high");
    });
  });

  describe("config hints", () => {
    it("sets monorepo true when workspaces array is present", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          workspaces: ["packages/*"],
          dependencies: { react: "^18.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.hints.monorepo).toBe(true);
    });

    it("sets monorepo true when workspaces object is present", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          workspaces: { packages: ["packages/*"] },
          dependencies: { react: "^18.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.hints.monorepo).toBe(true);
    });

    it("sets monorepo false when no workspaces", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          dependencies: { react: "^18.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.hints.monorepo).toBe(false);
    });

    it("ignores malformed workspaces instead of crashing", () => {
      const snapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          workspaces: {},
          dependencies: { react: "^18.0.0" },
        },
      } as unknown as RepoSnapshot;

      const result = detectAdapter(snapshot);

      expect(result.hints.monorepo).toBe(false);
      expect(result.candidates[0]).toMatchObject({
        adapter: "playwright",
        confidence: "medium",
        dir: "e2e",
      });
    });
  });

  describe("environment hints", () => {
    it("returns empty environments when no .env.example keys", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          dependencies: { react: "^18.0.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.hints.environments).toHaveLength(0);
    });

    it("detects environment names from suffixed env keys", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", ".env.example"],
        packageJson: {
          dependencies: { react: "^18.0.0" },
        },
        envExampleKeys: [
          "E2E_BASE_URL_LOCAL",
          "E2E_BASE_URL_DEV",
          "E2E_USERNAME",
        ],
      };
      const result = detectAdapter(snapshot);
      const names = result.hints.environments.map((e) => e.name);
      expect(names).toContain("local");
      expect(names).toContain("dev");
    });

    it("detects mock auth provider from MOCK_AUTH key", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", ".env.example"],
        packageJson: {
          dependencies: { react: "^18.0.0" },
        },
        envExampleKeys: ["MOCK_AUTH", "GOOGLE_AUTH_CLIENT_ID"],
      };
      const result = detectAdapter(snapshot);
      expect(result.hints.environments).toHaveLength(2);
      const local = result.hints.environments.find((e) => e.name === "local");
      const dev = result.hints.environments.find((e) => e.name === "dev");
      expect(local?.authProvider).toBe("mock");
      expect(dev?.authProvider).toBe("google");
    });

    it("detects google auth from GOOGLE_CLIENT key", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", ".env.example"],
        packageJson: {
          dependencies: { react: "^18.0.0" },
        },
        envExampleKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      };
      const result = detectAdapter(snapshot);
      const dev = result.hints.environments.find((e) => e.name === "dev");
      expect(dev?.authProvider).toBe("google");
    });

    it("returns no environment hints when keys have no env signals", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json", ".env.example"],
        packageJson: {
          dependencies: { react: "^18.0.0" },
        },
        envExampleKeys: ["E2E_BASE_URL", "E2E_USERNAME", "E2E_PASSWORD"],
      };
      const result = detectAdapter(snapshot);
      expect(result.hints.environments).toHaveLength(0);
    });
  });

  describe("dir suggestion", () => {
    it("suggests packages/e2e for playwright in monorepo", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          workspaces: ["packages/*"],
          devDependencies: { "@playwright/test": "^1.60.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates[0].dir).toBe("packages/e2e");
    });

    it("suggests e2e for playwright in non-monorepo", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["package.json"],
        packageJson: {
          devDependencies: { "@playwright/test": "^1.60.0" },
        },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates[0].dir).toBe("e2e");
    });

    it("suggests bdd_tests for flutter", () => {
      const snapshot: RepoSnapshot = {
        rootFiles: ["pubspec.yaml"],
        pubspecYaml: { hasFlutterSdk: true },
      };
      const result = detectAdapter(snapshot);
      expect(result.candidates[0].dir).toBe("bdd_tests");
    });
  });
});
