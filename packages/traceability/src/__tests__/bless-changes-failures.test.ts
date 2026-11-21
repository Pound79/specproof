import { describe, expect, it } from "vitest";
import { groupChangesSinceBless } from "../bless-changes.js";
import type { BlessHistory } from "../bless-history.js";
import type { DriftEntry } from "../check.js";
import type { GitResult, GitRunner } from "../git-runner.js";
import type { TraceabilityManifest } from "../manifest.js";

// git が失敗したときに、「その版にファイルが無い」「bless した版を含まない」と読んで、誤ったまとめを
// 確かなものと同じ見た目で出さない。
const BLESSED = "b".repeat(40);
const HEAD = "a".repeat(40);
const CANDIDATE = "c".repeat(40);

const entry: DriftEntry = {
  linkId: "perm",
  side: "impl",
  path: "src/a.ts",
  storedHash: "0".repeat(64),
  currentHash: "1".repeat(64),
  status: "changed",
};
const history: BlessHistory = {
  available: true,
  incomplete: false,
  prefix: "",
  commits: [BLESSED],
  paths: ["src/a.ts"],
};
const manifest: TraceabilityManifest = { version: 1, links: [] };

const fakeGit = (answer: (args: string[]) => GitResult): GitRunner => ({
  run: async (args) => answer(args),
  overDeadline: () => false,
  exhausted: false,
});

const ok = (stdout: string): GitResult => ({ ok: true, stdout });
const fail = (code: number): GitResult => ({ ok: false, code });

describe("--since-bless のまとめは git の失敗を意味のある値として読まない", () => {
  it("HEAD の版が読めない（パスは木にある）なら、コミットしていない変更としない", async () => {
    const git = fakeGit((args) => {
      if (args[0] === "rev-list" && args.includes("--ancestry-path")) return ok(`${HEAD}\n`);
      if (args[0] === "rev-list") return ok(`${HEAD}\n${BLESSED}\n`);
      if (args[0] === "log") return ok("");
      if (args[0] === "show") return fail(128);
      if (args[0] === "ls-tree") return ok(`100644 blob ${"d".repeat(40)}\tsrc/a.ts\u0000`);
      return fail(128);
    });
    const changes = await groupChangesSinceBless(git, [entry], history, manifest);
    expect(changes.uncommitted).toEqual([]);
    expect(changes.notGrouped).toEqual({ noBlessedVersion: 0, notSearched: 0, failed: 1 });
    expect(changes.incomplete).toBe(true);
  });

  it("HEAD の木にパスが無ければ、消したコミットしていない変更とする", async () => {
    const git = fakeGit((args) => {
      if (args[0] === "rev-list" && args.includes("--ancestry-path")) return ok(`${HEAD}\n`);
      if (args[0] === "rev-list") return ok(`${HEAD}\n${BLESSED}\n`);
      if (args[0] === "log") return ok("");
      if (args[0] === "show") return fail(128);
      if (args[0] === "ls-tree") return ok("");
      return fail(128);
    });
    const changes = await groupChangesSinceBless(git, [entry], history, manifest);
    expect(changes.uncommitted).toEqual([{ side: "impl", path: "src/a.ts", linkIds: ["perm"] }]);
    expect(changes.incomplete).toBe(false);
  });

  it("候補のコミットの版が読めなければ、そのコミットに割り当てない", async () => {
    const git = fakeGit((args) => {
      if (args[0] === "rev-list" && args.includes("--ancestry-path"))
        return ok(`${HEAD}\n${CANDIDATE}\n`);
      if (args[0] === "rev-list") return ok(`${HEAD}\n${CANDIDATE}\n${BLESSED}\n`);
      if (args[0] === "log") return ok(`${CANDIDATE}\u001fChange (#1)\n`);
      if (args[0] === "show" && args[1].startsWith(CANDIDATE)) return fail(128);
      if (args[0] === "show") return ok("export const a = 1;\n");
      if (args[0] === "rev-parse") return ok(`${BLESSED}\n`);
      if (args[0] === "ls-tree") return ok(`100644 blob ${"d".repeat(40)}\tsrc/a.ts\u0000`);
      return fail(128);
    });
    const changes = await groupChangesSinceBless(git, [entry], history, manifest);
    expect(changes.commits).toEqual([]);
    expect(changes.incomplete).toBe(true);
  });

  it("範囲を決められない（ancestry-path が失敗）なら、打ち切ったとし、コミットしていない変更の確認は続ける", async () => {
    const git = fakeGit((args) => {
      if (args[0] === "rev-list" && args.includes("--ancestry-path")) return fail(128);
      if (args[0] === "rev-list") return ok(`${HEAD}\n${BLESSED}\n`);
      if (args[0] === "show") return ok("export const a = 9;\n");
      return fail(128);
    });
    const changes = await groupChangesSinceBless(git, [entry], history, manifest);
    expect(changes.commits).toEqual([]);
    expect(changes.incomplete).toBe(true);
    // コミットしていない変更の確認は続ける（HEAD の版と今の中身は違う）。
    expect(changes.uncommitted).toEqual([{ side: "impl", path: "src/a.ts", linkIds: ["perm"] }]);
  });
});
