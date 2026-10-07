import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../cli-args.js";

describe("parseCliArgs", () => {
  it("collects boolean flags and unrecognized tokens into flags", () => {
    const { flags, manifest, root } = parseCliArgs(["--json", "--github-annotations"]);
    expect(flags.has("--json")).toBe(true);
    expect(flags.has("--github-annotations")).toBe(true);
    expect(manifest).toBeUndefined();
    expect(root).toBeUndefined();
  });

  it("reads value options and does not leak them into flags", () => {
    const parsed = parseCliArgs([
      "--manifest",
      "m.yaml",
      "--root",
      "/repo",
      "--pages-dir",
      "src/pages",
      "--candidate-suffix",
      "_page.dart",
      "--link-id",
      "auth",
    ]);
    expect(parsed.manifest).toBe("m.yaml");
    expect(parsed.root).toBe("/repo");
    expect(parsed.pagesDir).toBe("src/pages");
    expect(parsed.candidateSuffix).toBe("_page.dart");
    expect(parsed.linkId).toBe("auth");
    expect(parsed.flags.size).toBe(0);
  });

  it("mixes value options and flags in any order", () => {
    const { flags, manifest } = parseCliArgs(["--json", "--manifest", "m.yaml"]);
    expect(manifest).toBe("m.yaml");
    expect(flags.has("--json")).toBe(true);
    expect(flags.has("m.yaml")).toBe(false);
  });

  it("throws when a value option is missing its value", () => {
    expect(() => parseCliArgs(["--manifest"])).toThrow(/--manifest requires a value/);
  });

  it("returns empty defaults for no arguments", () => {
    const { flags, manifest, root, pagesDir, candidateSuffix } = parseCliArgs([]);
    expect(flags.size).toBe(0);
    expect(manifest).toBeUndefined();
    expect(root).toBeUndefined();
    expect(pagesDir).toBeUndefined();
    expect(candidateSuffix).toBeUndefined();
  });
});

describe("parseCliArgs の値の判定", () => {
  it("単一ハイフンで始まる値を受け付ける", () => {
    expect(parseCliArgs(["--candidate-suffix", "-page.ts"], "list").candidateSuffix).toBe(
      "-page.ts",
    );
    expect(parseCliArgs(["--link-id", "-legacy"], "update").linkId).toBe("-legacy");
  });

  it("オプションやヘルプ指定を値として取り込まない", () => {
    for (const value of ["--json", "--strict", "-h"]) {
      expect(() => parseCliArgs(["--manifest", value], "check")).toThrow(/requires a value/);
    }
  });
});
