import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSetupAgent } from "../setup-agent.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const listFiles = (dir: string, base: string = dir): string[] =>
  readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory()
        ? listFiles(full, base)
        : [path.relative(base, full)];
    })
    .sort();

describe("runSetupAgent", () => {
  let originalCwd: string;
  let root: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    root = await mkdtemp(path.join(tmpdir(), "bdd-kit-setup-agent-"));
    await mkdir(path.join(root, "repo"));
    process.chdir(path.join(root, "repo"));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  });

  it("rejects missing agent argument", () => {
    expect(() => runSetupAgent({})).toThrow(/Usage: bdd-kit setup-agent/);
  });

  it("rejects unknown agent type", () => {
    expect(() => runSetupAgent({ agent: "unknown" })).toThrow(
      /Unknown agent "unknown"/,
    );
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
    expect(output).toContain("/plugin install bdd-kit@bdd-kit");
  });

  it("creates .agents/skills/ for 'codex' agent", () => {
    runSetupAgent({ agent: "codex" });

    const skillsDir = path.join(root, "repo", ".agents", "skills");
    expect(existsSync(skillsDir)).toBe(true);

    const expectedSkills = [
      "bdd-kit",
      "bdd-setup",
      "bdd-bootstrap",
      "bdd-new-feature",
      "bdd-implement",
      "bdd-sync",
    ];
    for (const skill of expectedSkills) {
      const skillMd = path.join(skillsDir, skill, "SKILL.md");
      expect(existsSync(skillMd), `${skill}/SKILL.md should exist`).toBe(true);
    }

    const syncPrompts = path.join(
      skillsDir,
      "bdd-sync",
      "prompts",
      "system.md",
    );
    expect(
      existsSync(syncPrompts),
      "bdd-sync/prompts/system.md should exist",
    ).toBe(true);
  });

  it("skips existing files without --force", async () => {
    const skillsDir = path.join(root, "repo", ".agents", "skills", "bdd-kit");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(path.join(skillsDir, "SKILL.md"), "existing content");

    runSetupAgent({ agent: "codex" });

    const content = readFileSync(
      path.join(skillsDir, "SKILL.md"),
      "utf-8",
    );
    expect(content).toBe("existing content");
  });

  it("overwrites existing files with --force", async () => {
    const skillsDir = path.join(root, "repo", ".agents", "skills", "bdd-kit");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(path.join(skillsDir, "SKILL.md"), "existing content");

    runSetupAgent({ agent: "codex", force: true });

    const content = readFileSync(
      path.join(skillsDir, "SKILL.md"),
      "utf-8",
    );
    expect(content).not.toBe("existing content");
    expect(content).toContain("name: bdd-kit");
  });
});

describe("checked-in Codex skills", () => {
  it("matches the plugin skills copied by setup-agent codex", () => {
    const pluginSkillsRoot = path.join(repoRoot, "plugins", "bdd-kit", "skills");
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
