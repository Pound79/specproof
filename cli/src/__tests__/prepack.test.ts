import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line -- plain .mjs helper shared with scripts/prepack.mjs
import { bundle, includeInBundle } from "../../scripts/prepack-lib.mjs";

const makeTemplateTree = (root: string): string => {
  const src = path.join(root, "templates");
  mkdirSync(path.join(src, "flutter", ".dart_tool"), { recursive: true });
  mkdirSync(path.join(src, "flutter", "steps"), { recursive: true });
  writeFileSync(path.join(src, "flutter", ".dart_tool", "version"), "stale");
  writeFileSync(
    path.join(src, "flutter", ".flutter-plugins-dependencies"),
    "stale",
  );
  writeFileSync(path.join(src, "flutter", "pubspec.lock"), "stale");
  writeFileSync(path.join(src, "flutter", "pubspec.yaml"), "name: t");
  writeFileSync(path.join(src, "flutter", "steps", "a_steps.dart"), "ok");
  return src;
};

const listRecursive = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[]).map((p) =>
    p.split(path.sep).join("/"),
  );

describe("prepack bundle", () => {
  it("excludes gitignored build leftovers from the bundled copy", () => {
    const root = mkdtempSync(path.join(tmpdir(), "prepack-"));
    const src = makeTemplateTree(root);
    const dest = path.join(root, "bundled");

    bundle([[src, dest]]);

    const copied = listRecursive(dest);
    expect(copied).toContain("flutter/pubspec.yaml");
    expect(copied).toContain("flutter/steps/a_steps.dart");
    expect(copied.some((p) => p.includes(".dart_tool"))).toBe(false);
    expect(copied).not.toContain("flutter/.flutter-plugins-dependencies");
    expect(copied).not.toContain("flutter/pubspec.lock");
  });

  it("removes stale leftovers in the destination from a previously failed pack", () => {
    const root = mkdtempSync(path.join(tmpdir(), "prepack-"));
    const src = makeTemplateTree(root);
    const dest = path.join(root, "bundled");
    // Simulate a destination polluted by an older, unfiltered prepack run
    // that failed before postpack could clean it up.
    mkdirSync(path.join(dest, "flutter", ".dart_tool"), { recursive: true });
    writeFileSync(path.join(dest, "flutter", ".dart_tool", "version"), "old");
    writeFileSync(path.join(dest, "flutter", "pubspec.lock"), "old");

    bundle([[src, dest]]);

    const copied = listRecursive(dest);
    expect(copied.some((p) => p.includes(".dart_tool"))).toBe(false);
    expect(copied).not.toContain("flutter/pubspec.lock");
    expect(copied).toContain("flutter/pubspec.yaml");
  });

  it("includeInBundle keeps regular files and drops excluded names", () => {
    const root = mkdtempSync(path.join(tmpdir(), "prepack-"));
    const src = makeTemplateTree(root);
    expect(includeInBundle(path.join(src, "flutter", "pubspec.yaml"))).toBe(true);
    expect(includeInBundle(path.join(src, "flutter", "pubspec.lock"))).toBe(false);
    expect(includeInBundle(path.join(src, "flutter", ".dart_tool"))).toBe(false);
  });
});
