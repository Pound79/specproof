import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSafeRepositoryWrite } from "../path-security.js";

describe("assertSafeRepositoryWrite", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "specproof-path-security-"));
    await mkdir(path.join(root, "repo"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("allows an in-repository path whose name starts with two dots", () => {
    const repo = path.join(root, "repo");
    expect(() =>
      assertSafeRepositoryWrite(repo, path.join(repo, "..generated", "file.ts")),
    ).not.toThrow();
  });
});
