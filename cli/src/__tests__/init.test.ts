import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runInit,
  buildNextSteps,
  resolveAutoAdapter,
  scaffoldTemplate,
  pickTemplatesRoot,
} from "../init.js";

describe("runInit", () => {
  let originalCwd: string;
  let root: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    root = await mkdtemp(path.join(tmpdir(), "specproof-init-"));
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

describe("buildNextSteps", () => {
  it("shows only Claude Code steps for 'claude'", () => {
    const output = buildNextSteps("claude");
    expect(output).toContain("/plugin marketplace add Pound79/specproof");
    expect(output).not.toContain("npx @pound79/specproof setup-agent codex");
  });

  it("shows only Codex steps for 'codex'", () => {
    const output = buildNextSteps("codex");
    expect(output).toContain("npx @pound79/specproof setup-agent codex");
    expect(output).not.toContain("/plugin marketplace add");
  });

  it("shows both agent steps for 'all'", () => {
    const output = buildNextSteps("all");
    expect(output).toContain("/plugin marketplace add Pound79/specproof");
    expect(output).toContain("npx @pound79/specproof setup-agent codex");
  });
});

describe("resolveAutoAdapter", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "specproof-auto-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("auto-picks a lone medium-confidence candidate instead of erroring", async () => {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" },
      }),
    );

    const result = await resolveAutoAdapter(root);

    expect(result).toEqual({ adapter: "playwright", dir: "e2e" });
  });

  it("still throws Ambiguous when multiple candidates compete", async () => {
    await writeFile(
      path.join(root, "pubspec.yaml"),
      "name: app\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n",
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "app",
        devDependencies: { "@playwright/test": "^1.60.0" },
      }),
    );

    await expect(resolveAutoAdapter(root)).rejects.toThrow(/Ambiguous detection/);
  });

  it("still throws Ambiguous for a low-confidence-only candidate", async () => {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "app", dependencies: { express: "^4.18.0" } }),
    );

    await expect(resolveAutoAdapter(root)).rejects.toThrow(/Ambiguous detection/);
  });
});

describe("pickTemplatesRoot", () => {
  let root: string;
  let bundled: string;
  let monorepo: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "specproof-tpl-root-"));
    bundled = path.join(root, "cli-templates");
    monorepo = path.join(root, "kit-templates");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prefers the monorepo source when both candidates exist", async () => {
    await mkdir(bundled, { recursive: true });
    await mkdir(monorepo, { recursive: true });

    expect(pickTemplatesRoot(bundled, monorepo)).toBe(monorepo);
  });

  it("falls back to the bundled copy when only it exists", async () => {
    await mkdir(bundled, { recursive: true });

    expect(pickTemplatesRoot(bundled, monorepo)).toBe(bundled);
  });

  it("picks the monorepo source when only it exists", async () => {
    await mkdir(monorepo, { recursive: true });

    expect(pickTemplatesRoot(bundled, monorepo)).toBe(monorepo);
  });

  it("returns undefined when neither candidate exists", () => {
    expect(pickTemplatesRoot(bundled, monorepo)).toBeUndefined();
  });
});

describe("scaffoldTemplate", () => {
  let root: string;
  let tplDir: string;
  let repoRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "specproof-scaffold-"));
    tplDir = path.join(root, "tpl");
    repoRoot = path.join(root, "repo");
    await mkdir(repoRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const writeTplFile = async (relPath: string, content: string) => {
    const full = path.join(tplDir, relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  };

  it("rewrites specproof.config.yaml layout paths when e2eDir differs from the template default", async () => {
    await writeTplFile(
      "specproof.config.yaml",
      [
        "layout:",
        '  e2eRoot: "packages/e2e"',
        '  featuresDir: "packages/e2e/features"',
        "fixtures:",
        '  loginPage: "packages/e2e/src/pages/LoginPage.ts"',
      ].join("\n"),
    );
    await writeTplFile("features/example.feature", "Feature: example\n");

    const e2eDir = path.join(repoRoot, "e2e");
    const result = scaffoldTemplate({
      tplDir,
      repoRoot,
      e2eDir,
      templateDefaultDir: "packages/e2e",
      force: false,
    });

    expect(result.layoutRewritten).toBe(true);
    expect(result.written).toContain("specproof.config.yaml");
    expect(result.written).toContain(path.join("e2e", "features", "example.feature"));

    const configText = await readFile(
      path.join(repoRoot, "specproof.config.yaml"),
      "utf-8",
    );
    expect(configText).toContain('e2eRoot: "e2e"');
    expect(configText).toContain('featuresDir: "e2e/features"');
    expect(configText).toContain('loginPage: "e2e/src/pages/LoginPage.ts"');
    expect(configText).not.toContain("packages/e2e");
  });

  it("does not rewrite specproof.config.yaml when e2eDir matches the template default", async () => {
    await writeTplFile(
      "specproof.config.yaml",
      'layout:\n  e2eRoot: "packages/e2e"\n',
    );

    const e2eDir = path.join(repoRoot, "packages", "e2e");
    const result = scaffoldTemplate({
      tplDir,
      repoRoot,
      e2eDir,
      templateDefaultDir: "packages/e2e",
      force: false,
    });

    expect(result.layoutRewritten).toBe(false);
    const configText = await readFile(
      path.join(repoRoot, "specproof.config.yaml"),
      "utf-8",
    );
    expect(configText).toContain('e2eRoot: "packages/e2e"');
  });

  it("maps github-workflows/* into <repoRoot>/.github/workflows/, not the e2e package", async () => {
    await writeTplFile("github-workflows/specproof-drift-check.yml", "name: drift-check\n");

    const e2eDir = path.join(repoRoot, "e2e");
    const result = scaffoldTemplate({
      tplDir,
      repoRoot,
      e2eDir,
      templateDefaultDir: "e2e",
      force: false,
    });

    const expectedRel = path.join(".github", "workflows", "specproof-drift-check.yml");
    expect(result.written).toContain(expectedRel);
    expect(existsSync(path.join(repoRoot, ".github", "workflows", "specproof-drift-check.yml"))).toBe(
      true,
    );
    expect(existsSync(path.join(e2eDir, "github-workflows"))).toBe(false);
  });

  it("never overwrites an existing CI workflow file, even with --force", async () => {
    await writeTplFile("github-workflows/specproof-drift-check.yml", "name: from-template\n");
    const existingPath = path.join(repoRoot, ".github", "workflows", "specproof-drift-check.yml");
    await mkdir(path.dirname(existingPath), { recursive: true });
    await writeFile(existingPath, "name: from-consumer\n");

    const e2eDir = path.join(repoRoot, "e2e");
    const result = scaffoldTemplate({
      tplDir,
      repoRoot,
      e2eDir,
      templateDefaultDir: "e2e",
      force: true,
    });

    const expectedRel = path.join(".github", "workflows", "specproof-drift-check.yml");
    expect(result.skippedWorkflows).toContain(expectedRel);
    expect(result.written).not.toContain(expectedRel);
    const content = await readFile(existingPath, "utf-8");
    expect(content).toBe("name: from-consumer\n");
  });

  it("skips existing non-workflow files unless --force is set", async () => {
    await writeTplFile("steps/example.steps.ts", "// template version\n");
    const e2eDir = path.join(repoRoot, "e2e");
    const existingPath = path.join(e2eDir, "steps", "example.steps.ts");
    await mkdir(path.dirname(existingPath), { recursive: true });
    await writeFile(existingPath, "// consumer version\n");

    const skipResult = scaffoldTemplate({
      tplDir,
      repoRoot,
      e2eDir,
      templateDefaultDir: "e2e",
      force: false,
    });
    expect(skipResult.skipped).toContain(path.join("e2e", "steps", "example.steps.ts"));
    expect(await readFile(existingPath, "utf-8")).toBe("// consumer version\n");

    const forceResult = scaffoldTemplate({
      tplDir,
      repoRoot,
      e2eDir,
      templateDefaultDir: "e2e",
      force: true,
    });
    expect(forceResult.written).toContain(path.join("e2e", "steps", "example.steps.ts"));
    expect(await readFile(existingPath, "utf-8")).toBe("// template version\n");
  });
});
