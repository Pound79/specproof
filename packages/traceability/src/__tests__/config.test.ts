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
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveRepoRoot", () => {
  it("returns the directory containing traceability.yaml, walking up", async () => {
    const root = await makeTmp();
    await writeFile(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    const nested = path.join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    expect(resolveRepoRoot(nested)).toBe(root);
  });

  it("throws when no marker file exists and not inside a git repo", async () => {
    // A bare tmp dir has no marker and tmpdir() is outside any git tree, so
    // the git rev-parse fallback fails too.
    const root = await makeTmp();
    expect(() => resolveRepoRoot(root)).toThrow(/Could not resolve a repo root/);
  });
});

describe("discoverConfig", () => {
  it("defaults manifestPath to <root>/traceability.yaml", async () => {
    const root = await makeTmp();
    await writeFile(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    const config = discoverConfig({ startDir: root });
    expect(config.repoRoot).toBe(root);
    expect(config.manifestPath).toBe(path.join(root, "traceability.yaml"));
  });

  it("prefers specproof.config.yaml layout.manifest over the default", async () => {
    const root = await makeTmp();
    await writeFile(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "layout:\n  manifest: packages/e2e/traceability.yaml\n  pagesDir: packages/web/pages\n  candidateSuffix: Page.tsx\n  featuresDir: packages/e2e/features\n",
    );
    const config = discoverConfig({ startDir: root });
    expect(config.manifestPath).toBe(path.join(root, "packages/e2e/traceability.yaml"));
    expect(config.pagesDir).toBe("packages/web/pages");
    expect(config.candidateSuffix).toBe("Page.tsx");
    expect(config.featuresDir).toBe("packages/e2e/features");
  });

  it("lets an explicit manifest override win over discovery", async () => {
    const root = await makeTmp();
    await writeFile(path.join(root, "traceability.yaml"), "version: 1\nlinks: []\n");
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
    await writeFile(path.join(root, "specproof.config.yaml"), "layout:\n  pagesDir: from-config\n");
    const config = discoverConfig({ root, pagesDir: "from-cli" });
    expect(config.pagesDir).toBe("from-cli");
  });

  it("lets a --candidate-suffix override win over the config file", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "layout:\n  candidateSuffix: Page.tsx\n",
    );
    const config = discoverConfig({ root, candidateSuffix: "_page.dart" });
    expect(config.candidateSuffix).toBe("_page.dart");
  });

  it("設定はタグ名の設定項目（fixmeTag / skipTag）を持たない", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "layout:\n  manifest: traceability.yaml\n",
    );
    const config = discoverConfig({ root });
    expect(config).not.toHaveProperty("fixmeTag");
    expect(config).not.toHaveProperty("skipTag");
  });

  it("leaves implGlobs undefined when layout.implGlobs is omitted", async () => {
    const root = await makeTmp();
    const config = discoverConfig({ root });
    expect(config.implGlobs).toBeUndefined();
  });

  it("reads layout.implGlobs as a string array", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "layout:\n  implGlobs:\n    - src/**/*.ts\n    - lib/**/*.js\n",
    );
    const config = discoverConfig({ root });
    expect(config.implGlobs).toEqual(["src/**/*.ts", "lib/**/*.js"]);
  });

  it("rejects layout.implGlobs when it is not an array of strings", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "layout:\n  implGlobs: not-an-array\n",
    );
    expect(() => discoverConfig({ root })).toThrow(/layout\.implGlobs must be an array/);
  });

  it("defaults strictUnregisteredImpl to false when omitted", async () => {
    const root = await makeTmp();
    const config = discoverConfig({ root });
    expect(config.strictUnregisteredImpl).toBe(false);
  });

  it("reads strictUnregisteredImpl: true from the config file", async () => {
    const root = await makeTmp();
    await writeFile(path.join(root, "specproof.config.yaml"), "strictUnregisteredImpl: true\n");
    const config = discoverConfig({ root });
    expect(config.strictUnregisteredImpl).toBe(true);
  });

  it("rejects a strictUnregisteredImpl value that is not a boolean", async () => {
    const root = await makeTmp();
    await writeFile(path.join(root, "specproof.config.yaml"), "strictUnregisteredImpl: yes\n");
    expect(() => discoverConfig({ root })).toThrow(/strictUnregisteredImpl must be true or false/);
  });

  it("defaults strictUnregisteredSpecHeadings to false when omitted", async () => {
    const root = await makeTmp();
    const config = discoverConfig({ root });
    expect(config.strictUnregisteredSpecHeadings).toBe(false);
  });

  it("reads strictUnregisteredSpecHeadings: true from the config file", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "strictUnregisteredSpecHeadings: true\n",
    );
    const config = discoverConfig({ root });
    expect(config.strictUnregisteredSpecHeadings).toBe(true);
  });

  it("rejects a strictUnregisteredSpecHeadings value that is not a boolean", async () => {
    const root = await makeTmp();
    await writeFile(
      path.join(root, "specproof.config.yaml"),
      "strictUnregisteredSpecHeadings: yes\n",
    );
    expect(() => discoverConfig({ root })).toThrow(
      /strictUnregisteredSpecHeadings must be true or false/,
    );
  });
});

// 0.4.0 で旧名（bdd-kit、0.2.0 で改名）の設定ファイルを読むのをやめた。黙って無視すると、置いた
// 設定（featuresDir など）が効かないまま検査が通るので、旧名だけがあれば名前の変更を案内して止める。
describe("discoverConfig with the removed bdd-kit.config.yaml name", () => {
  for (const legacy of ["bdd-kit.config.yaml", "bdd-kit.config.yml"]) {
    it(`stops with a rename message when only ${legacy} exists`, async () => {
      const root = await makeTmp();
      await writeFile(path.join(root, legacy), "layout:\n  pagesDir: legacy-pages\n");
      expect(() => discoverConfig({ root })).toThrow(
        new RegExp(
          `${legacy.replace(/\./g, "\\.")} is no longer read; rename it to specproof\\.config\\.yaml`,
        ),
      );
    });
  }

  it("reads specproof.config.yaml and ignores a leftover bdd-kit.config.yaml", async () => {
    const root = await makeTmp();
    await writeFile(path.join(root, "bdd-kit.config.yaml"), "layout:\n  pagesDir: legacy-pages\n");
    await writeFile(path.join(root, "specproof.config.yaml"), "layout:\n  pagesDir: new-pages\n");
    const config = discoverConfig({ root });
    expect(config.pagesDir).toBe("new-pages");
  });
});
