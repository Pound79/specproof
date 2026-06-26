import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../../dist/index.js");

describe("--agent flag validation", () => {
  it("rejects invalid --agent value with a helpful error", () => {
    try {
      execFileSync("node", [cli, "init", "--adapter", "playwright", "--agent", "code"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const error = err as { stderr: string; status: number };
      expect(error.stderr).toContain('Unknown --agent value "code"');
      expect(error.stderr).toContain("Supported: claude, codex");
      expect(error.status).not.toBe(0);
    }
  });

  it("rejects --agent without a value", () => {
    try {
      execFileSync("node", [cli, "init", "--adapter", "playwright", "--agent"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect.unreachable("should have thrown");
    } catch (err: unknown) {
      const error = err as { stderr: string; status: number };
      expect(error.stderr).toContain("--agent requires a value");
      expect(error.status).not.toBe(0);
    }
  });
});
