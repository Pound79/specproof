import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// src/__tests__/templates.test.ts -> repo root is four levels up.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const read = (relPath: string): string =>
  readFileSync(path.join(repoRoot, relPath), "utf8");

const traceabilityVersion = (
  JSON.parse(read("packages/traceability/package.json")) as { version: string }
).version;
const pinnedTraceabilityPackage =
  `@pound79/specproof-traceability@${traceabilityVersion}`;

const TEMPLATE_CONFIGS = [
  "templates/playwright/specproof.config.yaml",
  "templates/flutter/specproof.config.yaml",
];

// The traceability engine exposes four bins; templates wire all four so the
// drift / bless / list / stats workflow works out of the box.
const EXPECTED_COMMANDS: Record<string, string> = {
  traceabilityCheck: `npx -y -p ${pinnedTraceabilityPackage} specproof-check`,
  traceabilityUpdate:
    `npx -y -p ${pinnedTraceabilityPackage} specproof-update`,
  traceabilityList: `npx -y -p ${pinnedTraceabilityPackage} specproof-list`,
  traceabilityStats:
    `npx -y -p ${pinnedTraceabilityPackage} specproof-stats`,
};

describe("template traceability commands", () => {
  for (const config of TEMPLATE_CONFIGS) {
    it(`${config} defines check / update / list with the npx -p form`, () => {
      const text = read(config);
      for (const [key, value] of Object.entries(EXPECTED_COMMANDS)) {
        expect(text).toContain(`${key}: "${value}"`);
      }
    });
  }
});

// `@pound79/specproof-traceability` exposes multiple bins, so invoking it via
// npx without `-p` cannot resolve a binary and fails at runtime. The `-p` flag
// (or a direct bin name after install) is required. Guard against the bare
// form regressing into any scaffold or skill doc.
//
// Built from parts so this guard file itself does not contain the literal bare
// form, keeping repo-wide greps for the bad form clean.
const BARE_NPX_FORM = ["npx", "-y", "@pound79/specproof-traceability"].join(" ");
const SCAN_DIRS = ["templates", "plugins", "docs"];
const SCAN_FILES = ["README.md"];
const TEXT_EXTENSIONS = new Set([".md", ".yaml", ".yml"]);

const textFilesUnder = (relDir: string): string[] =>
  readdirSync(path.join(repoRoot, relDir), { recursive: true })
    .map((entry) => String(entry))
    .filter(
      (entry) =>
        !entry.includes("node_modules") &&
        TEXT_EXTENSIONS.has(path.extname(entry)),
    )
    .map((entry) => path.join(relDir, entry));

describe("no stale npx form in scaffolds / docs", () => {
  const files = [...SCAN_DIRS.flatMap(textFilesUnder), ...SCAN_FILES];

  for (const file of files) {
    it(`${file} uses the npx -p form (no bare multi-bin npx)`, () => {
      expect(read(file).includes(BARE_NPX_FORM)).toBe(false);
    });
  }
});

const WORKFLOW_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/release.yml",
  "templates/playwright/github-workflows/specproof-drift-check.yml",
  "templates/flutter/github-workflows/specproof-drift-check.yml",
];

const EXPECTED_ACTION_SHAS: Record<string, string> = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
  "actions/github-script": "f28e40c7f34bde8b3046d885e986cb6290c5673b",
  "actions/dependency-review-action":
    "a1d282b36b6f3519aa1f3fc636f609c47dddb294",
};

describe("GitHub Actions supply-chain pins", () => {
  for (const file of WORKFLOW_FILES) {
    it(`${file} pins every third-party action to its reviewed full SHA`, () => {
      const uses = [...read(file).matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, action, ref] of uses) {
        expect(ref, `${file}: ${action}`).toBe(EXPECTED_ACTION_SHAS[action]);
      }
    });
  }
});
