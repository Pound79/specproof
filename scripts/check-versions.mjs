#!/usr/bin/env node
//
// Assert that every user-facing version source in this repo agrees.
//
// This repo ships the same release through two independent channels, each with
// its OWN version field:
//
//   npm packages       cli/package.json, packages/traceability/package.json
//                      (bumped by `npm version --workspaces` in release.sh)
//   Claude Code plugin .claude-plugin/marketplace.json (metadata.version)
//                      plugins/specproof/.claude-plugin/plugin.json (version)
//                      (bumped explicitly by release.sh)
//
// `npm version --workspaces` only touches npm workspaces, so the plugin
// manifests are structurally outside its reach. This check is the backstop:
// if any source drifts (a manual edit, a release step that forgets one, a bad
// merge), CI goes red on the PR instead of shipping a plugin whose version
// label lags the published npm package — the exact bug that stranded the
// plugin at 0.1.4 while npm was already 0.1.5.
//
// The root package.json is intentionally excluded: it is `private` and pinned
// to 0.0.0 (it is never published and never installed as a plugin).
//
// Exit 0 if all sources match; exit 1 (with a table) if they diverge.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Each source: a human label, the repo-relative file, and how to pull the
// version out of the parsed JSON.
const SOURCES = [
  {
    label: "npm @pound79/specproof",
    file: "cli/package.json",
    get: (json) => json.version,
  },
  {
    label: "npm @pound79/specproof-traceability",
    file: "packages/traceability/package.json",
    get: (json) => json.version,
  },
  {
    label: "plugin marketplace",
    file: ".claude-plugin/marketplace.json",
    get: (json) => json.metadata?.version,
  },
  {
    label: "plugin manifest",
    file: "plugins/specproof/.claude-plugin/plugin.json",
    get: (json) => json.version,
  },
];

const rows = SOURCES.map((source) => {
  const path = join(repoRoot, source.file);
  let version;
  try {
    version = source.get(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    return { ...source, version: undefined, error: err.message };
  }
  return { ...source, version };
});

const width = Math.max(...rows.map((r) => r.label.length));
const line = (r) =>
  `  ${r.label.padEnd(width)}  ${r.version ?? "(missing)"}  ${r.file}`;

const missing = rows.filter((r) => !r.version);
const versions = new Set(rows.map((r) => r.version));
const consistent = missing.length === 0 && versions.size === 1;

if (consistent) {
  console.log(`version check: all sources at ${rows[0].version}`);
  for (const r of rows) console.log(line(r));
  process.exit(0);
}

console.error("version check FAILED: sources disagree\n");
for (const r of rows) console.error(line(r) + (r.error ? `  (${r.error})` : ""));
console.error(
  "\nAll four version sources must match. The npm packages are bumped by " +
    "`npm version --workspaces`; the two plugin manifests are bumped by " +
    "scripts/release.sh. Run a release via scripts/release.sh (which bumps " +
    "all of them in lockstep) rather than editing versions by hand.",
);
process.exit(1);
