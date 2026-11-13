import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRepoRoot, resolveDefaultManifestPath, normalizeMsysPath } from "../paths.js";

describe("resolveRepoRoot", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "traceability-paths-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds a directory containing specproof.config.yaml", async () => {
    await writeFile(path.join(root, "specproof.config.yaml"), "version: 1\n", "utf8");

    const result = resolveRepoRoot(root);

    expect(result).toBe(root);
  });

  it("finds a directory containing specproof.config.yml", async () => {
    await writeFile(path.join(root, "specproof.config.yml"), "version: 1\n", "utf8");

    const result = resolveRepoRoot(root);

    expect(result).toBe(root);
  });

  // 0.4.0 で旧名（bdd-kit）の設定ファイルは読まなくなった。親へたどる途中で旧名だけがある段に来たら、
  // 素通りして上の目印や git のトップを使う（置いた設定が黙って外れる）のではなく、名前の変更を案内して止める。
  for (const legacy of ["bdd-kit.config.yaml", "bdd-kit.config.yml"]) {
    it(`stops with a rename message at a directory holding only ${legacy}`, async () => {
      await writeFile(path.join(root, "traceability.yaml"), "version: 1\n", "utf8");
      const sub = path.join(root, "pkg", "e2e");
      const child = path.join(sub, "src");
      await mkdir(child, { recursive: true });
      await writeFile(path.join(sub, legacy), "version: 1\n", "utf8");

      expect(() => resolveRepoRoot(child)).toThrow(
        `${legacy} is no longer read; rename it to specproof.config.yaml`,
      );
    });
  }

  it("uses the current marker in the same directory as a leftover bdd-kit config", async () => {
    await writeFile(path.join(root, "bdd-kit.config.yaml"), "version: 1\n", "utf8");
    await writeFile(path.join(root, "traceability.yaml"), "version: 1\n", "utf8");

    expect(resolveRepoRoot(root)).toBe(root);
  });

  it("finds a directory containing traceability.yaml", async () => {
    await writeFile(path.join(root, "traceability.yaml"), "version: 1\n", "utf8");

    const result = resolveRepoRoot(root);

    expect(result).toBe(root);
  });

  it("walks up to a parent directory containing a marker", async () => {
    await writeFile(path.join(root, "specproof.config.yaml"), "version: 1\n", "utf8");
    const child = path.join(root, "packages", "sub");
    await mkdir(child, { recursive: true });

    const result = resolveRepoRoot(child);

    expect(result).toBe(root);
  });

  describe("manifest がサブディレクトリにあるとき", () => {
    const setup = async (config: string | undefined): Promise<string> => {
      const e2e = path.join(root, "e2e");
      await mkdir(e2e, { recursive: true });
      await writeFile(path.join(e2e, "traceability.yaml"), "version: 1\nlinks: []\n", "utf8");
      if (config !== undefined) {
        await writeFile(path.join(root, "specproof.config.yaml"), config, "utf8");
      }
      return e2e;
    };

    it("上の設定ファイルが layout.manifest でその manifest を指せば、設定ファイルの段をルートにする", async () => {
      const e2e = await setup('layout:\n  manifest: "./e2e/traceability.yaml"\n');
      expect(resolveRepoRoot(e2e)).toBe(root);
    });

    it("上の設定ファイルが別の manifest を指すなら、従来どおり manifest の段をルートにする", async () => {
      const e2e = await setup('layout:\n  manifest: "other/traceability.yaml"\n');
      expect(resolveRepoRoot(e2e)).toBe(e2e);
    });

    it("上の設定ファイルに layout.manifest が無ければ、従来どおり manifest の段をルートにする", async () => {
      const e2e = await setup("version: 1\n");
      expect(resolveRepoRoot(e2e)).toBe(e2e);
    });

    it("上の設定ファイルが読めなければ、止めずに従来どおり manifest の段をルートにする", async () => {
      const e2e = await setup("layout: [unclosed\n");
      expect(resolveRepoRoot(e2e)).toBe(e2e);
    });

    it("最も近い設定ファイルだけを見る（さらに上の設定ファイルが指していても採らない）", async () => {
      const pkg = path.join(root, "pkg");
      const e2e = path.join(pkg, "e2e");
      await mkdir(e2e, { recursive: true });
      await writeFile(path.join(e2e, "traceability.yaml"), "version: 1\nlinks: []\n", "utf8");
      await writeFile(path.join(pkg, "specproof.config.yaml"), "version: 1\n", "utf8");
      await writeFile(
        path.join(root, "specproof.config.yaml"),
        'layout:\n  manifest: "pkg/e2e/traceability.yaml"\n',
        "utf8",
      );
      expect(resolveRepoRoot(e2e)).toBe(e2e);
    });

    it(".git のある段より上の設定ファイルは見ない", async () => {
      const repo = path.join(root, "repo");
      const e2e = path.join(repo, "e2e");
      await mkdir(path.join(repo, ".git"), { recursive: true });
      await mkdir(e2e, { recursive: true });
      await writeFile(path.join(e2e, "traceability.yaml"), "version: 1\nlinks: []\n", "utf8");
      await writeFile(
        path.join(root, "specproof.config.yaml"),
        'layout:\n  manifest: "repo/e2e/traceability.yaml"\n',
        "utf8",
      );
      expect(resolveRepoRoot(e2e)).toBe(e2e);
    });

    it(".git のある段の設定ファイルは見る", async () => {
      const e2e = await setup('layout:\n  manifest: "e2e/traceability.yaml"\n');
      await mkdir(path.join(root, ".git"));
      expect(resolveRepoRoot(e2e)).toBe(root);
    });

    it(".yml の設定ファイルと絶対パスの layout.manifest も読む", async () => {
      const e2e = path.join(root, "e2e");
      await mkdir(e2e, { recursive: true });
      await writeFile(path.join(e2e, "traceability.yaml"), "version: 1\nlinks: []\n", "utf8");
      await writeFile(
        path.join(root, "specproof.config.yml"),
        `layout:\n  manifest: ${JSON.stringify(path.join(e2e, "traceability.yaml"))}\n`,
        "utf8",
      );
      expect(resolveRepoRoot(e2e)).toBe(root);
    });

    it("設定ファイルが無ければ manifest の段をルートにする", async () => {
      const e2e = await setup(undefined);
      expect(resolveRepoRoot(e2e)).toBe(e2e);
    });
  });

  it("throws when no marker file and not inside a git repo", async () => {
    expect(() => resolveRepoRoot(root)).toThrow(/Could not resolve a repo root/);
  });
});

describe("normalizeMsysPath", () => {
  describe("on win32", () => {
    beforeEach(() => {
      vi.stubGlobal("process", { ...process, platform: "win32" });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("converts MSYS /c/Users/... to C:/Users/...", () => {
      expect(normalizeMsysPath("/c/Users/foo/repo")).toBe("C:/Users/foo/repo");
    });

    it("converts uppercase drive letter", () => {
      expect(normalizeMsysPath("/D/projects/app")).toBe("D:/projects/app");
    });

    it("handles bare drive root /c", () => {
      expect(normalizeMsysPath("/c")).toBe("C:/");
    });

    it("passes through multi-char first segment paths unchanged", () => {
      expect(normalizeMsysPath("/home/user/repo")).toBe("/home/user/repo");
    });

    it("passes through Windows-native paths unchanged", () => {
      expect(normalizeMsysPath("C:\\Users\\foo")).toBe("C:\\Users\\foo");
    });

    it("passes through relative paths unchanged", () => {
      expect(normalizeMsysPath("src/main")).toBe("src/main");
    });
  });

  describe("on non-Windows", () => {
    it("does not convert single-char root paths on macOS/Linux", () => {
      expect(normalizeMsysPath("/c/Users/foo")).toBe("/c/Users/foo");
    });
  });
});

describe("resolveDefaultManifestPath", () => {
  it("returns traceability.yaml under the given root", () => {
    const result = resolveDefaultManifestPath("/some/repo");

    expect(result).toBe(path.join("/some/repo", "traceability.yaml"));
  });
});
