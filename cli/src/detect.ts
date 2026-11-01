import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readSmallTextFile } from "./bounded-read.js";

// 実行したディレクトリの検出用ファイルは信頼できない入力なので、大きさと種類を確かめて読む。
const MAX_DETECT_FILE_BYTES = 1024 * 1024;

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

const allDeps = (pkg: NonNullable<RepoSnapshot["packageJson"]>): Record<string, string> => ({
  ...pkg.dependencies,
  ...pkg.devDependencies,
});

const hasAny = (deps: Record<string, string>, names: readonly string[]): string[] =>
  names.filter((n) => Object.hasOwn(deps, n));

const hasWorkspaces = (workspaces?: Workspaces): boolean => {
  if (Array.isArray(workspaces)) {
    return workspaces.length > 0;
  }
  return Array.isArray(workspaces?.packages) && workspaces.packages.length > 0;
};

const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";

const hasPnpmWorkspace = (rootFiles: string[]): boolean => rootFiles.includes(PNPM_WORKSPACE_FILE);

const withMonorepoSignal = (signals: string[], isPnpmWorkspace: boolean): string[] =>
  isPnpmWorkspace ? [...signals, PNPM_WORKSPACE_FILE] : signals;

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
          confidence: candidate.confidence === "low" ? "medium" : candidate.confidence,
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

function detectEnvironmentHints(keys: readonly string[] | undefined): readonly EnvironmentHint[] {
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
      const matchingProvider = providerSignals.find((p) =>
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
        signals: providerSignals.filter((p) => p.provider === "mock").map((p) => p.label),
      });
    }
    if (nonMock) {
      hints.push({
        name: "dev",
        authProvider: nonMock.provider,
        signals: providerSignals.filter((p) => p.provider !== "mock").map((p) => p.label),
      });
    }
  }

  return hints;
}

export function detectAdapter(snapshot: RepoSnapshot): DetectResult {
  const candidates: AdapterCandidate[] = [];
  const hints: ConfigHints = { monorepo: false, environments: [] };
  const backendMatches = backendSignals(snapshot.rootFiles);
  const isPnpmWorkspace = hasPnpmWorkspace(snapshot.rootFiles);

  hints.monorepo =
    isPnpmWorkspace ||
    (snapshot.packageJson ? hasWorkspaces(snapshot.packageJson.workspaces) : false);

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
        signals: withMonorepoSignal(
          pwMatches.map((d) => `dep: ${d}`),
          isPnpmWorkspace,
        ),
      });
    } else if (fwMatches.length > 0) {
      candidates.push({
        adapter: "playwright",
        confidence: "medium",
        dir: hints.monorepo ? "packages/e2e" : "e2e",
        signals: withMonorepoSignal(
          fwMatches.map((d) => `web framework: ${d}`),
          isPnpmWorkspace,
        ),
      });
    } else {
      candidates.push({
        adapter: "playwright",
        confidence: "low",
        dir: hints.monorepo ? "packages/e2e" : "e2e",
        signals: withMonorepoSignal(
          ["package.json present (no web framework detected)"],
          isPnpmWorkspace,
        ),
      });
    }
  }

  return {
    candidates: withBackendSignals(candidates, backendMatches),
    hints: { ...hints, environments: detectEnvironmentHints(snapshot.envExampleKeys) },
  };
}

/** detect と init の推薦規則を共通化する。 */
export const selectAdapterCandidate = (result: DetectResult): AdapterCandidate | undefined => {
  const high = result.candidates.filter((candidate) => candidate.confidence === "high");
  if (high.length === 1) return high[0];
  if (high.length > 1) return undefined;
  const medium = result.candidates.filter((candidate) => candidate.confidence === "medium");
  return medium.length === 1 ? medium[0] : undefined;
};

// 環境変数の名前としてありうる長さ。ENV_SUFFIX_PATTERN などの正規表現は、長い名前で二乗の
// 時間がかかりうるので、それより長いキーは名前として扱わない。
const MAX_ENV_KEY_LENGTH = 256;

const parseEnvExampleKeys = (text: string): readonly string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim())
    .filter((key) => key.length > 0 && key.length <= MAX_ENV_KEY_LENGTH);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** 値がすべて文字列の object（dependencies の形）なら写しを返し、そうでなければ無視する。 */
const readStringMap = (value: unknown): Record<string, string> | undefined => {
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every(([, item]) => typeof item === "string")) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
};

/** workspaces は文字列の配列か、packages に文字列の配列を持つ object。それ以外は無視する。 */
const readWorkspaces = (value: unknown): Workspaces | undefined => {
  if (isStringArray(value)) return [...value];
  if (isPlainObject(value) && isStringArray(value.packages))
    return { packages: [...value.packages] };
  return undefined;
};

/**
 * JSON として読めた package.json から、使うフィールドを形を確かめて取り出す。形が違うフィールドは
 * 無いものとして扱う（例外で止めず、誤った候補も出さない）。トップレベルが object でなくても、
 * package.json があること自体は候補の手がかりとして残す。
 */
const readPackageJson = (raw: unknown): NonNullable<RepoSnapshot["packageJson"]> => {
  if (!isPlainObject(raw)) return {};
  const fields = {
    dependencies: readStringMap(raw.dependencies),
    devDependencies: readStringMap(raw.devDependencies),
    workspaces: readWorkspaces(raw.workspaces),
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as NonNullable<RepoSnapshot["packageJson"]>;
};

export async function collectSnapshot(root: string): Promise<RepoSnapshot> {
  const rootFiles = readdirSync(root).filter(
    (name) => !name.startsWith(".") || name === ".env.example",
  );

  const snapshot: RepoSnapshot = { rootFiles };

  const pkgPath = path.join(root, "package.json");
  if (existsSync(pkgPath)) {
    const raw: unknown = JSON.parse(readSmallTextFile(pkgPath, MAX_DETECT_FILE_BYTES));
    snapshot.packageJson = readPackageJson(raw);
  }

  const pubspecPath = path.join(root, "pubspec.yaml");
  if (existsSync(pubspecPath)) {
    const text = readSmallTextFile(pubspecPath, MAX_DETECT_FILE_BYTES);
    snapshot.pubspecYaml = {
      hasFlutterSdk:
        /^[ \t]*flutter:[ \t]*(?:#.*)?\r?\n(?:[ \t]*(?:#.*)?\r?\n)*[ \t]+sdk:[ \t]*flutter[ \t]*(?:#.*)?$/m.test(
          text,
        ),
    };
  }

  const envExamplePath = path.join(root, ".env.example");
  if (existsSync(envExamplePath)) {
    snapshot.envExampleKeys = parseEnvExampleKeys(
      readSmallTextFile(envExamplePath, MAX_DETECT_FILE_BYTES),
    );
  }

  return snapshot;
}
