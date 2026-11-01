import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walkRegularFilesWithoutSymlinks } from "../path-security.js";
import { runSetupAgent, pickPluginSkillsRoot } from "../setup-agent.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const listFiles = (dir: string, base: string = dir): string[] =>
  readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
    })
    .sort();

describe("runSetupAgent", () => {
  let originalCwd: string;
  let root: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    root = await mkdtemp(path.join(tmpdir(), "specproof-setup-agent-"));
    await mkdir(path.join(root, "repo"));
    process.chdir(path.join(root, "repo"));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  });

  it("rejects missing agent argument", () => {
    expect(() => runSetupAgent({})).toThrow(/Usage: specproof setup-agent/);
  });

  it("rejects unknown agent type", () => {
    expect(() => runSetupAgent({ agent: "unknown" })).toThrow(/Unknown agent "unknown"/);
  });

  it("prints Claude Code instructions for 'claude' agent", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      runSetupAgent({ agent: "claude" });
    } finally {
      console.log = origLog;
    }
    const output = logs.join("\n");
    expect(output).toContain("/plugin marketplace add");
    expect(output).toContain("/plugin install specproof@specproof");
  });

  it("creates .agents/skills/ for 'codex' agent", () => {
    runSetupAgent({ agent: "codex" });

    const skillsDir = path.join(root, "repo", ".agents", "skills");
    expect(existsSync(skillsDir)).toBe(true);

    const expectedSkills = [
      "specproof",
      "specproof-setup",
      "specproof-bootstrap",
      "specproof-new-feature",
      "specproof-implement",
      "specproof-sync",
    ];
    for (const skill of expectedSkills) {
      const skillMd = path.join(skillsDir, skill, "SKILL.md");
      expect(existsSync(skillMd), `${skill}/SKILL.md should exist`).toBe(true);
    }

    const syncPrompts = path.join(skillsDir, "specproof-sync", "prompts", "system.md");
    expect(existsSync(syncPrompts), "specproof-sync/prompts/system.md should exist").toBe(true);
  });

  it("skips existing files without --force", async () => {
    const skillsDir = path.join(root, "repo", ".agents", "skills", "specproof");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(path.join(skillsDir, "SKILL.md"), "existing content");

    runSetupAgent({ agent: "codex" });

    const content = readFileSync(path.join(skillsDir, "SKILL.md"), "utf-8");
    expect(content).toBe("existing content");
  });

  it("overwrites existing files with --force", async () => {
    const skillsDir = path.join(root, "repo", ".agents", "skills", "specproof");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(path.join(skillsDir, "SKILL.md"), "existing content");

    runSetupAgent({ agent: "codex", force: true });

    const content = readFileSync(path.join(skillsDir, "SKILL.md"), "utf-8");
    expect(content).not.toBe("existing content");
    expect(content).toContain("name: specproof");
  });

  // 途中で失敗したら、この実行で書いたものを戻す（新しく作ったファイルとディレクトリは消し、
  // --force で上書きしたファイルは元の内容と権限に戻す）。コピーの順は readdir の順でファイル
  // システムにより変わるため、同じ走査で最初と最後のファイルを決める。
  const skillFiles = (): string[] =>
    walkRegularFilesWithoutSymlinks(path.join(repoRoot, "plugins", "specproof", "skills"));

  it("rolls back the skill files it wrote when a later copy fails", async () => {
    const files = skillFiles();
    const skillsDir = path.join(root, "repo", ".agents", "skills");
    const first = path.join(skillsDir, files[0]);
    const last = path.join(skillsDir, files[files.length - 1]);
    await mkdir(path.dirname(first), { recursive: true });
    await writeFile(first, "old", { mode: 0o600 });
    await chmod(first, 0o600);
    await mkdir(last, { recursive: true }); // 書き込めない（ディレクトリ）

    expect(() => runSetupAgent({ agent: "codex", force: true })).toThrow(/rolled back/);

    expect(readFileSync(first, "utf-8")).toBe("old");
    expect(statSync(first).mode & 0o777).toBe(0o600);
    expect(statSync(last).isDirectory()).toBe(true);
    expect(listFiles(skillsDir)).toEqual([files[0]]);
  });

  it("removes the directories it created when a later copy fails", async () => {
    const files = skillFiles();
    const skillsDir = path.join(root, "repo", ".agents", "skills");
    const last = path.join(skillsDir, files[files.length - 1]);
    await mkdir(last, { recursive: true });

    expect(() => runSetupAgent({ agent: "codex", force: true })).toThrow(/rolled back/);

    const topDir = (rel: string): string => rel.split(path.sep)[0];
    expect(statSync(last).isDirectory()).toBe(true);
    expect(listFiles(skillsDir)).toEqual([]);
    // 作った skill のディレクトリは消え、置いておいたディレクトリの祖先だけが残る。
    expect(readdirSync(skillsDir)).toEqual([topDir(files[files.length - 1])]);
  });

  it("rejects an agent skills directory that escapes through a repository symlink", async () => {
    const repo = path.join(root, "repo");
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(repo, ".agents"));

    expect(() => runSetupAgent({ agent: "codex" })).toThrow(/symbolic link|symlink/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("rejects a nested skill destination symlink before writing outside the repo", async () => {
    const repo = path.join(root, "repo");
    const outside = path.join(root, "outside");
    const skillsDir = path.join(repo, ".agents", "skills");
    await mkdir(skillsDir, { recursive: true });
    await mkdir(outside);
    await symlink(outside, path.join(skillsDir, "specproof"));

    expect(() => runSetupAgent({ agent: "codex" })).toThrow(/symbolic link|symlink/i);
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe("pickPluginSkillsRoot", () => {
  let root: string;
  let bundled: string;
  let monorepoPrimary: string;
  let monorepoRare: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "specproof-skills-root-"));
    bundled = path.join(root, "cli-skills");
    monorepoPrimary = path.join(root, "kit-plugins-skills");
    monorepoRare = path.join(root, "cli-plugins-skills");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prefers the monorepo source when both the bundled and monorepo candidates exist", async () => {
    await mkdir(bundled, { recursive: true });
    await mkdir(monorepoPrimary, { recursive: true });

    expect(pickPluginSkillsRoot(bundled, [monorepoPrimary, monorepoRare])).toBe(monorepoPrimary);
  });

  it("falls back to the bundled copy when only it exists", async () => {
    await mkdir(bundled, { recursive: true });

    expect(pickPluginSkillsRoot(bundled, [monorepoPrimary, monorepoRare])).toBe(bundled);
  });

  it("picks the monorepo source when only it exists", async () => {
    await mkdir(monorepoPrimary, { recursive: true });

    expect(pickPluginSkillsRoot(bundled, [monorepoPrimary, monorepoRare])).toBe(monorepoPrimary);
  });

  it("returns undefined when no candidate exists", () => {
    expect(pickPluginSkillsRoot(bundled, [monorepoPrimary, monorepoRare])).toBeUndefined();
  });
});

describe("checked-in Codex skills", () => {
  it("matches the plugin skills copied by setup-agent codex", () => {
    const pluginSkillsRoot = path.join(repoRoot, "plugins", "specproof", "skills");
    const codexSkillsRoot = path.join(repoRoot, ".agents", "skills");

    const pluginFiles = listFiles(pluginSkillsRoot);
    expect(listFiles(codexSkillsRoot)).toEqual(pluginFiles);

    for (const file of pluginFiles) {
      expect(readFileSync(path.join(codexSkillsRoot, file), "utf-8")).toBe(
        readFileSync(path.join(pluginSkillsRoot, file), "utf-8"),
      );
    }
  });
});
