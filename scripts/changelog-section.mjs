#!/usr/bin/env node
//
// Print the CHANGELOG.md body for `## [<version>]` to stdout.
//
// Used by the Release workflow (.github/workflows/release.yml) to populate
// GitHub Release notes without re-summarizing anything: the body is exactly
// what release.sh already stamped into CHANGELOG.md for this version.
//
// Usage: node scripts/changelog-section.mjs <version>
// Exit 1 if the section is missing or empty.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const [, , version] = process.argv;
if (!version) {
  console.error("usage: node scripts/changelog-section.mjs <version>");
  process.exit(64);
}

const text = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^## \\[${escaped}\\][^\n]*\n`, "m");
const match = heading.exec(text);
if (!match) {
  console.error(`CHANGELOG.md: no "## [${version}]" section found`);
  process.exit(1);
}

const rest = text.slice(match.index + match[0].length);
// The heading match above consumes the trailing newline, so `rest` can start
// directly with the next "## [" (no leading "\n") when a section is empty —
// anchor on line-start (`^`, multiline) rather than a literal preceding "\n"
// so an immediately-adjacent heading is still detected as the boundary.
// Also stop at Keep a Changelog compare-link definitions so the oldest
// section (which has no following heading) doesn't swallow them.
const boundary = /^(?:## \[|\[[^\]]+\]:\s*https?:)/m;
const nextHeading = rest.search(boundary);
const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
if (!body) {
  console.error(`CHANGELOG.md: "## [${version}]" section is empty`);
  process.exit(1);
}

process.stdout.write(body + "\n");
