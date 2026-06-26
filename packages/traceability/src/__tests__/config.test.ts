import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverConfig } from "../config.js";
import { resolveRepoRoot } from "../paths.js";

const created: string[] = [];

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "bddtrace-"));
  created.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveRepoRoot", () => {
  it("returns the directory containing traceability.yaml, walking up", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "traceability.yaml"),
      "version: 1\nlinks: []\n",
    );
    const nested = path.join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    expect(resolveRepoRoot(nested)).toBe(root);
  });

  it("throws when no marker file exists and not inside a git repo", async () => {
    // A bare tmp dir has no marker and tmpdir() is outside any git tree, so
    // the git rev-parse fallback fails too.
    const root = await makeTmp();
    expect(() => resolveRepoRoot(root)).toThrow(
      /Could not resolve a repo root/,
    );
  });
});

describe("discoverConfig", () => {
  it("defaults manifestPath to <root>/traceability.yaml", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "traceability.yaml"),
      "version: 1\nlinks: []\n",
    );
    const config = discoverConfig({ startDir: root });
    expect(config.repoRoot).toBe(root);
    expect(config.manifestPath).toBe(path.join(root, "traceability.yaml"));
  });

  it("prefers bdd-kit.config.yaml layout.manifest over the default", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "traceability.yaml"),
      "version: 1\nlinks: []\n",
    );
    await writeFile(
      path.join(root, "bdd-kit.config.yaml"),
      "layout:\n  manifest: packages/e2e/traceability.yaml\n  pagesDir: packages/web/pages\n  candidateSuffix: Page.tsx\n  featuresDir: packages/e2e/features\n",
    );
    const config = discoverConfig({ startDir: root });
    expect(config.manifestPath).toBe(
      path.join(root, "packages/e2e/traceability.yaml"),
    );
    expect(config.pagesDir).toBe("packages/web/pages");
    expect(config.candidateSuffix).toBe("Page.tsx");
    expect(config.featuresDir).toBe("packages/e2e/features");
  });

  it("lets an explicit manifest override win over discovery", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "traceability.yaml"),
      "version: 1\nlinks: []\n",
    );
    const custom = path.join(root, "custom.yaml");
    const config = discoverConfig({ root, manifest: custom });
    expect(config.manifestPath).toBe(custom);
  });

  it("lets an explicit root override set repoRoot without walking", async () => {
    const root = await makeTmp();
    const config = discoverConfig({ root });
    expect(config.repoRoot).toBe(path.resolve(root));
    expect(config.manifestPath).toBe(path.join(root, "traceability.yaml"));
  });

  it("lets a --pages-dir override win over the config file", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "bdd-kit.config.yaml"),
      "layout:\n  pagesDir: from-config\n",
    );
    const config = discoverConfig({ root, pagesDir: "from-cli" });
    expect(config.pagesDir).toBe("from-cli");
  });

  it("lets a --candidate-suffix override win over the config file", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "bdd-kit.config.yaml"),
      "layout:\n  candidateSuffix: Page.tsx\n",
    );
    const config = discoverConfig({ root, candidateSuffix: "_page.dart" });
    expect(config.candidateSuffix).toBe("_page.dart");
  });

  it("defaults fixmeTag / skipTag to @fixme / @skip when tags are omitted", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "bdd-kit.config.yaml"),
      "layout:\n  manifest: traceability.yaml\n",
    );
    const config = discoverConfig({ root });
    expect(config.fixmeTag).toBe("@fixme");
    expect(config.skipTag).toBe("@skip");
  });

  it("reads tags.fixme / tags.skip from bdd-kit.config.yaml", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "bdd-kit.config.yaml"),
      "tags:\n  fixme: '@todo'\n  skip: '@manual'\n",
    );
    const config = discoverConfig({ root });
    expect(config.fixmeTag).toBe("@todo");
    expect(config.skipTag).toBe("@manual");
  });

  it("normalizes a tag missing the leading @ (else it never matches a scanned tag)", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "bdd-kit.config.yaml"),
      "tags:\n  fixme: todo\n  skip: manual\n",
    );
    const config = discoverConfig({ root });
    expect(config.fixmeTag).toBe("@todo");
    expect(config.skipTag).toBe("@manual");
  });

  it("throws when tags.fixme and tags.skip resolve to the same value", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "bdd-kit.config.yaml"),
      // "@todo" vs "todo" collide after normalization — the guard must catch it.
      "tags:\n  fixme: '@todo'\n  skip: todo\n",
    );
    expect(() => discoverConfig({ root })).toThrow(
      /tags\.fixme and tags\.skip must differ/,
    );
  });
});
