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

// Only version-shaped bracket contents are treated as Keep a Changelog
// compare-link definitions (e.g. "[0.2.2]: .../compare/v0.2.1...v0.2.2"), not
// any markdown reference link — a real reference-style link inside the notes
// themselves (e.g. "[cve]: https://...") must never be mistaken for one and
// truncated.
const VERSION_LINK_DEF = /^\[(?:Unreleased|\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\]:\s+\S+$/;

// Returns the trimmed section body for `## [<version>]`, or `undefined` if no
// such heading exists. The body itself may be the empty string.
export function extractSection(changelogText, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[${escaped}\\][^\n]*\n`, "m");
  const match = heading.exec(changelogText);
  if (!match) return undefined;

  const rest = changelogText.slice(match.index + match[0].length);
  // The heading match above consumes the trailing newline, so `rest` can
  // start directly with the next "## [" (no leading "\n") when a section is
  // empty — anchor on line-start (`^`, multiline) rather than a literal
  // preceding "\n" so an immediately-adjacent heading is still detected as
  // the boundary.
  const nextHeading = rest.search(/^## \[/m);
  let body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();

  // The oldest section has no following heading to bound it, so `body` runs
  // to EOF and picks up the trailing link-reference definitions. Strip a
  // trailing run of them.
  const lines = body.split("\n");
  while (lines.length > 0 && VERSION_LINK_DEF.test(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join("\n").trim();
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [, , version] = process.argv;
  if (!version) {
    console.error("usage: node scripts/changelog-section.mjs <version>");
    process.exit(64);
  }

  const text = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
  const body = extractSection(text, version);
  if (body === undefined) {
    console.error(`CHANGELOG.md: no "## [${version}]" section found`);
    process.exit(1);
  }
  if (!body) {
    console.error(`CHANGELOG.md: "## [${version}]" section is empty`);
    process.exit(1);
  }

  process.stdout.write(body + "\n");
}

if (import.meta.main) {
  main();
}
