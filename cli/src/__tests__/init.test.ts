import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../init.js";

describe("runInit", () => {
  let originalCwd: string;
  let root: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    root = await mkdtemp(path.join(tmpdir(), "bdd-kit-init-"));
    await mkdir(path.join(root, "repo"));
    process.chdir(path.join(root, "repo"));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  });

  it("rejects target directories outside the current repo", async () => {
    await expect(
      runInit({ adapter: "playwright", dir: "../outside" }),
    ).rejects.toThrow(/--dir must stay within the current repo/);
  });

  it("rejects absolute target directories outside the current repo", async () => {
    await expect(
      runInit({ adapter: "playwright", dir: path.join(root, "outside") }),
    ).rejects.toThrow(/--dir must stay within the current repo/);
  });
});
