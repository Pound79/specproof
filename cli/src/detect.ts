import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export interface RepoSnapshot {
  rootFiles: string[];
  packageJson?: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: Workspaces;
  };
  pubspecYaml?: { hasFlutterSdk: boolean };
  envExampleKeys?: readonly string[];
}

type Workspaces = string[] | { packages?: string[] };

export type Confidence = "high" | "medium" | "low";
export type Adapter = "flutter" | "playwright";

export interface AdapterCandidate {
  adapter: Adapter;
  confidence: Confidence;
  dir: string;
  signals: string[];
}

export interface EnvironmentHint {
  readonly name: string;
  readonly authProvider?: string;
  readonly signals: readonly string[];
}

export interface ConfigHints {
  baseUrl?: string;
  language?: string;
  monorepo: boolean;
  environments: readonly EnvironmentHint[];
}

export interface DetectResult {
  candidates: AdapterCandidate[];
  hints: ConfigHints;
}

const PLAYWRIGHT_DEPS = ["@playwright/test", "playwright-bdd"] as const;

const WEB_FRAMEWORK_DEPS = [
  "react",
  "vue",
  "svelte",
  "next",
  "nuxt",
  "vite",
  "@angular/core",
] as const;

const WEB_BACKEND_MARKERS: readonly { file: string; label: string }[] = [
  { file: "composer.json", label: "PHP (composer.json)" },
  { file: "artisan", label: "Laravel (artisan)" },
  { file: "Gemfile", label: "Ruby (Gemfile)" },
  { file: "requirements.txt", label: "Python (requirements.txt)" },
  { file: "pyproject.toml", label: "Python (pyproject.toml)" },
  { file: "go.mod", label: "Go (go.mod)" },
  { file: "pom.xml", label: "Java (pom.xml)" },
  { file: "build.gradle", label: "Java/Kotlin (build.gradle)" },
  { file: "Cargo.toml", label: "Rust (Cargo.toml)" },
  { file: "mix.exs", label: "Elixir (mix.exs)" },
] as const;

const allDeps = (
  pkg: NonNullable<RepoSnapshot["packageJson"]>,
): Record<string, string> => ({
  ...pkg.dependencies,
  ...pkg.devDependencies,
});

const hasAny = (
  deps: Record<string, string>,
  names: readonly string[],
): string[] => names.filter((n) => n in deps);

const hasWorkspaces = (workspaces?: Workspaces): boolean => {
  if (Array.isArray(workspaces)) {
    return workspaces.length > 0;
  }
  return Array.isArray(workspaces?.packages) && workspaces.packages.length > 0;
};

const backendSignals = (rootFiles: string[]): string[] =>
  WEB_BACKEND_MARKERS.filter((m) => rootFiles.includes(m.file)).map(
    (m) => `web backend: ${m.label}`,
  );

const withBackendSignals = (
  candidates: AdapterCandidate[],
  matches: string[],
): AdapterCandidate[] => {
  if (matches.length === 0) {
    return candidates;
  }

  if (candidates.every((c) => c.adapter !== "playwright")) {
    return [
      ...candidates,
      {
        adapter: "playwright",
        confidence: "medium",
        dir: "e2e",
        signals: matches,
      },
    ];
  }

  return candidates.map((candidate) =>
    candidate.adapter === "playwright"
      ? {
          ...candidate,
          confidence:
            candidate.confidence === "low" ? "medium" : candidate.confidence,
          signals: [...candidate.signals, ...matches],
        }
      : candidate,
  );
};

const AUTH_PROVIDER_PATTERNS: readonly {
  pattern: RegExp;
  provider: string;
  label: string;
}[] = [
  { pattern: /MOCK_AUTH|FORCE_MOCK/i, provider: "mock", label: "mock auth key" },
  { pattern: /GOOGLE_AUTH|GOOGLE_CLIENT/i, provider: "google", label: "Google auth key" },
  { pattern: /SAML_|SSO_/i, provider: "saml", label: "SAML/SSO key" },
];

const ENV_SUFFIX_PATTERN = /^[A-Z0-9_]+_(LOCAL|DEV|STAGING|PROD)(?:_[A-Z0-9_]+)?$/;

function detectEnvironmentHints(
  keys: readonly string[] | undefined,
): readonly EnvironmentHint[] {
  if (!keys || keys.length === 0) {
    return [];
  }

  const hints: EnvironmentHint[] = [];

  const envNames = new Set<string>();
  for (const key of keys) {
    const match = ENV_SUFFIX_PATTERN.exec(key);
    if (match) {
      envNames.add(match[1].toLowerCase());
    }
  }

  const providerSignals: { provider: string; label: string }[] = [];
  for (const key of keys) {
    for (const { pattern, provider, label } of AUTH_PROVIDER_PATTERNS) {
      if (pattern.test(key)) {
        providerSignals.push({ provider, label: `env: ${key} (${label})` });
      }
    }
  }

  if (envNames.size > 0) {
    for (const name of envNames) {
      const matchingProvider = providerSignals.find(
        (p) =>
          p.provider === "mock" ? name === "local" : name !== "local",
      );
      hints.push({
        name,
        authProvider: matchingProvider?.provider,
        signals: [`env suffix: *_${name.toUpperCase()}_*`],
      });
    }
  } else if (providerSignals.length > 0) {
    const hasMock = providerSignals.some((p) => p.provider === "mock");
    const nonMock = providerSignals.find((p) => p.provider !== "mock");

    if (hasMock) {
      hints.push({
        name: "local",
        authProvider: "mock",
        signals: providerSignals
          .filter((p) => p.provider === "mock")
          .map((p) => p.label),
      });
    }
    if (nonMock) {
      hints.push({
        name: "dev",
        authProvider: nonMock.provider,
        signals: providerSignals
          .filter((p) => p.provider !== "mock")
          .map((p) => p.label),
      });
    }
  }

  return hints;
}

export function detectAdapter(snapshot: RepoSnapshot): DetectResult {
  const candidates: AdapterCandidate[] = [];
  const hints: ConfigHints = { monorepo: false, environments: [] };
  const backendMatches = backendSignals(snapshot.rootFiles);

  if (snapshot.packageJson) {
    hints.monorepo = hasWorkspaces(snapshot.packageJson.workspaces);
  }

  if (snapshot.pubspecYaml?.hasFlutterSdk) {
    candidates.push({
      adapter: "flutter",
      confidence: "high",
      dir: "bdd_tests",
      signals: ["pubspec.yaml flutter SDK"],
    });
  }

  if (snapshot.packageJson) {
    const deps = allDeps(snapshot.packageJson);
    const pwMatches = hasAny(deps, PLAYWRIGHT_DEPS);
    const fwMatches = hasAny(deps, WEB_FRAMEWORK_DEPS);

    if (pwMatches.length > 0) {
      candidates.push({
        adapter: "playwright",
        confidence: "high",
        dir: hints.monorepo ? "packages/e2e" : "e2e",
        signals: pwMatches.map((d) => `dep: ${d}`),
      });
    } else if (fwMatches.length > 0) {
      candidates.push({
        adapter: "playwright",
        confidence: "medium",
        dir: hints.monorepo ? "packages/e2e" : "e2e",
        signals: fwMatches.map((d) => `web framework: ${d}`),
      });
    } else {
      candidates.push({
        adapter: "playwright",
        confidence: "low",
        dir: hints.monorepo ? "packages/e2e" : "e2e",
        signals: ["package.json present (no web framework detected)"],
      });
    }
  }

  return {
    candidates: withBackendSignals(candidates, backendMatches),
    hints: { ...hints, environments: detectEnvironmentHints(snapshot.envExampleKeys) },
  };
}

const parseEnvExampleKeys = (text: string): readonly string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim())
    .filter((key) => key.length > 0);

export async function collectSnapshot(root: string): Promise<RepoSnapshot> {
  const rootFiles = readdirSync(root).filter(
    (name) => !name.startsWith(".") || name === ".env.example",
  );

  const snapshot: RepoSnapshot = { rootFiles };

  const pkgPath = path.join(root, "package.json");
  if (existsSync(pkgPath)) {
    const raw = JSON.parse(readFileSync(pkgPath, "utf-8"));
    snapshot.packageJson = {
      dependencies: raw.dependencies,
      devDependencies: raw.devDependencies,
      workspaces: raw.workspaces,
    };
  }

  const pubspecPath = path.join(root, "pubspec.yaml");
  if (existsSync(pubspecPath)) {
    const text = readFileSync(pubspecPath, "utf-8");
    snapshot.pubspecYaml = {
      hasFlutterSdk: /flutter:\s*\n\s+sdk:\s*flutter/m.test(text),
    };
  }

  const envExamplePath = path.join(root, ".env.example");
  if (existsSync(envExamplePath)) {
    snapshot.envExampleKeys = parseEnvExampleKeys(
      readFileSync(envExamplePath, "utf-8"),
    );
  }

  return snapshot;
}
