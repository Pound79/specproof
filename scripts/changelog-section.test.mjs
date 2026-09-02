import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSection } from "./changelog-section.mjs";

// The CLI (main()) resolves CHANGELOG.md relative to its OWN file location
// (dirname(import.meta.url)/..), so exercising it end-to-end means running a
// copy of the script from a scratch "scripts/" dir next to a scratch
// CHANGELOG.md — the same layout as the real repo.
function runCli(changelogText, args, { viaSymlink = false } = {}) {
  const repoDir = mkdtempSync(join(tmpdir(), "changelog-section-cli-"));
  mkdirSync(join(repoDir, "scripts"));
  writeFileSync(join(repoDir, "CHANGELOG.md"), changelogText);
  const realScript = join(repoDir, "scripts", "changelog-section.mjs");
  copyFileSync(new URL("./changelog-section.mjs", import.meta.url), realScript);

  let scriptPath = realScript;
  if (viaSymlink) {
    scriptPath = join(repoDir, "scripts", "cs-link.mjs");
    symlinkSync(realScript, scriptPath);
  }

  try {
    const stdout = execFileSync("node", [scriptPath, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("returns the body of a normal section", () => {
  const text = `# Changelog

## [Unreleased]

## [0.2.2] - 2026-09-02

### Added

- one thing

## [0.2.1] - 2026-07-07

### Fixed

- older thing
`;
  assert.equal(extractSection(text, "0.2.2"), "### Added\n\n- one thing");
});

test("returns undefined when the heading does not exist", () => {
  const text = "# Changelog\n\n## [0.2.2] - 2026-09-02\n\nbody\n";
  assert.equal(extractSection(text, "9.9.9"), undefined);
});

// Regression: the heading match consumes its trailing newline, so an
// immediately-adjacent next heading has no leading "\n" for a naive
// `/\n## \[/` boundary to find — it used to fall through to the *next*
// occurrence and leak the older section's entire body into the "empty" one.
test("returns an empty string for a section immediately followed by another heading", () => {
  const text = `# Changelog

## [Unreleased]

## [0.3.0] - 2026-01-01
## [0.2.0] - 2025-01-01

### Added

- old stuff
`;
  assert.equal(extractSection(text, "0.3.0"), "");
});

test("returns an empty string for a section followed by a blank line then a heading", () => {
  const text = `## [0.3.0] - 2026-01-01

## [0.2.0] - 2025-01-01

### Added

- old stuff
`;
  assert.equal(extractSection(text, "0.3.0"), "");
});

test("strips trailing Keep a Changelog compare-link definitions from the last section", () => {
  const text = `## [0.2.0] - 2025-01-01

### Added

- old stuff

[Unreleased]: https://example.com/compare/v0.2.0...HEAD
[0.2.0]: https://example.com/compare/v0.1.0...v0.2.0
`;
  assert.equal(extractSection(text, "0.2.0"), "### Added\n\n- old stuff");
});

// Regression: a naive "stop at any `[x]: https://...` line" boundary (the
// first attempt at the trailing-link-def fix) truncated at a real,
// non-version reference-link *definition* even when it sits in the middle of
// a non-last section — silently dropping everything after it, including
// other subsections, up to the next "## [" heading.
test("preserves content after a non-version reference-link definition inside a non-last section", () => {
  const text = `## [0.3.0] - 2026-01-01

### Fixed

- Patched a vulnerability.

[cve]: https://nvd.nist.gov/vuln/detail/CVE-2026-0001

### Added

- Also added a feature.

## [0.2.0] - 2025-01-01

### Fixed

- older thing
`;
  assert.equal(
    extractSection(text, "0.3.0"),
    "### Fixed\n\n- Patched a vulnerability.\n\n[cve]: https://nvd.nist.gov/vuln/detail/CVE-2026-0001\n\n### Added\n\n- Also added a feature.",
  );
});

test("preserves a non-version reference link even as the trailing content line", () => {
  const text = `## [0.2.0] - 2025-01-01

### Fixed

- Patched a vulnerability.

[cve]: https://nvd.nist.gov/vuln/detail/CVE-2026-0001

[Unreleased]: https://example.com/compare/v0.2.0...HEAD
[0.2.0]: https://example.com/compare/v0.1.0...v0.2.0
`;
  assert.equal(
    extractSection(text, "0.2.0"),
    "### Fixed\n\n- Patched a vulnerability.\n\n[cve]: https://nvd.nist.gov/vuln/detail/CVE-2026-0001",
  );
});

test("escapes regex metacharacters in the version and matches a prerelease suffix", () => {
  const text = `## [0.3.0-rc.1] - 2026-01-01

### Added

- release candidate notes
`;
  assert.equal(extractSection(text, "0.3.0-rc.1"), "### Added\n\n- release candidate notes");
});

test("does not match a version string as a regex pattern", () => {
  const text = `## [0.2.0] - 2025-01-01

### Added

- unrelated section
`;
  // "0.2x0" as a literal string must not match "0.2.0" via a stray "."-as-wildcard.
  assert.equal(extractSection(text, "0.2x0"), undefined);
});

test("CLI: prints the section body and exits 0", () => {
  const text = "## [0.2.0] - 2025-01-01\n\n### Added\n\n- old stuff\n";
  const result = runCli(text, ["0.2.0"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "### Added\n\n- old stuff\n");
});

test("CLI: exits 64 with a usage message when no version is given", () => {
  const result = runCli("## [0.2.0] - 2025-01-01\n\nbody\n", []);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /usage: node scripts\/changelog-section\.mjs <version>/);
});

test("CLI: exits 1 with a distinct message when the section is missing", () => {
  const result = runCli("## [0.2.0] - 2025-01-01\n\nbody\n", ["9.9.9"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no "## \[9\.9\.9\]" section found/);
});

test("CLI: exits 1 with a distinct message when the section is empty", () => {
  const text = "## [0.3.0] - 2026-01-01\n## [0.2.0] - 2025-01-01\n\nbody\n";
  const result = runCli(text, ["0.3.0"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"## \[0\.3\.0\]" section is empty/);
});

// Regression: `process.argv[1] === fileURLToPath(import.meta.url)` compares a
// non-realpath'd argv[1] against a realpath'd import.meta.url, so invoking
// the script through a symlink made the entrypoint guard silently false —
// main() never ran and the process exited 0 with empty stdout instead of
// running the CLI. `import.meta.main` does not have this gap.
test("CLI: still runs main() when invoked through a symlink", () => {
  const text = "## [0.2.0] - 2025-01-01\n\n### Added\n\n- old stuff\n";
  const result = runCli(text, ["0.2.0"], { viaSymlink: true });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "### Added\n\n- old stuff\n");
});
