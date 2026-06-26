import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// src/__tests__/templates.test.ts -> repo root is four levels up.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const read = (relPath: string): string =>
  readFileSync(path.join(repoRoot, relPath), "utf8");

const TEMPLATE_CONFIGS = [
  "templates/playwright/bdd-kit.config.yaml",
  "templates/flutter/bdd-kit.config.yaml",
];

// The traceability engine exposes four bins; templates wire all four so the
// drift / bless / list / stats workflow works out of the box.
const EXPECTED_COMMANDS: Record<string, string> = {
  traceabilityCheck: "npx -y -p @pound79/bdd-traceability bdd-traceability-check",
  traceabilityUpdate:
    "npx -y -p @pound79/bdd-traceability bdd-traceability-update",
  traceabilityList: "npx -y -p @pound79/bdd-traceability bdd-traceability-list",
  traceabilityStats:
    "npx -y -p @pound79/bdd-traceability bdd-traceability-stats",
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

// `@pound79/bdd-traceability` exposes multiple bins, so invoking it via npx
// without `-p` cannot resolve a binary and fails at runtime. The `-p` flag (or
// a direct bin name after install) is required. Guard against the bare form
// regressing into any scaffold or skill doc.
//
// Built from parts so this guard file itself does not contain the literal bare
// form, keeping repo-wide greps for the bad form clean.
const BARE_NPX_FORM = ["npx", "-y", "@pound79/bdd-traceability"].join(" ");
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
